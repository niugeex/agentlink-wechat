import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Credentials } from '../types/api.js';
import { sanitizeAccountId } from '../utils/ids.js';

interface AccountsIndex {
  accounts: string[];
}

interface ContextTokensFile {
  version: 1;
  tokens: Record<string, string>;
}

interface CursorFile {
  get_updates_buf: string;
}

interface DebugModeFile {
  accounts: Record<string, boolean>;
}

interface AllowFromFile {
  version: 1;
  allowFrom: string[];
}

export class Store {
  private readonly rootDir: string;
  private readonly channelDir: string;
  private readonly accountsDir: string;
  private readonly credentialsDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.channelDir = join(rootDir, 'wechat');
    this.accountsDir = join(this.channelDir, 'accounts');
    this.credentialsDir = join(rootDir, 'credentials');
  }

  async ensure(): Promise<void> {
    await mkdir(this.accountsDir, { recursive: true });
    await mkdir(this.credentialsDir, { recursive: true });
  }

  async saveCredentials(credentials: Credentials): Promise<void> {
    await this.ensure();
    const accountId = sanitizeAccountId(credentials.botId);
    const previousAccountId = await this.findAccountIdByUserId(credentials.userId);
    if (previousAccountId && previousAccountId !== accountId) {
      await this.clearAccount(previousAccountId);
    }
    await this.writeJson(this.accountPath(accountId), credentials);
    await this.updateAccountsIndex(accountId, true);
  }

  async loadCredentials(accountId?: string): Promise<Credentials | null> {
    await this.ensure();
    if (accountId) {
      return this.readJson<Credentials | null>(this.accountPath(accountId), null);
    }

    const ids = await this.listAccounts();
    if (ids.length === 0) {
      return null;
    }

    return this.readJson<Credentials | null>(this.accountPath(ids[0]), null);
  }

  async loadAllCredentials(): Promise<Credentials[]> {
    const ids = await this.listAccounts();
    const credentials = await Promise.all(ids.map((accountId) => this.readJson<Credentials | null>(this.accountPath(accountId), null)));
    return credentials.filter((value): value is Credentials => Boolean(value));
  }

  async clearCredentials(accountId?: string): Promise<void> {
    await this.ensure();
    if (!accountId) {
      const ids = await this.listAccounts();
      await Promise.all(ids.map((id) => this.clearAccount(id)));
      await this.writeJson(this.accountsIndexPath(), { accounts: [] });
      return;
    }

    await this.clearAccount(accountId);
  }

  async saveCursor(accountId: string, cursor: string): Promise<void> {
    await this.writeJson(this.cursorPath(accountId), { get_updates_buf: cursor });
  }

  async loadCursor(accountId: string): Promise<string> {
    const file = await this.readJson<CursorFile>(this.cursorPath(accountId), { get_updates_buf: '' });
    return file.get_updates_buf ?? '';
  }

  async saveContextToken(accountId: string, userId: string, token: string): Promise<void> {
    const file = await this.readJson<ContextTokensFile>(this.contextTokensPath(accountId), { version: 1, tokens: {} });
    file.tokens[userId] = token;
    await this.writeJson(this.contextTokensPath(accountId), file);
  }

  async getContextToken(accountId: string, userId: string): Promise<string | null> {
    const file = await this.readJson<ContextTokensFile>(this.contextTokensPath(accountId), { version: 1, tokens: {} });
    return file.tokens[userId] ?? null;
  }

  async getAllContextTokens(accountId: string): Promise<Record<string, string>> {
    const file = await this.readJson<ContextTokensFile>(this.contextTokensPath(accountId), { version: 1, tokens: {} });
    return { ...file.tokens };
  }

  async setDebugMode(accountId: string, enabled: boolean): Promise<void> {
    const file = await this.readJson<DebugModeFile>(this.debugModePath(), { accounts: {} });
    file.accounts[accountId] = enabled;
    await this.writeJson(this.debugModePath(), file);
  }

  async getDebugMode(accountId: string): Promise<boolean> {
    const file = await this.readJson<DebugModeFile>(this.debugModePath(), { accounts: {} });
    return Boolean(file.accounts[accountId]);
  }

  async addAllowFrom(accountId: string, userId: string): Promise<void> {
    const file = await this.readJson<AllowFromFile>(this.allowFromPath(accountId), { version: 1, allowFrom: [] });
    if (!file.allowFrom.includes(userId)) {
      file.allowFrom.push(userId);
      await this.writeJson(this.allowFromPath(accountId), file);
    }
  }

  async getAllowFrom(accountId: string): Promise<string[]> {
    const file = await this.readJson<AllowFromFile>(this.allowFromPath(accountId), { version: 1, allowFrom: [] });
    return [...file.allowFrom];
  }

  async listAccounts(): Promise<string[]> {
    const index = await this.readJson<AccountsIndex>(this.accountsIndexPath(), { accounts: [] });
    return [...new Set(index.accounts)];
  }

  private async updateAccountsIndex(accountId: string, add: boolean): Promise<void> {
    const index = await this.readJson<AccountsIndex>(this.accountsIndexPath(), { accounts: [] });
    const next = add ? [...new Set([...index.accounts, accountId])] : index.accounts.filter((entry) => entry !== accountId);
    await this.writeJson(this.accountsIndexPath(), { accounts: next });
  }

  private async findAccountIdByUserId(userId: string): Promise<string | null> {
    const accounts = await this.loadAllCredentials();
    const matched = accounts.find((entry) => entry.userId === userId);
    return matched ? sanitizeAccountId(matched.botId) : null;
  }

  private async clearAccount(accountId: string): Promise<void> {
    await rm(this.accountPath(accountId), { force: true });
    await rm(this.cursorPath(accountId), { force: true });
    await rm(this.contextTokensPath(accountId), { force: true });
    await rm(this.allowFromPath(accountId), { force: true });
    await this.updateAccountsIndex(accountId, false);
  }

  private accountPath(accountId: string): string {
    return join(this.accountsDir, `${accountId}.json`);
  }

  private cursorPath(accountId: string): string {
    return join(this.accountsDir, `${accountId}.sync.json`);
  }

  private contextTokensPath(accountId: string): string {
    return join(this.accountsDir, `${accountId}.context-tokens.json`);
  }

  private debugModePath(): string {
    return join(this.channelDir, 'debug-mode.json');
  }

  private allowFromPath(accountId: string): string {
    return join(this.credentialsDir, `agentlink-wechat-${accountId}-allowFrom.json`);
  }

  private accountsIndexPath(): string {
    return join(this.channelDir, 'accounts.json');
  }

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    try {
      const content = await readFile(path, 'utf8');
      return JSON.parse(content) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return fallback;
      }
      throw error;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try {
      await chmod(path, 0o600);
    } catch {
      // Best effort on non-POSIX platforms.
    }
  }
}

