import { MessageState } from '../types/api.js';
import { STREAM_DEFAULTS } from '../constants.js';
import type { Message } from './receiver.js';
import type { StreamOptions } from '../types/message.js';
import { createClientId } from '../utils/ids.js';
import { markdownToPlainText } from '../utils/markdown.js';

interface StreamSender {
  replyText(toUserId: string, contextToken: string, text: string, state?: MessageState, clientId?: string): Promise<void>;
}

interface StreamTyping {
  start(userId: string, contextToken: string): Promise<void>;
  stop(userId: string): Promise<void>;
}

export class ReplyStream {
  private readonly sender: StreamSender;
  private readonly typing: StreamTyping | null;
  private readonly message: Message;
  private readonly options: Required<StreamOptions>;
  private readonly clientId: string;
  private buffer = '';
  private transcript = '';
  private lastSnapshot = '';
  private flushTimer: NodeJS.Timeout | null = null;
  private inflight = Promise.resolve();
  private closed = false;
  private sentAny = false;
  private queuedAny = false;
  private typingStarted = false;

  constructor(sender: StreamSender, typing: StreamTyping | null, message: Message, botId: string, options: StreamOptions = {}) {
    this.sender = sender;
    this.typing = typing;
    this.message = message;
    this.clientId = createClientId(botId);
    this.options = {
      minChunkSize: options.minChunkSize ?? STREAM_DEFAULTS.minChunkSize,
      flushInterval: options.flushInterval ?? STREAM_DEFAULTS.flushInterval,
      maxChunkSize: options.maxChunkSize ?? STREAM_DEFAULTS.maxChunkSize,
      showTyping: options.showTyping ?? STREAM_DEFAULTS.showTyping,
    };
  }

  write(chunk: string): void {
    if (this.closed || chunk.length === 0) {
      return;
    }

    if (this.options.showTyping && this.typing && !this.typingStarted) {
      this.typingStarted = true;
      this.inflight = this.inflight.then(() => this.typing?.start(this.message.userId, this.message.contextToken));
    }

    const normalized = markdownToPlainText(chunk);
    this.buffer += normalized;
    this.transcript += normalized;

    if (this.buffer.length >= this.options.minChunkSize) {
      this.queueFlush(MessageState.GENERATING);
      return;
    }
    this.armTimer();
  }

  async end(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.clearTimer();
    if (this.transcript.length > 0) {
      this.queueFlush(MessageState.FINISH, true);
    } else if (this.sentAny || this.queuedAny) {
      this.queueSend('', MessageState.FINISH);
    }
    await this.inflight.finally(async () => {
      await this.stopTyping();
    });
  }

  abort(): void {
    this.closed = true;
    this.buffer = '';
    this.clearTimer();
    void this.stopTyping();
  }

  private armTimer(): void {
    this.clearTimer();
    this.flushTimer = setTimeout(() => {
      this.queueFlush(MessageState.GENERATING);
    }, this.options.flushInterval);
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private queueFlush(state: MessageState, forceFinish = false): void {
    this.clearTimer();
    this.buffer = '';

    const snapshot = this.transcript;
    if (!forceFinish && snapshot.length === 0) {
      return;
    }
    if (!forceFinish && snapshot === this.lastSnapshot) {
      return;
    }

    this.queueSend(snapshot, forceFinish ? MessageState.FINISH : state);
  }

  private queueSend(text: string, state: MessageState): void {
    this.queuedAny = true;
    this.lastSnapshot = text;
    this.inflight = this.inflight.then(async () => {
      await this.sender.replyText(this.message.userId, this.message.contextToken, text, state, this.clientId);
      this.sentAny = true;
    });
  }

  private async stopTyping(): Promise<void> {
    if (!this.typingStarted || !this.typing) {
      return;
    }
    this.typingStarted = false;
    await this.typing.stop(this.message.userId);
  }
}
