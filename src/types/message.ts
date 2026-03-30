import type { Credentials } from './api.js';

export type MediaType = 'image' | 'voice' | 'file' | 'video' | null;

export interface BotOptions {
  /**
   * Application-owned runtime data directory.
   *
   * This is the runtime root directory. SDK-managed account state, allowlists, and media downloads are stored under it.
   * When `message.downloadMedia(destination)` receives a relative path, it is
   * resolved against this root directory. Defaults to `~/.agentlink/wechat`.
   */
  dataDir?: string;
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  channelVersion?: string;
  credentials?: Credentials;
  accountId?: string;
  maxConcurrentMessages?: number;
  dmPolicy?: 'pairing' | 'open';
  allowFrom?: string[];
}

export interface StreamOptions {
  minChunkSize?: number;
  flushInterval?: number;
  maxChunkSize?: number;
  showTyping?: boolean;
}

