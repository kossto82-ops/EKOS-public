import { describe, it, expect } from 'vitest';
import { en } from '../src/locales/en';
import { es } from '../src/locales/es';
import { de } from '../src/locales/de';
import { fr } from '../src/locales/fr';
import { it as itDict } from '../src/locales/it';
import { ja } from '../src/locales/ja';
import { nl } from '../src/locales/nl';
import { th } from '../src/locales/th';
import { BRANDS } from '../src/constants/brands';
import { getBrandHexColor } from '../src/utils/brandUtils';

/**
 * S6 (Brands, Departments & i18n) regression guards.
 *
 * Locks in three fixes so they cannot silently drift back:
 *  1. Every locale keeps the exact key structure of English (catches drift).
 *  2. Every brand `color` resolves to a real hex — no brand silently falling
 *     back to the indigo default because COLOR_MAP is missing its color.
 *  3. The `dispatch.*` option labels are actually translated in the two
 *     non-Latin locales (ja/th), where an untranslated value is unambiguous.
 */

const LOCALES: Record<string, any> = { es, de, fr, it: itDict, ja, nl, th };
const INDIGO_FALLBACK = '#6366f1';

function flatKeys(obj: any, prefix = ''): string[] {
  let keys: string[] = [];
  for (const k in obj) {
    const v = obj[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) keys = keys.concat(flatKeys(v, path));
    else keys.push(path);
  }
  return keys;
}
function resolve(dict: any, path: string): any {
  return path.split('.').reduce((v, k) => v?.[k], dict);
}

describe('i18n — structural key parity with English', () => {
  const enKeys = new Set(flatKeys(en));
  for (const [code, dict] of Object.entries(LOCALES)) {
    it(`${code} has exactly the same keys as en`, () => {
      const keys = new Set(flatKeys(dict));
      const missing = [...enKeys].filter(k => !keys.has(k));
      const extra = [...keys].filter(k => !enKeys.has(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });
  }
});

describe('brandUtils — every brand color maps to a real hex (S6 COLOR_MAP coverage)', () => {
  for (const b of BRANDS) {
    it(`${b.id} (color: ${b.color}) does not silently fall back to indigo`, () => {
      const hex = getBrandHexColor(b.id, BRANDS);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      // 'indigo' is the one color whose real value IS the fallback hex; every
      // other declared color must resolve to something different.
      if (b.color !== 'indigo') expect(hex).not.toBe(INDIGO_FALLBACK);
    });
  }
});

describe('i18n — dispatch.* option labels are translated in ja/th', () => {
  const DISPATCH_KEYS = [
    'dispatch.ownerOptions.commercialDirector',
    'dispatch.ownerOptions.telecomSpecialist',
    'dispatch.ownerOptions.itSupportLead',
    'dispatch.ownerOptions.cxCoordinator',
    'dispatch.ownerOptions.systemsAdmin',
    'dispatch.ownerOptions.billingSpecialist',
    'dispatch.deptOptions.financeDe',
    'dispatch.deptOptions.itSupportEs',
    'dispatch.deptOptions.marketingFr',
    'dispatch.deptOptions.operationsDe',
    'dispatch.deptOptions.corporateLegal',
    'dispatch.deptOptions.globalAdmin',
  ];
  for (const code of ['ja', 'th']) {
    for (const key of DISPATCH_KEYS) {
      it(`${code}: ${key} differs from the English value`, () => {
        const enVal = resolve(en, key);
        const locVal = resolve(LOCALES[code], key);
        expect(typeof locVal).toBe('string');
        expect(locVal).not.toBe(enVal);
      });
    }
  }
});
