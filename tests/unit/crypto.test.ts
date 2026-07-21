import { describe, it, expect, beforeEach } from 'vitest';
import { encryptSecret, decryptSecret, isEncryptionConfigured } from '../../server/crypto';

// getKey() reads process.env at call time, so toggling the env per test works.
describe('secret encryption (server/crypto)', () => {
  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('round-trips a secret when a 32-byte key is configured', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
    const secret = 'shpat_supersecrettoken:consumer:123';
    const enc = encryptSecret(secret);
    expect(enc).not.toBe(secret);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('produces different ciphertext each time (random IV) but decrypts to the same value', () => {
    process.env.ENCRYPTION_KEY = 'c'.repeat(64);
    const a = encryptSecret('token');
    const b = encryptSecret('token');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('token');
    expect(decryptSecret(b)).toBe('token');
  });

  it('is a no-op when no key is configured (dev/legacy)', () => {
    expect(isEncryptionConfigured()).toBe(false);
    expect(encryptSecret('token')).toBe('token');
  });

  it('returns legacy plaintext (no enc:v1: prefix) unchanged on decrypt', () => {
    process.env.ENCRYPTION_KEY = 'd'.repeat(64);
    expect(decryptSecret('legacy-plaintext-token')).toBe('legacy-plaintext-token');
  });

  it('does not double-encrypt an already-encrypted value', () => {
    process.env.ENCRYPTION_KEY = 'e'.repeat(64);
    const enc = encryptSecret('token');
    expect(encryptSecret(enc)).toBe(enc);
  });

  it('ignores an invalid-length key (treats as unconfigured)', () => {
    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(isEncryptionConfigured()).toBe(false);
    expect(encryptSecret('token')).toBe('token');
  });
});
