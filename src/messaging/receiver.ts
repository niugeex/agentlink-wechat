import { MessageItemType, type Credentials, type RawMessage, type RawMessageItem } from '../types/api.js';
import type { MediaType, StreamOptions } from '../types/message.js';
import type { MessageSender } from './sender.js';
import type { ReplyStream } from './stream.js';

export interface MessageRuntime {
  credentials: Credentials;
  sender: MessageSender;
  createReplyStream: (message: Message, options?: StreamOptions) => ReplyStream;
  saveContextToken: (userId: string, token: string) => Promise<void>;
  replyImage: (message: Message, filePath: string) => Promise<void>;
  replyFile: (message: Message, filePath: string) => Promise<void>;
  downloadMedia?: (message: Message, destination: string) => Promise<string>;
}

export class Message {
  readonly id: bigint;
  readonly userId: string;
  readonly userName: string;
  readonly timestamp: Date;
  readonly text: string;
  readonly items: RawMessageItem[];
  readonly contextToken: string;

  constructor(
    private readonly runtime: MessageRuntime,
    private readonly raw: RawMessage,
  ) {
    this.id = BigInt(raw.message_id);
    this.userId = raw.from_user_id;
    this.userName = raw.from_user_id;
    this.timestamp = new Date(raw.create_time_ms);
    this.text = extractText(raw.item_list);
    this.items = raw.item_list;
    this.contextToken = raw.context_token;
  }

  get hasMedia(): boolean {
    return this.mediaType !== null;
  }

  get mediaType(): MediaType {
    for (const item of this.items) {
      switch (item.type) {
        case MessageItemType.IMAGE:
          return 'image';
        case MessageItemType.VOICE:
          return 'voice';
        case MessageItemType.FILE:
          return 'file';
        case MessageItemType.VIDEO:
          return 'video';
      }
    }
    return null;
  }

  async reply(text: string): Promise<void> {
    await this.runtime.saveContextToken(this.userId, this.contextToken);
    await this.runtime.sender.replyText(this.userId, this.contextToken, text);
  }

  async replyImage(filePath: string): Promise<void> {
    await this.runtime.replyImage(this, filePath);
  }

  async replyFile(filePath: string): Promise<void> {
    await this.runtime.replyFile(this, filePath);
  }

  createReplyStream(options?: StreamOptions): ReplyStream {
    return this.runtime.createReplyStream(this, options);
  }

  async downloadMedia(destination: string): Promise<string> {
    if (!this.runtime.downloadMedia) {
      throw new Error('downloadMedia is available in Phase 3');
    }
    return this.runtime.downloadMedia(this, destination);
  }
}

export function extractText(items: RawMessageItem[]): string {
  const chunks: string[] = [];
  for (const item of items) {
    if (item.ref_msg_item && (item.ref_msg_item.title || item.ref_msg_item.ref_body)) {
      chunks.push(`[引用: ${item.ref_msg_item.title ?? ''} | ${item.ref_msg_item.ref_body ?? ''}]`);
    }
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      chunks.push(item.text_item.text);
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      chunks.push(item.voice_item.text);
    }
  }
  return chunks.join('\n').trim();
}

export function createMessage(runtime: MessageRuntime, raw: RawMessage): Message {
  return new Message(runtime, raw);
}
