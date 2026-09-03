/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { X, Copy } from 'lucide-react';
import { KnowledgeAnswer } from '../../../types/knowledge';
import { KBDocument } from '../../../types';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { useLocale } from '../../../context/LocaleContext';
import { MarkdownContent } from '../../shared/MarkdownContent';
import { OVERLAY_SCRIM, OVERLAY_Z } from '../../shared/DesignSystem';

interface FullDocumentDrawerProps {
  searchResult: KnowledgeAnswer | null;
  /**
   * The real source document behind the answer (resolved from the KB by the
   * answer's first source). When present its full text is shown — the previous
   * behavior only ever rendered the AI's synthesized answer (searchResult.content),
   * so "View full document" never actually showed the document. Falls back to
   * the answer content when no source document could be resolved.
   */
  sourceDocument?: KBDocument | null;
  onClose: () => void;
  onCopyFullText: () => void;
}

/**
 * Full Document View Slide-over Drawer for the Assistant tab. Extracted
 * from AssistantTab.
 */
export const FullDocumentDrawer: React.FC<FullDocumentDrawerProps> = ({ searchResult, sourceDocument, onClose, onCopyFullText }) => {
  const { t } = useLocale();
  const trapRef = useFocusTrap<HTMLDivElement>();

  // Prefer the real source document's full text; fall back to the AI answer
  // content only when no source document resolved.
  const fullText = sourceDocument?.content || searchResult?.content;
  const documentTitle = sourceDocument?.name || searchResult?.title || t('assistant.drawer.defaultTitle');

  // Large-document render guard: a crawled document can reach MAX_CONTENT_CHARS
  // (60k), and handing that much text to the markdown renderer in one pass
  // blocks the main thread. Render a bounded prefix by default and let the user
  // opt into the rest, so opening a big SOP can't freeze the drawer.
  const RENDER_CHAR_LIMIT = 20_000;
  const [showFullText, setShowFullText] = useState(false);
  const isOversized = !!fullText && fullText.length > RENDER_CHAR_LIMIT;
  const renderedText = isOversized && !showFullText ? fullText!.slice(0, RENDER_CHAR_LIMIT) : fullText;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className={`fixed inset-0 ${OVERLAY_Z} overflow-hidden animate-fadeIn`}>
      <div className={`absolute inset-0 ${OVERLAY_SCRIM} transition-opacity`} onClick={onClose} />

      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="full_document_title"
          tabIndex={-1}
          className="w-screen max-w-2xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xl flex flex-col justify-between animate-slideLeft text-left focus:outline-none"
        >

          {/* Header */}
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between select-none bg-slate-50/50 dark:bg-slate-900/60">
            <div className="space-y-0.5">
              <span className="text-3xs font-bold text-brand-600 dark:text-brand-400 uppercase tracking-widest">{t('assistant.drawer.viewerLabel')}</span>
              <h3 id="full_document_title" className="text-base font-extrabold text-slate-900 dark:text-white truncate">
                {documentTitle}
              </h3>
            </div>
            <button
              onClick={onClose}
              aria-label={t('assistant.drawer.closeViewer')}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>

          {/* Document Text */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
            <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100/60 dark:border-slate-800 text-xs space-y-2">
              <h4 className="font-bold text-slate-800 dark:text-slate-200">{t('assistant.drawer.legalNoticeTitle')}</h4>
              <p>{t('assistant.drawer.legalNoticeBody')}</p>
              <div className="flex flex-wrap gap-4 pt-1 font-mono text-3xs text-slate-400">
                <div>{t('assistant.drawer.version')}</div>
                <div>{t('assistant.drawer.audited')}</div>
                <div>{t('assistant.drawer.domain')} {searchResult?.businessDomain || 'Operations'}</div>
              </div>
            </div>

            {searchResult?.summary && (
              <div className="space-y-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('assistant.result.executiveSummary')}</h3>
                <p className="italic">{searchResult.summary}</p>
              </div>
            )}

            <div className="space-y-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {sourceDocument ? sourceDocument.name : t('assistant.drawer.section3Title')}
              </h3>
              <div className="p-5 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-100 dark:border-slate-800">
                {fullText
                  ? <>
                      <MarkdownContent headingOffset={2}>{renderedText!}</MarkdownContent>
                      {isOversized && !showFullText && (
                        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
                          <p className="text-2xs text-slate-500 dark:text-slate-400">
                            {t('assistant.guards.truncated', { n: RENDER_CHAR_LIMIT.toLocaleString() })}
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowFullText(true)}
                            className="text-2xs font-bold text-brand-600 dark:text-brand-400 underline underline-offset-2 cursor-pointer"
                          >
                            {t('assistant.guards.showFull')}
                          </button>
                        </div>
                      )}
                    </>
                  : <p className="text-xs text-slate-500 italic">{t('assistant.drawer.contentLoading')}</p>}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 flex items-center justify-end gap-3 select-none">
            <button
              onClick={onCopyFullText}
              aria-label={t('assistant.drawer.copyReference')}
              className="px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              {t('assistant.drawer.copyReference')}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              {t('assistant.drawer.closeViewer')}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
