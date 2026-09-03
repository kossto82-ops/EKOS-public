import React, { useEffect } from 'react';
import { Clock, X } from 'lucide-react';
import { useGovernancePanelContext } from './GovernancePanelContext';
import { useLocale } from '../../../context/LocaleContext';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { OVERLAY_SCRIM, OVERLAY_Z } from '../../shared/DesignSystem';

export const GovernanceDispatchModal: React.FC = () => {
  const { t } = useLocale();
  const {
    activeDispatchTask,
    setActiveDispatchTask,
    dispatchOwnerName,
    setDispatchOwnerName,
    dispatchDepartment,
    setDispatchDepartment,
    dispatchPriority,
    setDispatchPriority,
    dispatchNotes,
    setDispatchNotes,
    handleSaveDispatchAction,
  } = useGovernancePanelContext();

  const trapRef = useFocusTrap<HTMLDivElement>(!!activeDispatchTask);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveDispatchTask(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setActiveDispatchTask]);

  if (!activeDispatchTask) return null;

  return (
    <div className={`fixed inset-0 ${OVERLAY_Z} flex items-center justify-center p-4 ${OVERLAY_SCRIM}`}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-modal-title"
        tabIndex={-1}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 focus:outline-none"
      >
        <div className="px-4 py-3 bg-warning-500 text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-white animate-pulse" />
            <span id="dispatch-modal-title" className="text-xs font-bold uppercase tracking-wider font-mono">
              {t('dispatch.title')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveDispatchTask(null)}
            className="text-white hover:text-warning-100 cursor-pointer p-1"
            aria-label={t('dispatch.closeAria')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="text-xs text-warning-800 bg-warning-50 border border-warning-200/50 p-3 rounded-lg dark:bg-warning-950/20 dark:border-warning-900 dark:text-warning-300 text-left">
            {t('dispatch.explanation', { name: activeDispatchTask.documentName })}
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border dark:border-slate-800 space-y-1 text-xs text-left">
            <p className="text-3xs text-slate-400 block font-bold leading-normal font-mono uppercase">
              {t('dispatch.targetQueryLabel')}
            </p>
            <p className="italic text-slate-700 dark:text-slate-300">
              "{activeDispatchTask.agentQuery}"
            </p>
          </div>

          <div className="space-y-3 text-left">
            <div className="space-y-1">
              <label
                htmlFor="dispatchOwner"
                className="text-3xs text-slate-400 uppercase font-bold font-mono tracking-wider block"
              >
                {t('dispatch.ownerLabel')}
              </label>
              <select
                id="dispatchOwner"
                value={dispatchOwnerName}
                onChange={(e) => setDispatchOwnerName(e.target.value)}
                className="w-full text-xs rounded border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-hidden dark:border-slate-800 dark:bg-slate-950 dark:text-white font-semibold"
              >
                <option value="Commercial Director">{t('dispatch.ownerOptions.commercialDirector')}</option>
                <option value="Telecommunications Specialist">
                  {t('dispatch.ownerOptions.telecomSpecialist')}
                </option>
                <option value="IT Support Lead">{t('dispatch.ownerOptions.itSupportLead')}</option>
                <option value="Customer Experience Coordinator">
                  {t('dispatch.ownerOptions.cxCoordinator')}
                </option>
                <option value="Systems Administrator">{t('dispatch.ownerOptions.systemsAdmin')}</option>
                <option value="Billing Specialist">{t('dispatch.ownerOptions.billingSpecialist')}</option>
              </select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="dispatchDept"
                className="text-3xs text-slate-400 uppercase font-bold font-mono tracking-wider block"
              >
                {t('dispatch.deptLabel')}
              </label>
              <select
                id="dispatchDept"
                value={dispatchDepartment}
                onChange={(e) => setDispatchDepartment(e.target.value)}
                className="w-full text-xs rounded border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-hidden dark:border-slate-800 dark:bg-slate-950 dark:text-white font-semibold"
              >
                <option value="Finance DE">{t('dispatch.deptOptions.financeDe')}</option>
                <option value="IT Support ES">{t('dispatch.deptOptions.itSupportEs')}</option>
                <option value="Marketing FR">{t('dispatch.deptOptions.marketingFr')}</option>
                <option value="Operations DE">{t('dispatch.deptOptions.operationsDe')}</option>
                <option value="Corporate Legal">{t('dispatch.deptOptions.corporateLegal')}</option>
                <option value="Global Administration">{t('dispatch.deptOptions.globalAdmin')}</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-3xs text-slate-400 uppercase font-bold font-mono tracking-wider block">
                {t('dispatch.priorityLabel')}
              </label>
              <div className="flex gap-3">
                {['Urgent', 'High', 'Medium', 'Low'].map((prio) => (
                  <label
                    key={prio}
                    className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-800 dark:text-slate-200 select-none hover:text-warning-500 dark:hover:text-warning-400"
                  >
                    <input
                      type="radio"
                      name="dispatchPriority"
                      checked={dispatchPriority === prio}
                      onChange={() => setDispatchPriority(prio as 'Urgent' | 'High' | 'Medium' | 'Low')}
                      className="text-warning-600 focus:ring-warning-500 cursor-pointer text-xs"
                    />
                    <span>{t(`dispatch.priority.${prio}`)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="dispatchDirectivesTextarea"
                className="text-3xs text-slate-400 uppercase font-bold font-mono tracking-wider block"
              >
                {t('dispatch.notesLabel')}
              </label>
              <textarea
                id="dispatchDirectivesTextarea"
                rows={3}
                value={dispatchNotes}
                onChange={(e) => setDispatchNotes(e.target.value)}
                placeholder={t('dispatch.notesPlaceholder')}
                className="w-full text-xs rounded border border-slate-300 bg-white p-2.5 focus:outline-hidden dark:border-slate-800 dark:bg-slate-950 dark:text-white font-medium"
              />
            </div>
          </div>

          <div className="text-[10.5px] text-slate-500 leading-relaxed bg-slate-50 dark:bg-slate-950/40 p-2.5 rounded-lg border dark:border-slate-800 text-left">
            💡 {t('dispatch.loopNote')}
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setActiveDispatchTask(null)}
            className="px-3 py-1.5 rounded bg-white hover:bg-slate-100 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-800 dark:text-slate-200 text-xs font-bold border border-slate-300 dark:border-slate-700 cursor-pointer transition-colors"
          >
            {t('dispatch.abort')}
          </button>
          <button
            type="button"
            onClick={handleSaveDispatchAction}
            className="px-4 py-1.5 rounded bg-warning-500 hover:bg-warning-600 text-white text-xs font-bold cursor-pointer transition-colors shadow-xs"
          >
            {t('dispatch.submit')}
          </button>
        </div>
      </div>
    </div>
  );
};
