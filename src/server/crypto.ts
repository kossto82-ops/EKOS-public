/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { logger } from "./logger.ts";

if (!process.env.ENCRYPTION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error(
    'ENCRYPTION_SECRET is not set. Refusing to start in production with a hardcoded ' +
    'encryption key, which would let anyone reading this source decrypt stored API keys.'
  );
}
if (!process.env.ENCRYPTION_SECRET) {
  logger.warn(
    '⚠️  ENCRYPTION_SECRET is not set — using a well-known development-only key. ' +
    'Stored API keys are NOT confidential until ENCRYPTION_SECRET is configured.'
  );
}

const SECRET = process.env.ENCRYPTION_SECRET || 'dev-only-fallback-change-in-production';

/**
 * Storage format (v2): `v2:<salt>:<iv>:<authTag>:<ciphertext>`, all hex.
 *
 * Upgraded from AES-256-CBC with the literal static salt 'salt' — that scheme
 * had two weaknesses: (1) CBC provides no integrity, so a stored ciphertext
 * could be tampered with undetected (and CBC padding oracles are a known class);
 * (2) a single fixed salt means one scrypt derivation protects every value, so
 * a precomputation against this well-known salt attacks all secrets at once.
 *
 * v2 uses AES-256-GCM (authenticated: tampering fails closed on the auth tag)
 * with a per-value random salt.
 *
 * Key derivation is two-stage on purpose. scrypt is deliberately slow (~100ms),
 * and `decryptValue` runs on EVERY outbound AI call (see aiClient.ts), so
 * deriving with scrypt per value would add that cost to every request. Instead
 * scrypt runs ONCE at module load to stretch the secret into a master key, then
 * each value derives its own subkey from that master key with the per-value salt
 * via HKDF-SHA256 (cheap). The slow-KDF work still happens where it matters —
 * once, against the human-supplied secret.
 */
const V2_PREFIX = 'v2';
const MASTER_KEY = crypto.scryptSync(SECRET, 'ekos-master-kdf-v2', 32);
/** Legacy key: scrypt with the old hardcoded 'salt', kept only to read v1 values. */
const LEGACY_KEY = crypto.scryptSync(SECRET, 'salt', 32);

function deriveSubkey(salt: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', MASTER_KEY, salt, 'ekos-aead-v2', 32));
}

export function encryptValue(text: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveSubkey(salt), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    V2_PREFIX,
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

export function decryptValue(text: string): string {
  const parts = (text || '').split(':');

  // v1 (legacy): `<iv>:<ciphertext>` — AES-256-CBC under the static-salt key.
  // Still readable so provider keys stored before the upgrade keep working; they
  // are re-written in v2 the next time the config is saved. Remove this branch
  // once no v1 values remain.
  if (parts.length === 2) {
    const [ivHex, encrypted] = parts;
    const decipher = crypto.createDecipheriv('aes-256-cbc', LEGACY_KEY, Buffer.from(ivHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  if (parts.length === 5 && parts[0] === V2_PREFIX) {
    const [, saltHex, ivHex, tagHex, ciphertextHex] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      deriveSubkey(Buffer.from(saltHex, 'hex')),
      Buffer.from(ivHex, 'hex')
    );
    // Fails closed: a wrong key or any tampering throws on final().
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  throw new Error('Unrecognized encrypted value format');
}
