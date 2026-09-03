/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext } from 'react';
import { Lock } from 'lucide-react';
import { AuthContext } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { LOCKSCREEN_Z } from './DesignSystem';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface IdleLockScreenProps {
  onUnlock: () => void;
}

export const IdleLockScreen: React.FC<IdleLockScreenProps> = ({ onUnlock }) => {
  const auth = useContext(AuthContext);
  const currentUser = auth?.currentUser;
  const { t } = useLocale();
  const trapRef = useFocusTrap<HTMLDivElement>();

  // Deliberately not OVERLAY_SCRIM. This one has to obscure the content behind it
  // rather than merely dim it, so it is heavier (90% and a stronger blur) and sits
  // at LOCKSCREEN_Z above the dialog layer — a lock screen a dialog can cover is
  // not a lock screen.
  return (
    <div className={`fixed inset-0 ${LOCKSCREEN_Z} flex items-center justify-center bg-slate-950/90 backdrop-blur-sm`}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="idle_lock_title"
        tabIndex={-1}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 max-w-sm w-full mx-4 text-center focus:outline-none"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mb-4 mx-auto">
          <Lock className="h-5 w-5" />
        </div>
        <h3 id="idle_lock_title" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          {t('idleLock.title')}
        </h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 mb-5">
          {currentUser?.name || 'This session'} {t('idleLock.body')}
        </p>
        <button
          onClick={onUnlock}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-md py-2 transition-colors"
        >
          {t('idleLock.continueAs')} {currentUser?.name || 'current user'}
        </button>
      </div>
    </div>
  );
};
