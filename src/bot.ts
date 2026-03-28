import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { DEFAULT_CDN_BASE_URL, DEFAULT_CHANNEL_VERSION } from './constants.js';
import { QrCodeLogin } from './auth/qrcode.js';
import { SessionState } from './auth/session.js';
import { ILinkHttpClient } from './http/client.js';
import { downloadMessageMedia } from './media/download.js';
import { createMediaMessageItem, uploadMediaFile } from './media/upload.js';
import { Message, createMessage } from './messaging/receiver.js';
import { MessageSender } from './messaging/sender.js';
import { ReplyStream } from './messaging/stream.js';
import { TypingIndicator } from './messaging/typing.js';
import { UpdatesPoller } from './polling/updater.js';
import { Store } from './storage/store.js';
import type { Credentials, LoginResult, RawMessage } from './types/api.js';
import type { AgentLinkWechatEvents } from './types/events.js';
import type { BotOptions, StreamOptions } from './types/message.js';
import { createDeferred } from './utils/deferred.js';
import { sanitizeAccountId } from './utils/ids.js';
import { Logger } from './utils/logger.js';
import { resolveDataDir } from './utils/paths.js';
import { TaskQueue } from './utils/task-queue.js';

export class AgentLinkWechat extends EventEmitter {
  private readonly store: Store;
  private readonly http: ILinkHttpClient;
  private readonly session: SessionState;
  private readonly sender: MessageSender;
  private readonly loginFlow: QrCodeLogin;
  private readonly typing: TypingIndicator;
  private readonly logger: Logger;
  private readonly channelVersion: string;
  private readonly messageQueue: TaskQueue;
  private readonly dataDir: string;
  private readonly selectedAccountId: string | null;
  private readonly dmPolicy: 'pairing' | 'open';
  private readonly initialAllowFrom: string[];
  private poller: UpdatesPoller | null = null;
  private pendingLogin = createDeferred<Credentials>();
  private lastLoginResult: LoginResult | null = null;
  private restarting = false;

  constructor(options: BotOptions = {}) {
    super();
    this.channelVersion = options.channelVersion ?? options.credentials?.channelVersion ?? DEFAULT_CHANNEL_VERSION;
    this.dataDir = resolveDataDir(options.dataDir);
    this.store = new Store(this.dataDir);
    this.session = new SessionState(options.credentials ?? null);
    this.http = new ILinkHttpClient({
      credentials: options.credentials ?? null,
      baseUrl: options.credentials?.baseUrl,
    });
    this.logger = new Logger(options.logLevel);
    this.sender = new MessageSender(
      this.http,
      () => this.session.assertActive(),
      () => this.channelVersion,
    );
    this.typing = new TypingIndicator(
      this.http,
      () => this.session.assertActive(),
      () => this.channelVersion,
    );
    this.messageQueue = new TaskQueue(options.maxConcurrentMessages ?? 4);
    this.selectedAccountId = options.accountId ? sanitizeAccountId(options.accountId) : null;
    this.dmPolicy = options.dmPolicy ?? 'pairing';
    this.initialAllowFrom = options.allowFrom ?? [];
    this.loginFlow = new QrCodeLogin(this.http, {
      onQrcode: (url) => this.emit('qrcode', url),
      onScanned: () => this.emit('qrcode:scanned'),
    });
  }

  get isLoggedIn(): boolean {
    return this.session.getCredentials() !== null;
  }

  get botId(): string | null {
    return this.session.accountId;
  }

  async login(): Promise<LoginResult> {
    const result = await this.loginFlow.createLogin();
    this.lastLoginResult = result;
    this.logger.info('QR code created', { qrcodeId: result.qrcodeId });
    return result;
  }

  async waitForLogin(): Promise<Credentials> {
    const credentials = await this.loginFlow.waitForLogin(this.lastLoginResult ?? undefined);
    await this.applyCredentials(credentials);
    this.pendingLogin.resolve(credentials);
    this.pendingLogin = createDeferred<Credentials>();
    this.emit('login', credentials);
    this.logger.info('Login completed', { botId: credentials.botId, userId: credentials.userId });
    return credentials;
  }

  async start(): Promise<void> {
    await this.store.ensure();
    if (!this.session.getCredentials()) {
      const stored = await this.store.loadCredentials(this.selectedAccountId ?? undefined);
      if (stored) {
        await this.applyCredentials(stored);
      }
    }
    this.startPoller();
  }

  stop(): void {
    this.poller?.stop();
    this.poller = null;
  }

  async logout(): Promise<void> {
    this.stop();
    const accountId = this.botId ? sanitizeAccountId(this.botId) : undefined;
    this.session.setCredentials(null);
    this.http.setCredentials(null);
    if (accountId) {
      await this.store.clearCredentials(accountId);
    }
    this.emit('logout', 'manual_logout');
    this.logger.info('Manual logout');
  }

  override on<EventName extends keyof AgentLinkWechatEvents>(event: EventName, listener: AgentLinkWechatEvents[EventName]): this {
    return super.on(event, listener);
  }

  async listAccounts(): Promise<string[]> {
    return this.store.listAccounts();
  }

  async sendText(toUserId: string, text: string, accountId?: string): Promise<void> {
    const resolved = await this.resolveOutboundAccount(toUserId, accountId);
    const sender = this.createSenderForCredentials(resolved.credentials);
    await sender.replyText(toUserId, resolved.contextToken, this.decorateDebugText(text, resolved.accountId));
  }

  async sendImage(toUserId: string, filePath: string, accountId?: string): Promise<void> {
    const resolved = await this.resolveOutboundAccount(toUserId, accountId);
    await this.sendMediaFromAccount(resolved.credentials, toUserId, resolved.contextToken, filePath);
  }

  async sendFile(toUserId: string, filePath: string, accountId?: string): Promise<void> {
    const resolved = await this.resolveOutboundAccount(toUserId, accountId);
    await this.sendMediaFromAccount(resolved.credentials, toUserId, resolved.contextToken, filePath);
  }

  createReplyStream(message: Message, options?: StreamOptions): ReplyStream {
    const credentials = this.session.assertActive();
    return new ReplyStream(this.sender, this.typing, message, credentials.botId, options);
  }

  private startPoller(): void {
    const credentials = this.session.assertActive();
    const accountId = sanitizeAccountId(credentials.botId);
    this.poller?.stop();
    this.poller = new UpdatesPoller(this.http, {
      getCursor: () => this.store.loadCursor(accountId),
      saveCursor: (cursor) => this.store.saveCursor(accountId, cursor),
      onMessage: (raw) => this.handleRawMessage(raw),
      onLogout: async (reason) => this.handleLogout(reason),
      onError: (error) => {
        this.logger.error('Polling error', { message: error.message });
        this.emit('error', error);
      },
      getChannelVersion: () => this.channelVersion,
    });
    void this.poller.start();
    this.logger.info('Polling started', { botId: credentials.botId });
  }

  private async handleRawMessage(raw: RawMessage): Promise<void> {
    const credentials = this.session.assertActive();
    const accountId = sanitizeAccountId(credentials.botId);

    if (!(await this.isAuthorized(accountId, raw.from_user_id))) {
      this.logger.debug('Dropping unauthorized message', { accountId, from: raw.from_user_id });
      return;
    }

    await this.store.saveContextToken(accountId, raw.from_user_id, raw.context_token);

    const message = createMessage(
      {
        credentials,
        sender: this.sender,
        saveContextToken: (userId, token) => this.store.saveContextToken(accountId, userId, token),
        createReplyStream: (incoming, options) => this.createReplyStream(incoming, options),
        replyImage: (incoming, filePath) => this.replyWithMedia(incoming, filePath),
        replyFile: (incoming, filePath) => this.replyWithMedia(incoming, filePath),
        downloadMedia: (incoming, destination) => this.downloadMedia(incoming, destination),
      },
      raw,
    );

    if (await this.handleSlashCommand(message, accountId)) {
      return;
    }

    void this.messageQueue.add(async () => {
      const listeners = this.listeners('message') as Array<(message: Message) => void | Promise<void>>;
      try {
        for (const listener of listeners) {
          await listener(message);
        }
      } catch (error) {
        this.logger.error('Message handler failed', { message: (error as Error).message });
        this.emit('error', error as Error);
      }
    });
  }

  private async applyCredentials(credentials: Credentials): Promise<void> {
    this.session.setCredentials(credentials);
    this.session.clearPause();
    this.http.setCredentials(credentials);
    await this.store.saveCredentials(credentials);
    const accountId = sanitizeAccountId(credentials.botId);
    await this.store.addAllowFrom(accountId, credentials.userId);
    for (const userId of this.initialAllowFrom) {
      await this.store.addAllowFrom(accountId, userId);
    }
  }

  private async handleLogout(reason: string): Promise<void> {
    this.session.pauseFor(3_600_000);
    this.emit('logout', reason);
    this.logger.warn('Session expired; starting re-login flow', { reason });

    if (reason !== 'session_expired' || this.restarting) {
      return;
    }

    this.restarting = true;
    this.stop();

    try {
      await this.login();
      await this.waitForLogin();
      this.startPoller();
    } catch (error) {
      this.logger.error('Automatic re-login failed', { message: (error as Error).message });
      this.emit('error', error as Error);
    } finally {
      this.restarting = false;
    }
  }

  private async replyWithMedia(message: Message, filePath: string): Promise<void> {
    await this.sendMediaFromAccount(this.session.assertActive(), message.userId, message.contextToken, filePath);
  }

  private async sendMediaFromAccount(credentials: Credentials, toUserId: string, contextToken: string, filePath: string): Promise<void> {
    const uploaded = await uploadMediaFile({
      http: this.createHttpForCredentials(credentials),
      filePath,
      toUserId,
      channelVersion: this.channelVersion,
      cdnBaseUrl: DEFAULT_CDN_BASE_URL,
    });
    const sender = this.createSenderForCredentials(credentials);
    await sender.sendItems(toUserId, contextToken, [createMediaMessageItem(uploaded)]);
  }

  private async downloadMedia(message: Message, destination: string): Promise<string> {
    const item = message.items.find((entry) => entry.type !== 1);
    if (!item) {
      throw new Error('Message does not contain media');
    }
    return downloadMessageMedia({
      http: this.http,
      item,
      destination,
      rootDir: this.dataDir,
      cdnBaseUrl: DEFAULT_CDN_BASE_URL,
    });
  }

  private async isAuthorized(accountId: string, userId: string): Promise<boolean> {
    if (this.dmPolicy === 'open') {
      return true;
    }
    const allowFrom = await this.store.getAllowFrom(accountId);
    return allowFrom.includes(userId);
  }

  private async handleSlashCommand(message: Message, accountId: string): Promise<boolean> {
    if (!message.text.startsWith('/')) {
      return false;
    }

    if (message.text.startsWith('/echo')) {
      const payload = message.text.slice('/echo'.length).trim();
      const latency = Date.now() - message.timestamp.getTime();
      await message.reply(this.decorateDebugText(`${payload || '(empty)'}\n[latency=${latency}ms]`, accountId));
      return true;
    }

    if (message.text.trim() === '/toggle-debug') {
      const enabled = !(await this.store.getDebugMode(accountId));
      await this.store.setDebugMode(accountId, enabled);
      await message.reply(`debug mode ${enabled ? 'enabled' : 'disabled'}`);
      return true;
    }

    return false;
  }

  private decorateDebugText(text: string, accountId: string): string {
    return text;
  }

  private createHttpForCredentials(credentials: Credentials): ILinkHttpClient {
    return new ILinkHttpClient({ credentials, baseUrl: credentials.baseUrl });
  }

  private createSenderForCredentials(credentials: Credentials): MessageSender {
    const http = credentials.botId === this.botId ? this.http : this.createHttpForCredentials(credentials);
    return new MessageSender(http, () => credentials, () => this.channelVersion);
  }

  private async resolveOutboundAccount(toUserId: string, accountId?: string): Promise<{ accountId: string; credentials: Credentials; contextToken: string }> {
    const allCredentials = await this.store.loadAllCredentials();
    const requestedAccountId = accountId ? sanitizeAccountId(accountId) : undefined;

    if (requestedAccountId) {
      const credentials = allCredentials.find((entry) => sanitizeAccountId(entry.botId) === requestedAccountId);
      if (!credentials) {
        throw new Error(`Unknown accountId: ${requestedAccountId}`);
      }
      const contextToken = await this.store.getContextToken(requestedAccountId, toUserId);
      if (!contextToken) {
        throw new Error(`No context token for ${toUserId} on account ${requestedAccountId}`);
      }
      return { accountId: requestedAccountId, credentials, contextToken };
    }

    const matches: Array<{ accountId: string; credentials: Credentials; contextToken: string }> = [];
    for (const credentials of allCredentials) {
      const normalized = sanitizeAccountId(credentials.botId);
      const contextToken = await this.store.getContextToken(normalized, toUserId);
      if (contextToken) {
        matches.push({ accountId: normalized, credentials, contextToken });
      }
    }

    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous account for ${toUserId}`);
    }
    throw new Error(`No account has an active context for ${toUserId}`);
  }
}

