/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { OVERLAY_SCRIM, OVERLAY_Z } from './DesignSystem';
import { useLocale } from '../../context/LocaleContext';

// Module-level stack of open modals so that (a) Escape only closes the
// top-most dialog instead of collapsing the whole stack, and (b) body scroll
// is locked while any modal is open and restored only when the last closes.
const modalStack: symbol[] = [];

interface ModalProps {
  titleId: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  onClose: () => void;
  onSubmit?: (e: React.FormEvent) => void;
  maxWidthClassName?: string;
  closeAriaLabel?: string;
  children: React.ReactNode;
}

/**
 * Shared shell for centered dialogs: backdrop, focus trap, Escape-to-close,
 * and the role="dialog"/aria-modal/aria-labelledby wiring plus the repeated
 * icon+title+close header. When `onSubmit` is given (see ReportIssueModal),
 * the dialog semantics (role/aria-modal/focus trap) stay on the outer <div>
 * and an inner plain <form> handles submission — axe-core's
 * aria-allowed-role rule rejects role="dialog" directly on a <form> element,
 * so the two responsibilities are split across two elements instead.
 *
 * Not used by FullDocumentDrawer — that's a slide-over panel with a
 * different layout, not a centered dialog, so forcing it into this shell
 * would add complexity without shared structure to justify it.
 */
export const Modal: React.FC<ModalProps> = ({
  titleId,
  title,
  icon,
  onClose,
  onSubmit,
  maxWidthClassName = 'max-w-lg',
  closeAriaLabel,
  children,
}) => {
  const { t } = useLocale();
  // Callers (e.g. PolicyManager) may override this with a more specific
  // label; every other consumer relies on this localized default instead of
  // the previous hardcoded English literal.
  const resolvedCloseAriaLabel = closeAriaLabel ?? t('common.closeDialog');
  const trapRef = useFocusTrap<HTMLElement>();
  const tokenRef = useRef<symbol>(Symbol('modal'));

  useEffect(() => {
    const token = tokenRef.current;
    modalStack.push(token);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only the top-most modal reacts to Escape.
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === token) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const i = modalStack.indexOf(token);
      if (i >= 0) modalStack.splice(i, 1);
      // Restore scroll only once the last modal has closed.
      if (modalStack.length === 0) document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const dialogClassName = `bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 ${maxWidthClassName} w-full space-y-4 text-left animate-scaleUp focus:outline-none`;

  const header = (
    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
      <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <button
        type="button"
        onClick={onClose}
        aria-label={resolvedCloseAriaLabel}
        className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className={`fixed inset-0 ${OVERLAY_SCRIM} flex items-center justify-center p-4 ${OVERLAY_Z} animate-fadeIn`}>
      <div
        ref={trapRef as React.Ref<HTMLDivElement>}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={dialogClassName}
      >
        {onSubmit ? (
          <form onSubmit={onSubmit} className="space-y-4">
            {header}
            {children}
          </form>
        ) : (
          <>
            {header}
            {children}
          </>
        )}
      </div>
    </div>
  );
};
