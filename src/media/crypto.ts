import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { MediaError } from '../errors.js';

export function parseAesKey(raw: string): Buffer {
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 16) {
    return decoded;
  }
  const hex = decoded.toString('ascii');
  if (/^[0-9a-f]{32}$/i.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  throw new MediaError('Unknown AES key format');
}

export function encryptAes128Ecb(data: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

export function decryptAes128Ecb(data: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function createMediaEncryptionMaterial(): { fileKeyHex: string; aesKeyHex: string; aesKey: Buffer } {
  const aesKey = randomBytes(16);
  return {
    fileKeyHex: randomBytes(16).toString('hex'),
    aesKeyHex: aesKey.toString('hex'),
    aesKey,
  };
}
