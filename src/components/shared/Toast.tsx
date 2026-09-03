/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { ToastMessage, ToastType } from '../../hooks/useToast';
import { Check, Info, X, AlertCircle } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

export const ToastContainer: React.FC = () => {
  const { t } = useLocale();
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  // Track auto-dismiss timers so they can be cleared on manual dismiss and on
  // unmount (previously the setTimeout was fire-and-forget — a latent leak and
  // a setState-after-unmount if the container tore down with toasts pending).
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const handleAddToast = (event: Event) => {
      const customEvent = event as CustomEvent<ToastMessage>;
      if (customEvent.detail) {
        const { id, message, type, duration = 3500 } = customEvent.detail;

        // Append to list
        setMessages(prev => [...prev, { id, message, type, duration }]);

        // Automatic dismissal
        timersRef.current[id] = setTimeout(() => {
          setMessages(prev => prev.filter(item => item.id !== id));
          delete timersRef.current[id];
        }, duration);
      }
    };

    window.addEventListener('portal_toast_event', handleAddToast);
    const timers = timersRef.current;
    return () => {
      window.removeEventListener('portal_toast_event', handleAddToast);
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const removeToast = (id: string) => {
    const timer = timersRef.current[id];
    if (timer) { clearTimeout(timer); delete timersRef.current[id]; }
    setMessages(prev => prev.filter(item => item.id !== id));
  };

  const getToastStyles = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-[#020617] text-white border-slate-800',
          text: 'text-white',
          icon: <Check className="h-4 w-4 text-success-400" />
        };
      case 'error':
        return {
          bg: 'bg-red-950 border-red-800',
          text: 'text-red-200',
          icon: <AlertCircle className="h-4 w-4 text-red-400" />
        };
      case 'warning':
      case 'info':
      default:
        return {
          bg: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
          text: 'text-slate-700 dark:text-zinc-300',
          icon: <Info className="h-4 w-4 text-blue-500 hover:text-blue-600" />
        };
    }
  };

  return (
    <div
      id="toast_container_portal"
      className="fixed right-5 bottom-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {messages.map((item) => {
        const styles = getToastStyles(item.type);
        return (
          <div
            key={item.id}
            style={{
              animation: 'toast-in 0.18s ease-out both',
            }}
            className={`flex items-start justify-between rounded-lg border p-3.5 shadow-xl backdrop-blur-xs font-sans text-xs pointer-events-auto ${styles.bg} ${styles.text}`}
            role="alert"
          >
            <div className="flex gap-2.5">
              <span className="flex-shrink-0 mt-0.5">{styles.icon}</span>
              <p className="font-semibold leading-relaxed">{item.message}</p>
            </div>
            <button
              onClick={() => removeToast(item.id)}
              aria-label={t('toast.dismissAria')}
              className="ml-3 flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
