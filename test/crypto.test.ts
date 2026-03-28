import { describe, expect, it } from 'vitest';
import { decryptAes128Ecb, encryptAes128Ecb, parseAesKey } from '../src/media/crypto.js';

describe('media crypto', () => {
  it('parses raw 16-byte base64 keys', () => {
    const key = Buffer.from('0123456789abcdef', 'utf8');
    expect(parseAesKey(key.toString('base64'))).toEqual(key);
  });

  it('parses base64-wrapped hex keys', () => {
    const hex = Buffer.from('00112233445566778899aabbccddeeff', 'ascii').toString('base64');
    expect(parseAesKey(hex)).toEqual(Buffer.from('00112233445566778899aabbccddeeff', 'hex'));
  });

  it('encrypts and decrypts symmetrically', () => {
    const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const plain = Buffer.from('hello world');
    const encrypted = encryptAes128Ecb(plain, key);
    const decrypted = decryptAes128Ecb(encrypted, key);
    expect(decrypted).toEqual(plain);
  });
});
