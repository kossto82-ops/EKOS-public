import React, { useEffect, useCallback, useState } from 'react';
import { Settings, X, Bot, AlertTriangle } from 'lucide-react';
import { useGovernancePanelContext } from './GovernancePanelContext';
import { useBrand } from '../../../hooks/useBrand';
import { useLocale } from '../../../context/LocaleContext';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { OVERLAY_SCRIM, OVERLAY_Z } from '../../shared/DesignSystem';

export const GovernanceSandboxModal: React.FC = () => {
  const { activeBrand } = useBrand();
  const { t } = useLocale();
  const {
    activeSandboxGap,
    setActiveSandboxGap,
    sandboxFilename,
    setSandboxFilename,
    sandboxContent,
    setSandboxContent,
    sandboxOwner,
    setSandboxOwner,
    sandboxScope,
    setSandboxScope,
    handleSaveSandboxAddendum,
  } = useGovernancePanelContext();

  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  const handleClose = useCallback(() => {
    if (sandboxContent.trim()) {
      setShowUnsavedConfirm(true);
      return;
    }
    setActiveSandboxGap(null);
  }, [sandboxContent, setActiveSandboxGap]);

  const trapRef = useFocusTrap<HTMLDivElement>(!!activeSandboxGap);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  if (!activeSandboxGap) return null;

  return (
    <div className={`fixed inset-0 ${OVERLAY_Z} flex items-center justify-center p-4 ${OVERLAY_SCRIM}`}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sandbox-modal-title"
        tabIndex={-1}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 focus:outline-none"
      >
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-brand-500 animate-spin" />
            <span id="sandbox-modal-title" className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider font-mono">
              {t('sandbox.title')}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1"
            aria-label={t('sandbox.closeAria')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {showUnsavedConfirm && (
          <div className="px-4 py-3 bg-warning-50 dark:bg-warning-950/20 border-b border-warning-200 dark:border-warning-900/40 flex items-center justify-between gap-3 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 text-warning-800 dark:text-warning-300">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span className="text-xs font-semibold">You have unsaved content. Close without saving?</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setActiveSandboxGap(null)}
                className="px-2.5 py-1 rounded bg-warning-600 hover:bg-warning-700 text-white text-2xs font-bold cursor-pointer transition-colors"
              >
                Close without saving
              </button>
              <button
                type="button"
                onClick={() => setShowUnsavedConfirm(false)}
                className="px-2.5 py-1 rounded bg-white dark:bg-slate-900 border border-warning-200 dark:border-warning-900/60 text-warning-800 dark:text-warning-300 text-2xs font-bold cursor-pointer transition-colors"
              >
                Keep editing
              </button>
            </div>
          </div>
        )}

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-sans bg-slate-50/50 dark:bg-slate-950/30 p-3 rounded-lg border border-slate-100 dark:border-slate-800/80 text-left">
            {t('sandbox.explanation', { query: activeSandboxGap.query, brand: activeBrand.displayName })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
            <div className="space-y-1">
              <label
                htmlFor="sandboxFilename"
                className="text-3xs text-slate-400 uppercase font-bold font-mono tracking-wider block"
              >
                {t('sandbox.filenameLabel')}
              </label>
              <input
                id="sandboxFilename"
                type="text"
                value={sandboxFilename}
                onChange={(e) => setSandboxFilename(e.target.value)}
                className="w-full text-xs rounded border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-hidden dark:border-slate-800 dark:bg-slate-950 dark:text-white font-mono font-bold"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="sandboxOwner"
                className="text-3xs text-slate-400 uppercase font-bold font-mono tracking-wider block"
              >
                {t('sandbox.ownerLabel')}
              </label>
              <input
                id="sandboxOwner"
                type="text"
                value={sandboxOwner}
                onChange={(e) => setSandboxOwner(e.target.value)}
                placeholder={t('sandbox.ownerPlaceholder')}
                className="w-full text-xs rounded border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-hidden dark:border-slate-800 dark:bg-slate-950 dark:text-white font-sans"
              />
            </div>
          </div>

          <div className="space-y-1.5 text-left">
            <span className="text-3xs text-slate-400 uppercase font-bold font-mono tracking-wider block">
              {t('sandbox.scopeLabel')}
            </span>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-800 dark:text-slate-200 select-none font-sans">
                <input
                  type="radio"
                  name="sandboxScope"
                  checked={sandboxScope === 'brand'}
                  onChange={() => setSandboxScope('brand')}
                  className="text-brand-600 focus:ring-brand-500 cursor-pointer text-xs"
                />
                <span>{t('sandbox.scopeBrandOnly', { brand: activeBrand.displayName })}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-800 dark:text-slate-200 select-none font-sans">
                <input
                  type="radio"
                  name="sandboxScope"
                  checked={sandboxScope === 'global'}
                  onChange={() => setSandboxScope('global')}
                  className="text-brand-600 focus:ring-brand-500 cursor-pointer text-xs"
                />
                <span>{t('sandbox.scopeGlobal')}</span>
              </label>
            </div>
          </div>

          <div className="space-y-1 text-left">
            <div className="flex items-center justify-between">
              <label
                htmlFor="sandboxRulesTextarea"
                className="text-3xs text-slate-400 uppercase font-bold font-mono tracking-wider block font-semibold"
              >
                {t('sandbox.scriptLabel')}
              </label>
              <span className="text-4xs text-success-600 font-mono font-bold uppercase">
                {t('sandbox.readyToCompile')}
              </span>
            </div>
            <textarea
              id="sandboxRulesTextarea"
              rows={9}
              value={sandboxContent}
              onChange={(e) => setSandboxContent(e.target.value)}
              placeholder={t('sandbox.contentPlaceholder')}
              className="w-full text-xs rounded border border-slate-300 bg-white p-3 focus:outline-hidden dark:border-slate-800 dark:bg-slate-950 dark:text-white font-mono leading-relaxed text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="text-3xs text-slate-400 leading-relaxed flex items-start gap-1.5 bg-brand-50/55 dark:bg-brand-950/20 border border-brand-100 dark:border-brand-900/40 p-3 rounded-lg font-sans text-left">
            <Bot className="h-4 w-4 text-brand-500 flex-shrink-0 mt-0.5" />
            <span>
              {t('sandbox.aiExplanation')}
            </span>
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-3 py-1.5 rounded bg-white hover:bg-slate-100 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-800 dark:text-slate-200 text-xs font-bold border border-slate-300 dark:border-slate-700 cursor-pointer transition-colors"
          >
            {t('sandbox.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSaveSandboxAddendum}
            className="px-4 py-1.5 rounded bg-slate-900 hover:bg-slate-800 dark:bg-brand-600 dark:hover:bg-brand-700 text-white text-xs font-bold cursor-pointer transition-colors"
          >
            {t('sandbox.submit')}
          </button>
        </div>
      </div>
    </div>
  );
};
