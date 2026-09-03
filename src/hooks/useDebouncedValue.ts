/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` of
 * no further changes — used to avoid re-running expensive filter/sort work
 * on every keystroke in a search input.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
