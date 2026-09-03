import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { encryptValue, decryptValue } from '../src/server/crypto';

/**
 * Guards the AES-256-GCM + per-value-salt scheme that replaced AES-256-CBC with
 * the static 'salt' (S2 backlog). Covers the round trip, that GCM actually
 * authenticates (tampering must fail closed rather than returning garbage), that
 * each value gets its own salt/IV, and that legacy v1 values still decrypt so
 * provider keys stored before the upgrade keep working.
 */

const SECRET = process.env.ENCRYPTION_SECRET || 'dev-only-fallback-change-in-production';

describe('encryptValue / decryptValue — v2 (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const secret = 'AIzaSy-not-a-real-key-1234567890';
    expect(decryptValue(encryptValue(secret))).toBe(secret);
  });

  it('emits the versioned 5-part format and never leaks the plaintext', () => {
    const enc = encryptValue('super-secret-key');
    const parts = enc.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('v2');
    expect(enc).not.toContain('super-secret-key');
  });

  it('uses a fresh salt and IV per value (identical inputs differ)', () => {
    const a = encryptValue('same-input');
    const b = encryptValue('same-input');
    expect(a).not.toBe(b);
    const [, saltA, ivA] = a.split(':');
    const [, saltB, ivB] = b.split(':');
    expect(saltA).not.toBe(saltB);
    expect(ivA).not.toBe(ivB);
    // Both still decrypt to the same plaintext.
    expect(decryptValue(a)).toBe('same-input');
    expect(decryptValue(b)).toBe('same-input');
  });

  it('fails closed when the ciphertext is tampered with (GCM auth tag)', () => {
    const enc = encryptValue('tamper-me-please');
    const parts = enc.split(':');
    // Flip the last hex nibble of the ciphertext.
    const ct = parts[4];
    parts[4] = ct.slice(0, -1) + (ct.slice(-1) === '0' ? '1' : '0');
    expect(() => decryptValue(parts.join(':'))).toThrow();
  });

  it('fails closed when the auth tag is wrong', () => {
    const parts = encryptValue('another-secret').split(':');
    parts[3] = '0'.repeat(parts[3].length);
    expect(() => decryptValue(parts.join(':'))).toThrow();
  });

  it('rejects an unrecognized format', () => {
    expect(() => decryptValue('not-encrypted')).toThrow(/Unrecognized/);
    expect(() => decryptValue('v9:a:b:c:d')).toThrow(/Unrecognized/);
  });
});

describe('backward compatibility — legacy v1 (AES-256-CBC, static salt)', () => {
  /** Reproduces exactly how v1 values were written, to prove they still read. */
  function encryptV1(text: string): string {
    const legacyKey = crypto.scryptSync(SECRET, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', legacyKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  it('still decrypts a key stored under the old scheme', () => {
    const legacy = encryptV1('pre-upgrade-provider-key');
    expect(legacy.split(':')).toHaveLength(2);
    expect(decryptValue(legacy)).toBe('pre-upgrade-provider-key');
  });

  it('the "is it encrypted?" heuristic used by the routes still holds', () => {
    // governance.ts / aiClient.ts gate decryption on the value containing ':'.
    expect(encryptValue('x')).toContain(':');
    expect(encryptV1('x')).toContain(':');
  });
});
