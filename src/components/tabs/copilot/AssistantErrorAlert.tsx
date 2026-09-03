/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useLocale } from '../../../context/LocaleContext';
import { ApiError } from '../../../services/baseService';

interface AssistantErrorAlertProps {
  error: ApiError;
  onRetry: () => void;
}

/**
 * Enterprise error alert component presenting actionable feedback and
 * recovery options. Extracted from AssistantTab.
 */
export const AssistantErrorAlert: React.FC<AssistantErrorAlertProps> = ({ error, onRetry }) => {
  const { t } = useLocale();
  const isMissingApiKey =
    error.message?.includes('Missing Gemini API Key') ||
    error.details?.includes('Missing Gemini API Key') ||
    error.message?.toLowerCase().includes('api key') ||
    error.details?.toLowerCase().includes('api key');

  if (isMissingApiKey) {
    return (
      <div role="alert" className="w-full max-w-3xl mx-auto p-6 rounded-xl bg-warning-50/60 dark:bg-warning-950/20 border border-warning-100 dark:border-warning-900/40 text-left space-y-4 animate-fadeIn">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-warning-100/80 dark:bg-warning-900/40 text-warning-600 dark:text-warning-400 rounded-lg shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1.5 flex-1">
            <p className="text-sm font-bold text-warning-900 dark:text-warning-400 tracking-tight">
              {t('assistant.errors.apiKeyTitle')}
            </p>
            <p className="text-xs text-warning-800/90 dark:text-warning-300/80 leading-relaxed font-medium">
              {t('assistant.errors.apiKeyBody')}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-warning-100/50 dark:border-warning-900/20">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'settings' }))}
            className="px-4 py-2 bg-warning-600 hover:bg-warning-700 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer shadow-xs"
          >
            {t('assistant.errors.configureButton')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div role="alert" className="w-full max-w-3xl mx-auto p-6 rounded-xl bg-danger-50/60 dark:bg-danger-950/20 border border-danger-100 dark:border-danger-900/40 text-left space-y-4">
      <div className="flex items-start gap-4">
        <div className="p-2 bg-danger-100/80 dark:bg-danger-900/40 text-danger-600 dark:text-danger-400 rounded-lg shrink-0">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="space-y-1.5 flex-1">
          <p className="text-sm font-bold text-danger-900 dark:text-danger-400 tracking-tight">
            {t('assistant.errors.genericTitle')}
          </p>
          <p className="text-xs text-danger-700/90 dark:text-danger-300/80 leading-relaxed font-medium">
            {error.code === 'TIMEOUT' ? t('assistant.errors.timeoutMessage') : t('assistant.errors.genericMessage')}
          </p>
          <div className="text-3xs font-mono text-danger-600/70 dark:text-danger-400/60 pt-1 space-y-0.5">
            <div>{t('assistant.errors.errorCode')} {error.code}</div>
            <div>{t('assistant.errors.requestId')} {error.requestId}</div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1 border-t border-danger-100/50 dark:border-danger-900/20">
        <button
          onClick={onRetry}
          className="px-3.5 py-1.5 bg-danger-600 hover:bg-danger-700 active:bg-danger-800 dark:bg-danger-800 dark:hover:bg-danger-800 dark:active:bg-danger-900 text-white text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <RefreshCw className="h-3 w-3 animate-pulse" />
          {t('assistant.errors.retry')}
        </button>
      </div>
    </div>
  );
};
