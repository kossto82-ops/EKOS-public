/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';

/**
 * Small transient toast HUD used by the Assistant tab for one-off
 * confirmations (copy, download, feedback submitted, etc). Extracted from
 * AssistantTab.
 */
export function useAssistantToast() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToastMessage(message);
    timeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  return { toastMessage, showToast };
}
