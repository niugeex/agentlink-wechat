import type { Credentials } from './api.js';

export type MediaType = 'image' | 'voice' | 'file' | 'video' | null;

export interface BotOptions {
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
