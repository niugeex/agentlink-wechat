import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileMessageItem, createImageMessageItem, createMediaMessageItem, createVideoMessageItem, uploadMediaFile } from '../src/media/upload.js';
import { UploadMediaType } from '../src/types/api.js';

describe('uploadMediaFile', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentlink-wechat-upload-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uploads image media and builds image payload', async () => {
    const filePath = join(root, 'image.png');
    await writeFile(filePath, Buffer.from('hello image'));

    const uploads: Array<{ url: string; method: string; size: number }> = [];
    const uploaded = await uploadMediaFile({
      http: {
        post: async () => ({ upload_param: 'param-1' }),
        upload: async (url: string, body: Buffer, _headers: Record<string, string>, method: 'POST' | 'PUT') => {
          uploads.push({ url, method, size: body.length });
          return new Response('', { status: 200, headers: { 'x-encrypted-param': 'download-1' } });
        },
      } as never,
      filePath,
      toUserId: 'user@im.wechat',
      channelVersion: '2.1.1',
      cdnBaseUrl: 'https://cdn.example.com/c2c',
    });

    expect(uploaded.mediaType).toBe(UploadMediaType.IMAGE);
    expect(uploads[0].url).toContain('encrypted_query_param=param-1');
    expect(uploads[0].method).toBe('POST');

    const item = createImageMessageItem(uploaded);
    expect(item.image_item.media?.encrypt_query_param).toBe('download-1');
    expect(item.image_item.aeskey).toBe(uploaded.aesKeyHex);
  });

  it('uploads generic files and builds file payload', async () => {
    const filePath = join(root, 'notes.txt');
    await writeFile(filePath, Buffer.from('hello file'));

    const uploaded = await uploadMediaFile({
      http: {
        post: async () => ({ upload_full_url: 'https://upload.example.com/file' }),
        upload: async () => new Response('', { status: 200, headers: { 'x-encrypted-param': 'download-2' } }),
      } as never,
      filePath,
      toUserId: 'user@im.wechat',
      channelVersion: '2.1.1',
    });

    expect(uploaded.mediaType).toBe(UploadMediaType.FILE);
    const item = createFileMessageItem(uploaded);
    expect(item.file_item.file_name).toBe('notes.txt');
    expect(item.file_item.media?.encrypt_query_param).toBe('download-2');
    expect(createMediaMessageItem(uploaded).type).toBe(4);
  });

  it('uploads videos and builds video payload', async () => {
    const filePath = join(root, 'clip.mp4');
    await writeFile(filePath, Buffer.from('hello video'));

    const uploaded = await uploadMediaFile({
      http: {
        post: async () => ({ upload_full_url: 'https://upload.example.com/video' }),
        upload: async () => new Response('', { status: 200, headers: { 'x-encrypted-param': 'download-3' } }),
      } as never,
      filePath,
      toUserId: 'user@im.wechat',
      channelVersion: '2.1.1',
    });

    expect(uploaded.mediaType).toBe(UploadMediaType.VIDEO);
    const item = createVideoMessageItem(uploaded);
    expect(item.video_item.media?.encrypt_query_param).toBe('download-3');
    expect(item.video_item.video_size).toBe(uploaded.ciphertextSize);
    expect(createMediaMessageItem(uploaded).type).toBe(5);
  });
});
