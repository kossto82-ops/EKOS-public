/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared resolution of stored AI-provider configuration.
 *
 * Both the chat client (aiClient.ts) and the embedding client (embeddings.ts)
 * need to read a governance-config row and decrypt the API key it holds. That
 * is security-sensitive code — a second hand-rolled copy is how a fail-open
 * branch sneaks in — so it lives here once.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/db.ts';
import { kbGovernanceConfigs } from '../db/schema.ts';
import { decryptValue } from './crypto.ts';
import { logger } from './logger.ts';

/** Masked keys are what the UI round-trips back; they are never usable. */
export function isMaskedKey(value: unknown): boolean {
  return typeof value === 'string' && value.includes('••••');
}

/**
 * Read and parse a governance-config JSON row. Returns null when the row is
 * absent or unparseable. Never log the result — it carries the provider apiKey.
 */
export function loadStoredProviderConfig(key: string): any | null {
  try {
    const record = db
      .select()
      .from(kbGovernanceConfigs)
      .where(eq(kbGovernanceConfigs.key, key))
      .all()[0];
    if (!record) return null;
    return JSON.parse(record.value);
  } catch (err) {
    logger.error({ err, configKey: key }, 'Failed to load stored provider config');
    return null;
  }
}

/**
 * Decrypt a stored API key. Values containing ':' are ciphertext from
 * crypto.ts; anything else is treated as plaintext (legacy rows).
 *
 * Fails CLOSED: a decryption failure yields '' rather than the raw ciphertext
 * blob, so the provider call errors cleanly instead of shipping a useless — but
 * still secret-derived — string to a remote host.
 */
export function resolveStoredApiKey(stored: unknown): string {
  if (typeof stored !== 'string' || stored === '' || isMaskedKey(stored)) return '';
  if (!stored.includes(':')) return stored;
  try {
    return decryptValue(stored);
  } catch (err) {
    logger.error({ err }, 'Failed to decrypt stored API key');
    return '';
  }
}
