import { randomBytes } from 'node:crypto';

let counter = 0;

export function createClientId(botId: string): string {
  counter += 1;
  const safeBotId = botId.replace(/[^a-z0-9]+/gi, '-');
  return `sdk-${safeBotId}-${Date.now()}-${counter}`;
}

export function createRandomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function createWechatUin(): string {
  const value = Math.floor(Math.random() * 0x1_0000_0000);
  return Buffer.from(String(value), 'utf8').toString('base64');
}

export function sanitizeAccountId(botId: string): string {
  return botId.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}
