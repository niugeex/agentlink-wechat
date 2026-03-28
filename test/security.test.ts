import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentLinkWechat } from '../src/bot.js';
import { MessageState, MessageType, type Credentials, type RawMessage } from '../src/types/api.js';
import { resolveDestination } from '../src/media/download.js';
import { sanitizeLogMeta } from '../src/utils/logger.js';
import { sanitizeAccountId } from '../src/utils/ids.js';

describe('security checks', () => {
  let root: string;
  let credentials: Credentials;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentlink-wechat-security-'));
    credentials = {
      botToken: 'abcdef123456@im.bot:super-secret-token-value',
      botId: 'abcdef123456@im.bot',
      userId: 'owner@im.wechat',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      savedAt: Date.now(),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not cache context tokens for unauthorized senders', async () => {
    const bot = new AgentLinkWechat({ dataDir: root, credentials, dmPolicy: 'pairing' });
    const store = (bot as any).store;
    await store.ensure();
    await store.saveCredentials(credentials);

    const listener = vi.fn();
    bot.on('message', listener);

    const raw: RawMessage = {
      message_id: '1',
      from_user_id: 'intruder@im.wechat',
      to_user_id: credentials.botId,
      create_time_ms: Date.now(),
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      item_list: [],
      context_token: 'secret-context-token',
    };

    await (bot as any).handleRawMessage(raw);

    const accountId = sanitizeAccountId(credentials.botId);
    await expect(store.getContextToken(accountId, 'intruder@im.wechat')).resolves.toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects download destinations that escape the data directory', () => {
    expect(() => resolveDestination(root, '..\\..\\outside.bin')).toThrow('Destination escapes the configured data directory');
    expect(() => resolveDestination(root, 'nested\\inside.bin')).not.toThrow();
  });

  it('redacts sensitive log metadata by key and token pattern', () => {
    const sanitized = sanitizeLogMeta({
      botToken: 'abcdef123456@im.bot:super-secret-token-value',
      contextToken: 'very-secret-context-token',
      nested: { aesKey: '00112233445566778899aabbccddeeff' },
      url: 'https://example.com/path?token=123',
    }) as Record<string, unknown>;

    expect(String(sanitized.botToken)).toContain('abcdef');
    expect(String(sanitized.botToken)).toContain('...(');
    expect(String(sanitized.contextToken)).toContain('...(');
    expect(String((sanitized.nested as Record<string, unknown>).aesKey)).toContain('...(');
    expect(sanitized.url).toBe('https://example.com/path');
  });

  it('fails on ambiguous outbound account resolution', async () => {
    const bot = new AgentLinkWechat({ dataDir: root, credentials });
    const store = (bot as any).store;
    await store.ensure();

    const second: Credentials = {
      ...credentials,
      botId: 'fedcba654321@im.bot',
      botToken: 'fedcba654321@im.bot:another-secret-token',
      userId: 'owner-2@im.wechat',
    };

    const firstAccountId = sanitizeAccountId(credentials.botId);
    const secondAccountId = sanitizeAccountId(second.botId);
    await store.saveCredentials(credentials);
    await store.saveCredentials(second);
    await store.saveContextToken(firstAccountId, 'peer@im.wechat', 'ctx-1');
    await store.saveContextToken(secondAccountId, 'peer@im.wechat', 'ctx-2');

    await expect((bot as any).resolveOutboundAccount('peer@im.wechat')).rejects.toThrow('Ambiguous account');
  });
});
