import type { Credentials } from './api.js';

export type MediaType = 'image' | 'voice' | 'file' | 'video' | null;

export interface BotOptions {
  /**
   * Application-owned runtime data directory.
   *
   * Session state, cursors, allowlists, and media downloads are stored here.
   * When `message.downloadMedia(destination)` receives a relative path, it is
   * resolved against this directory. Defaults to `~/.agentlink/wechat`.
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
