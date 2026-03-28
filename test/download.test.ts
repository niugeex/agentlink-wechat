import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadMessageMedia } from '../src/media/download.js';
import { encryptAes128Ecb } from '../src/media/crypto.js';
import { MessageItemType } from '../src/types/api.js';

describe('downloadMessageMedia', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentlink-wechat-download-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('downloads and decrypts image media with hex aeskey', async () => {
    const plaintext = Buffer.from('hello media');
    const aesHex = '00112233445566778899aabbccddeeff';
    const encrypted = encryptAes128Ecb(plaintext, Buffer.from(aesHex, 'hex'));
    const destination = join(root, 'image.bin');

    await downloadMessageMedia({
      http: {
        download: async () => new Response(encrypted, { status: 200 }),
      } as never,
      item: {
        type: MessageItemType.IMAGE,
        image_item: {
          aeskey: aesHex,
          media: { encrypt_query_param: 'download-param' },
        },
      },
      destination,
      cdnBaseUrl: 'https://cdn.example.com/c2c',
    });

    await expect(readFile(destination)).resolves.toEqual(plaintext);
  });

  it('downloads and decrypts file media with base64 wrapped hex key', async () => {
    const plaintext = Buffer.from('hello file media');
    const aesHex = '00112233445566778899aabbccddeeff';
    const aesBase64 = Buffer.from(aesHex, 'utf8').toString('base64');
    const encrypted = encryptAes128Ecb(plaintext, Buffer.from(aesHex, 'hex'));
    const destination = join(root, 'file.bin');

    await downloadMessageMedia({
      http: {
        download: async () => new Response(encrypted, { status: 200 }),
      } as never,
      item: {
        type: MessageItemType.FILE,
        file_item: {
          media: { encrypt_query_param: 'download-param', aes_key: aesBase64 },
        },
      },
      destination,
      cdnBaseUrl: 'https://cdn.example.com/c2c',
    });

    await expect(readFile(destination)).resolves.toEqual(plaintext);
  });
});
