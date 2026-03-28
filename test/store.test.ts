import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/storage/store.js';
import type { Credentials } from '../src/types/api.js';
import { sanitizeAccountId } from '../src/utils/ids.js';

describe('Store', () => {
  let root: string;
  let store: Store;
  let credentials: Credentials;
  let accountId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentlink-wechat-'));
    store = new Store(root);
    credentials = {
      botToken: 'token',
      botId: 'abc@im.bot',
      userId: 'user@im.wechat',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      savedAt: Date.now(),
    };
    accountId = sanitizeAccountId(credentials.botId);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('persists credentials, cursor, context token and allow list', async () => {
    await store.saveCredentials(credentials);
    await store.saveCursor(accountId, 'cursor-1');
    await store.saveContextToken(accountId, credentials.userId, 'ctx-1');
    await store.addAllowFrom(accountId, credentials.userId);

    await expect(store.loadCredentials(accountId)).resolves.toEqual(credentials);
    await expect(store.loadCursor(accountId)).resolves.toBe('cursor-1');
    await expect(store.getContextToken(accountId, credentials.userId)).resolves.toBe('ctx-1');
    await expect(store.getAllowFrom(accountId)).resolves.toEqual([credentials.userId]);
  });

  it('replaces old account for same user', async () => {
    const next = {
      ...credentials,
      botId: 'new@im.bot',
    };
    const nextId = sanitizeAccountId(next.botId);

    await store.saveCredentials(credentials);
    await store.saveCredentials(next);

    await expect(store.loadCredentials(accountId)).resolves.toBeNull();
    await expect(store.loadCredentials(nextId)).resolves.toEqual(next);
    await expect(store.listAccounts()).resolves.toEqual([nextId]);
  });
});
