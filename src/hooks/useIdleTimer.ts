/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const IDLE_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];

export function useIdleTimer() {
  const [isLocked, setIsLocked] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsLocked(true), IDLE_LIMIT_MS);
  }, []);

  useEffect(() => {
    resetTimer();
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, resetTimer));

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, resetTimer));
    };
  }, [resetTimer]);

  // Re-arm a fresh idle window immediately on unlock — otherwise no timer is
  // actively counting until the next qualifying activity event, leaving
  // idle detection effectively disabled right after the user unlocks.
  const unlock = useCallback(() => {
    setIsLocked(false);
    resetTimer();
  }, [resetTimer]);

  return { isLocked, unlock };
}
