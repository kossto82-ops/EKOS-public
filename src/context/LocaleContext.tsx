/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { en, TranslationDict } from '../locales/en';

export type LocaleCode = 'en' | 'de' | 'fr' | 'nl' | 'it' | 'es' | 'ja' | 'th';

export const SUPPORTED_LOCALES: { code: LocaleCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'it', label: 'Italiano' },
  { code: 'es', label: 'Español' },
  { code: 'ja', label: '日本語' },
  { code: 'th', label: 'ไทย' },
];

// English ships eagerly since it's always the first-visit default.
// Every other locale is lazy-loaded on demand the first time it's selected,
// then cached in memory for the rest of the session.
const loadedDictionaries: Partial<Record<LocaleCode, TranslationDict>> = { en };

async function loadDictionary(locale: LocaleCode): Promise<TranslationDict> {
  if (loadedDictionaries[locale]) return loadedDictionaries[locale]!;

  let mod: { [key: string]: TranslationDict };
  switch (locale) {
    case 'de': mod = await import('../locales/de'); break;
    case 'fr': mod = await import('../locales/fr'); break;
    case 'nl': mod = await import('../locales/nl'); break;
    case 'it': mod = await import('../locales/it'); break;
    case 'es': mod = await import('../locales/es'); break;
    case 'ja': mod = await import('../locales/ja'); break;
    case 'th': mod = await import('../locales/th'); break;
    default: return en;
  }
  const dict = mod[locale];
  loadedDictionaries[locale] = dict;
  return dict;
}

interface LocaleContextType {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
  /** Resolve a dotted path to a translated array (e.g. quick-action lists). Falls back to English, then []. */
  getList: <T = any>(path: string) => T[];
  isLocaleLoading: boolean;
}

export const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<LocaleCode>(() => {
    // Guarded: LocaleProvider is the outermost provider (see main.tsx), so an
    // unguarded localStorage read that throws (private mode / partitioned
    // storage) would crash the entire app at mount. Mirror the try/catch the
    // Auth/Brand/Department providers already use.
    try {
      const saved = localStorage.getItem('locale') as LocaleCode | null;
      if (saved && ['en', 'de', 'fr', 'nl', 'it', 'es', 'ja', 'th'].includes(saved || '')) {
        return saved as LocaleCode;
      }
    } catch (e) {}
    return 'en';
  });
  const [activeDict, setActiveDict] = useState<TranslationDict>(en);
  const [isLocaleLoading, setIsLocaleLoading] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Tracks the most recently requested locale so a slow lazy import that
  // resolves after the user has already switched again cannot overwrite the
  // active dictionary with a stale language (en->de loading, then de->fr: if
  // de resolves last it must NOT win). Same guard shape as BrandContext's
  // isMounted / useAssistantSearch's request-id.
  const latestLocaleRef = useRef<LocaleCode>(locale);

  useEffect(() => {
    latestLocaleRef.current = locale;
    document.documentElement.lang = locale;

    if (loadedDictionaries[locale]) {
      setActiveDict(loadedDictionaries[locale]!);
      return;
    }

    const requested = locale;
    const isStale = () => !isMountedRef.current || latestLocaleRef.current !== requested;

    setIsLocaleLoading(true);
    loadDictionary(requested)
      .then(dict => {
        if (isStale()) return;
        setActiveDict(dict);
      })
      .catch(err => {
        // Chunk failed to load (e.g. stale bundle after a redeploy) — fall
        // back to English rather than leaving isLocaleLoading stuck true.
        console.error(`Failed to load locale "${requested}":`, err);
        if (isStale()) return;
        setActiveDict(en);
      })
      .finally(() => {
        // Clear the spinner only if this is still the in-flight request; a
        // superseded load must not flip loading off for the newer one.
        if (isStale()) return;
        setIsLocaleLoading(false);
      });
  }, [locale]);

  const setLocale = useCallback((newLocale: LocaleCode) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem('locale', newLocale);
    } catch (e) {}
  }, []);

  const t = useCallback((path: string, vars?: Record<string, string | number>): string => {
    const keys = path.split('.');
    const resolve = (dict: any) => keys.reduce((v, k) => v?.[k], dict);
    let value: any = resolve(activeDict);
    // Missing in the active locale → fall back to English (matches getList),
    // and only then to the raw path, so a dropped key degrades to readable
    // English rather than surfacing a debug-looking "a.b.c" token to the user.
    if (typeof value !== 'string') {
      const fromEn = resolve(en);
      value = typeof fromEn === 'string' ? fromEn : undefined;
    }
    let result = typeof value === 'string' ? value : path;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, String(v));
      });
    }
    return result;
  }, [activeDict]);

  const getList = useCallback(<T = any,>(path: string): T[] => {
    const resolve = (dict: any): any => path.split('.').reduce((v, k) => v?.[k], dict);
    const fromActive = resolve(activeDict);
    if (Array.isArray(fromActive)) return fromActive as T[];
    const fromEn = resolve(en);
    return Array.isArray(fromEn) ? (fromEn as T[]) : [];
  }, [activeDict]);

  const value = useMemo(
    () => ({ locale, setLocale, t, getList, isLocaleLoading }),
    [locale, setLocale, t, getList, isLocaleLoading]
  );

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
};

export const useLocale = () => {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider');
  return ctx;
};
