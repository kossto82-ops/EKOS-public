/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Flag } from 'lucide-react';
import { Modal } from '../../shared/Modal';
import { useLocale } from '../../../context/LocaleContext';

interface ReportIssueModalProps {
  reportCategory: string;
  setReportCategory: (val: string) => void;
  reportDetails: string;
  setReportDetails: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

/**
 * Report Policy Inaccuracy dialog for the Assistant tab. Extracted from
 * AssistantTab.
 */
export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({
  reportCategory,
  setReportCategory,
  reportDetails,
  setReportDetails,
  onSubmit,
  onClose,
}) => {
  const { t } = useLocale();
  return (
    <Modal
      titleId="report_issue_title"
      title={t('assistant.reportModal.title')}
      icon={<Flag className="h-5 w-5 text-danger-600 dark:text-danger-400" />}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <div className="space-y-3.5">
        <div className="space-y-1">
          <label htmlFor="report_cat" className="block text-xs font-bold text-slate-500 dark:text-slate-400">
            {t('assistant.reportModal.categoryLabel')}
          </label>
          <select
            id="report_cat"
            value={reportCategory}
            onChange={(e) => setReportCategory(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-white outline-hidden focus:border-brand-500"
          >
            <option value="Outdated Information">{t('assistant.reportModal.categoryOptions.outdated')}</option>
            <option value="Inaccurate Reference SLA">{t('assistant.reportModal.categoryOptions.inaccurateSla')}</option>
            <option value="SOP Formatting Issue">{t('assistant.reportModal.categoryOptions.formatting')}</option>
            <option value="Incorrect Domain Metadata">{t('assistant.reportModal.categoryOptions.metadata')}</option>
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="report_details" className="block text-xs font-bold text-slate-500 dark:text-slate-400">
            {t('assistant.reportModal.detailsLabel')}
          </label>
          <textarea
            id="report_details"
            rows={4}
            required
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            placeholder={t('assistant.reportModal.detailsPlaceholder')}
            className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-white outline-hidden focus:border-brand-500 font-medium"
          ></textarea>
        </div>

        <p className="text-3xs text-slate-400 dark:text-slate-500 leading-normal">
          *{t('assistant.reportModal.disclaimer')}
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          type="submit"
          disabled={!reportDetails.trim()}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-600"
        >
          {t('assistant.reportModal.submit')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
        >
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  );
};
