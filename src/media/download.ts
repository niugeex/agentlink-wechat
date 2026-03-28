import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DEFAULT_CDN_BASE_URL } from '../constants.js';
import { MediaError } from '../errors.js';
import type { ILinkHttpClient } from '../http/client.js';
import { decryptAes128Ecb, parseAesKey } from './crypto.js';
import { MessageItemType, type RawMessageItem } from '../types/api.js';

export async function downloadMessageMedia(params: {
  http: ILinkHttpClient;
  item: RawMessageItem;
  destination: string;
  cdnBaseUrl?: string;
  rootDir?: string;
}): Promise<string> {
  const { http, item, destination, cdnBaseUrl = DEFAULT_CDN_BASE_URL, rootDir } = params;
  const media = extractMedia(item);
  if (!media) {
    throw new MediaError('Message does not contain downloadable media');
  }

  const finalDestination = rootDir ? resolveDestination(rootDir, destination) : destination;
  const response = await http.download(buildDownloadUrl(media.url, media.queryParam, cdnBaseUrl));
  if (!response.ok) {
    throw new MediaError(`Media download failed with status ${response.status}`);
  }

  const encrypted = Buffer.from(await response.arrayBuffer());
  const buffer = media.aesKey ? decryptAes128Ecb(encrypted, media.aesKey) : encrypted;
  await mkdir(dirname(finalDestination), { recursive: true });
  await writeFile(finalDestination, buffer);
  return finalDestination;
}

export function resolveDestination(rootDir: string, destination: string): string {
  const resolvedRoot = resolve(rootDir);
  const resolvedDestination = resolve(rootDir, destination);
  if (resolvedDestination !== resolvedRoot && !resolvedDestination.startsWith(`${resolvedRoot}${sep}`)) {
    throw new MediaError('Destination escapes the configured data directory');
  }
  return resolvedDestination;
}

function extractMedia(item: RawMessageItem): { url?: string; queryParam?: string; aesKey?: Buffer } | null {
  switch (item.type) {
    case MessageItemType.IMAGE:
      return fromImage(item);
    case MessageItemType.FILE:
      return fromDescriptor(item.file_item?.media, item.file_item?.media?.aes_key);
    case MessageItemType.VIDEO:
      return fromDescriptor(item.video_item?.media, item.video_item?.media?.aes_key);
    case MessageItemType.VOICE:
      return fromDescriptor(item.voice_item?.media, item.voice_item?.media?.aes_key);
    default:
      return null;
  }
}

function fromImage(item: RawMessageItem): { url?: string; queryParam?: string; aesKey?: Buffer } | null {
  const descriptor = item.image_item?.media;
  if (!descriptor) {
    return null;
  }
  const queryParam = descriptor.encrypt_query_param ?? descriptor.encrypted_query_param;
  if (item.image_item?.aeskey) {
    return {
      url: descriptor.full_url,
      queryParam,
      aesKey: Buffer.from(item.image_item.aeskey, 'hex'),
    };
  }
  return fromDescriptor(descriptor, descriptor.aes_key);
}

function fromDescriptor(
  descriptor: { full_url?: string; encrypt_query_param?: string; encrypted_query_param?: string } | undefined,
  aesKeyBase64: string | undefined,
): { url?: string; queryParam?: string; aesKey?: Buffer } | null {
  if (!descriptor) {
    return null;
  }
  return {
    url: descriptor.full_url,
    queryParam: descriptor.encrypt_query_param ?? descriptor.encrypted_query_param,
    aesKey: aesKeyBase64 ? parseAesKey(aesKeyBase64) : undefined,
  };
}

function buildDownloadUrl(fullUrl: string | undefined, queryParam: string | undefined, cdnBaseUrl: string): string {
  if (fullUrl) {
    return fullUrl;
  }
  if (!queryParam) {
    throw new MediaError('Missing media download URL');
  }
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(queryParam)}`;
}
