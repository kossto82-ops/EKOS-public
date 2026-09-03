/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { FileText, Check, Download } from 'lucide-react';
import { Modal } from '../../shared/Modal';
import { MarkdownContent } from '../../shared/MarkdownContent';
import { useLocale } from '../../../context/LocaleContext';
import { KBDocument } from '../../../types';

interface SourceDetailModalProps {
  source: { name: string; fileExt: string };
  /** The resolved KB document for this source, when found — carries the real content. */
  document?: KBDocument | null;
  onClose: () => void;
  onDownload: (source: { name: string; fileExt: string }) => void;
}

/**
 * Source Detail View Dialog for the Assistant tab. Extracted from
 * AssistantTab.
 */
export const SourceDetailModal: React.FC<SourceDetailModalProps> = ({ source, document, onClose, onDownload }) => {
  const { t } = useLocale();
  return (
    <Modal
      titleId="source_detail_title"
      title={source.name}
      icon={<FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
      onClose={onClose}
    >
      <div className="space-y-3.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
        <div className="grid grid-cols-2 gap-2.5 p-3 bg-slate-50 dark:bg-slate-950 rounded-lg text-2xs font-mono">
          <div>
            <span className="text-slate-400 block">{t('assistant.sourceModal.filePath')}</span>
            <span className="text-slate-800 dark:text-slate-300 font-semibold break-all">
              {/* Slug is built from the name WITHOUT its extension, then the real
                  extension (if any) is appended once — avoids "..._pdf.pdf". */}
              /docs/gov/
              {(source.fileExt ? source.name.slice(0, -source.fileExt.length) : source.name)
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '_')}
              {source.fileExt}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block">{t('assistant.sourceModal.verificationStatus')}</span>
            <span className="text-success-700 dark:text-success-400 font-bold flex items-center gap-1">
              <Check className="h-3 w-3" /> {t('assistant.sourceModal.authoritative')}
            </span>
          </div>
        </div>
        {document?.content ? (
          <div className="max-h-[50vh] overflow-y-auto p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-100 dark:border-slate-800">
            <MarkdownContent headingOffset={2}>{document.content}</MarkdownContent>
          </div>
        ) : (
          <p>
            {t('assistant.sourceModal.body')}
          </p>
        )}
        <p className="text-3xs text-slate-500 dark:text-slate-500">
          {t('assistant.sourceModal.clearanceNote', { level: t('assistant.sourceModal.clearanceLevel') })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          onClick={() => onDownload(source)}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
        >
          <Download className="h-3.5 w-3.5" />
          {t('assistant.sourceModal.download')}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
        >
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
};
