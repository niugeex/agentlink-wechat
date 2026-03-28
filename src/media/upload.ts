import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CDN_BASE_URL } from '../constants.js';
import { MediaError } from '../errors.js';
import type { ILinkHttpClient } from '../http/client.js';
import { createMediaEncryptionMaterial, encryptAes128Ecb } from './crypto.js';
import { getContentType, getUploadMediaType } from '../utils/mime.js';
import { MessageItemType, type FileMessageItem, type GetUploadUrlResponse, type ImageMessageItem, type SendableMessageItem } from '../types/api.js';

export interface UploadedMedia {
  downloadEncryptedQueryParam: string;
  aesKeyHex: string;
  aesKeyBase64: string;
  fileKeyHex: string;
  fileSize: number;
  ciphertextSize: number;
  mediaType: number;
  fileName: string;
}

export async function uploadMediaFile(params: {
  http: ILinkHttpClient;
  filePath: string;
  toUserId: string;
  channelVersion: string;
  cdnBaseUrl?: string;
}): Promise<UploadedMedia> {
  const { http, filePath, toUserId, channelVersion, cdnBaseUrl = DEFAULT_CDN_BASE_URL } = params;
  const plaintext = await readFile(filePath);
  const { fileKeyHex, aesKeyHex, aesKey } = createMediaEncryptionMaterial();
  const rawfilemd5 = createHash('md5').update(plaintext).digest('hex');
  const ciphertext = encryptAes128Ecb(plaintext, aesKey);
  const mediaType = getUploadMediaType(filePath);

  const response = await http.post<GetUploadUrlResponse>('ilink/bot/getuploadurl', {
    filekey: fileKeyHex,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize: plaintext.length,
    rawfilemd5,
    filesize: ciphertext.length,
    no_need_thumb: true,
    aeskey: aesKeyHex,
    base_info: { channel_version: channelVersion },
  });

  const uploadUrl = buildUploadUrl(response, cdnBaseUrl, fileKeyHex);
  const uploaded = await uploadCiphertext(http, uploadUrl, ciphertext, getContentType(filePath));

  return {
    downloadEncryptedQueryParam: uploaded,
    aesKeyHex,
    aesKeyBase64: Buffer.from(aesKeyHex, 'utf8').toString('base64'),
    fileKeyHex,
    fileSize: plaintext.length,
    ciphertextSize: ciphertext.length,
    mediaType,
    fileName: basename(filePath),
  };
}

export function createImageMessageItem(uploaded: UploadedMedia): ImageMessageItem {
  return {
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: uploaded.aesKeyBase64,
        encrypt_type: 1,
      },
      aeskey: uploaded.aesKeyHex,
      mid_size: uploaded.ciphertextSize,
    },
  };
}

export function createFileMessageItem(uploaded: UploadedMedia): FileMessageItem {
  return {
    type: MessageItemType.FILE,
    file_item: {
      file_name: uploaded.fileName,
      len: String(uploaded.fileSize),
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: uploaded.aesKeyBase64,
        encrypt_type: 1,
      },
    },
  };
}

export function createMediaMessageItem(uploaded: UploadedMedia): SendableMessageItem {
  if (uploaded.mediaType === 1) {
    return createImageMessageItem(uploaded);
  }
  return createFileMessageItem(uploaded);
}

function buildUploadUrl(response: GetUploadUrlResponse, cdnBaseUrl: string, fileKeyHex: string): string {
  if (response.upload_full_url?.trim()) {
    return response.upload_full_url.trim();
  }
  if (response.upload_param) {
    return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(response.upload_param)}&filekey=${encodeURIComponent(fileKeyHex)}`;
  }
  throw new MediaError('Upload URL missing from getuploadurl response');
}

async function uploadCiphertext(http: ILinkHttpClient, uploadUrl: string, ciphertext: Buffer, contentType: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await http.upload(uploadUrl, ciphertext, { 'Content-Type': contentType }, 'POST');
    if (response.status >= 400 && response.status < 500) {
      throw new MediaError(`CDN upload failed with client error ${response.status}`);
    }
    if (response.status !== 200) {
      lastError = new MediaError(`CDN upload failed with server error ${response.status}`);
      if (attempt < 3) {
        continue;
      }
      throw lastError;
    }
    const downloadParam = response.headers.get('x-encrypted-param');
    if (!downloadParam) {
      throw new MediaError('CDN upload response missing x-encrypted-param');
    }
    return downloadParam;
  }
  throw lastError instanceof Error ? lastError : new MediaError('CDN upload failed');
}
