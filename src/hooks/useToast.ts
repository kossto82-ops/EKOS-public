/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export function useToast() {
  const toast = useCallback((message: string, type: ToastType = 'info', duration = 3500) => {
    const id = Math.random().toString(36).substring(2, 9);
    const event = new CustomEvent('portal_toast_event', {
      detail: { id, message, type, duration }
    });
    window.dispatchEvent(event);
  }, []);

  const success = useCallback((msg: string, duration?: number) => toast(msg, 'success', duration), [toast]);
  const error = useCallback((msg: string, duration?: number) => toast(msg, 'error', duration), [toast]);
  const info = useCallback((msg: string, duration?: number) => toast(msg, 'info', duration), [toast]);
  const warning = useCallback((msg: string, duration?: number) => toast(msg, 'warning', duration), [toast]);

  // Memoized so consumers that put this return value (or one of its methods)
  // in a dependency array — e.g. an effect that binds a window listener —
  // don't re-run on every render just because a new object was returned.
  return useMemo(
    () => ({ toast, success, error, info, warning }),
    [toast, success, error, info, warning]
  );
}
