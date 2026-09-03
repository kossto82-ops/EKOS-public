/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Share2, Copy, Check, MessageSquare } from 'lucide-react';
import { Modal } from '../../shared/Modal';
import { useLocale } from '../../../context/LocaleContext';

interface ShareResourceModalProps {
  shareUrl: string;
  copiedLink: boolean;
  onCopyLink: () => void;
  onClose: () => void;
}

/**
 * Share Verified Compliance Answer dialog for the Assistant tab. Extracted
 * from AssistantTab.
 */
export const ShareResourceModal: React.FC<ShareResourceModalProps> = ({ shareUrl, copiedLink, onCopyLink, onClose }) => {
  const { t } = useLocale();
  return (
    <Modal
      titleId="share_resource_title"
      title={t('assistant.shareModal.title')}
      icon={<Share2 className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
      onClose={onClose}
      maxWidthClassName="max-w-md"
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('assistant.shareModal.body')}
        </p>

        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            aria-label={t('assistant.shareModal.linkLabel')}
            value={shareUrl}
            className="flex-1 h-9 px-3 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-mono rounded-lg text-slate-600 dark:text-slate-400 outline-hidden select-all"
          />
          <button
            onClick={onCopyLink}
            aria-label="Copy answer to clipboard"
            className="px-3.5 h-9 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0"
          >
            {copiedLink ? <Check className="h-3.5 w-3.5 animate-bounce" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedLink ? t('assistant.shareModal.copied') : t('assistant.shareModal.copy')}
          </button>
        </div>

        <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg text-3xs text-slate-500 dark:text-slate-500 flex items-start gap-2">
          <MessageSquare className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
          <span>{t('assistant.shareModal.permissionNote')}</span>
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          onClick={onClose}
          className="px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
        >
          {t('assistant.shareModal.dismiss')}
        </button>
      </div>
    </Modal>
  );
};
