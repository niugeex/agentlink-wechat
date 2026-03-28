export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
export const DEFAULT_CHANNEL_VERSION = '2.1.1';
export const DEFAULT_CLIENT_VERSION = '131329';

export const DEFAULT_TIMEOUTS = {
  get: 5_000,
  loginPoll: 35_000,
  updates: 35_000,
  typing: 10_000,
  defaultPost: 35_000,
} as const;

export const STREAM_DEFAULTS = {
  minChunkSize: 200,
  flushInterval: 3_000,
  maxChunkSize: 4_000,
  showTyping: true,
} as const;
