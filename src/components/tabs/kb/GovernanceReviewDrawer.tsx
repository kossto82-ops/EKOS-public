/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  X, ShieldAlert, ArrowLeft, ArrowRight, Check, AlertTriangle,
  HelpCircle, Sparkles, RefreshCw, UserCheck, ChevronDown, ChevronUp, FileText,
  Home, ShieldCheck, Eye, Ban
} from 'lucide-react';
import { useToast } from '../../../hooks/useToast';
import { Breadcrumb } from '../../shared/Breadcrumb';
import { ReviewTask } from '../../../types';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { useLocale } from '../../../context/LocaleContext';
import { Badge } from '../../shared/DesignSystem';
import { OVERLAY_SCRIM, OVERLAY_Z } from '../../shared/DesignSystem';

interface GovernanceReviewDrawerProps {
  task: ReviewTask | null;
  tasksList: ReviewTask[];
  onClose: () => void;
  onActionExecuted: (taskId: string, nextStatus: 'Under Review' | 'Grounded & Updated' | 'Rejected' | 'Banned', updatedTask?: ReviewTask) => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  currentIndex: number;
  totalTasks: number;
}

export const GovernanceReviewDrawer: React.FC<GovernanceReviewDrawerProps> = ({
  task,
  tasksList,
  onClose,
  onActionExecuted,
  onNavigate,
  currentIndex,
  totalTasks
}) => {
  const toast = useToast();
  const { t } = useLocale();
  const trapRef = useFocusTrap<HTMLDivElement>(!!task);

  // Drawer local state
  const [isQueryExpanded, setIsQueryExpanded] = useState(false);
  const [isResponseExpanded, setIsResponseExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedFeedbackType, setEditedFeedbackType] = useState(task?.feedbackType);
  const [editedOwner, setEditedOwner] = useState(task?.owner);
  const [autoAdvance, setAutoAdvance] = useState(true);

  useEffect(() => {
    // Sync local states when task changes
    if (!task) return;
    setEditedFeedbackType(task.feedbackType);
    setEditedOwner(task.owner);
    setIsEditing(false);
  }, [task]);

  // Read via refs inside the keyboard handler so a checkbox toggle or task
  // navigation happening in the same tick as a keypress can never be acted
  // on with a stale value — the effect below doesn't need to re-run (and
  // briefly leave the old listener attached) just because these changed.
  const autoAdvanceRef = useRef(autoAdvance);
  const currentIndexRef = useRef(currentIndex);
  const totalTasksRef = useRef(totalTasks);
  useEffect(() => { autoAdvanceRef.current = autoAdvance; }, [autoAdvance]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { totalTasksRef.current = totalTasks; }, [totalTasks]);

  const handleQuickApprove = () => {
    if (!task) return;
    onActionExecuted(task.id, 'Grounded & Updated');
    toast.success(t('governanceDrawer.toastApproved', { name: task.documentName }));
    if (autoAdvanceRef.current && currentIndexRef.current < totalTasksRef.current - 1) {
      setTimeout(() => onNavigate('next'), 150);
    } else if (currentIndexRef.current === totalTasksRef.current - 1) {
      onClose();
    }
  };

  const handleQuickReject = () => {
    if (!task) return;
    onActionExecuted(task.id, 'Rejected');
    toast.success(t('governanceDrawer.toastRejected', { name: task.documentName }));
    if (autoAdvanceRef.current && currentIndexRef.current < totalTasksRef.current - 1) {
      setTimeout(() => onNavigate('next'), 150);
    } else if (currentIndexRef.current === totalTasksRef.current - 1) {
      onClose();
    }
  };

  const handleBan = () => {
    if (!task) return;
    onActionExecuted(task.id, 'Banned');
    toast.success(t('governanceDrawer.toastBanned', { name: task.documentName }));
    if (autoAdvanceRef.current && currentIndexRef.current < totalTasksRef.current - 1) {
      setTimeout(() => onNavigate('next'), 150);
    } else if (currentIndexRef.current === totalTasksRef.current - 1) {
      onClose();
    }
  };

  // Keyboard Shortcuts Handler
  useEffect(() => {
    if (!task) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid triggering when user is typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        onNavigate('next');
      } else if (e.key === 'ArrowLeft') {
        onNavigate('prev');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleQuickApprove();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [task]);

  if (!task) return null;

  // Compute dynamic mock heuristics if they don't exist
  const aiConfidence = task.aiConfidence || (task.feedbackType === 'Outdated' ? 92 : task.feedbackType === 'Incorrect' ? 88 : 74);
  const similarIncidents = task.similarIncidents || (task.documentName.includes('Preise') ? 4 : 2);
  const flags = task.flags || (task.feedbackType === 'Outdated' ? ['Price Discrepancy', 'Format Drift'] : ['Omission', 'Clarification Req']);
  const recommendation = task.recommendation || (task.feedbackType === 'Outdated' ? 'Safe to approve. AI verified correction.' : 'Needs human edit. Verify with regional Support.');

  const handleSaveEdit = () => {
    const updatedTask: ReviewTask = {
      ...task,
      feedbackType: editedFeedbackType!,
      owner: editedOwner!,
    };
    onActionExecuted(task.id, task.status as any, updatedTask);
    setIsEditing(false);
    toast.success(t('governanceDrawer.toastUpdated'));
  };

  // Status colors mapping
  const getSeverityStyles = () => {
    if (task.priority === 'Urgent') return 'bg-danger-50 border-danger-200 text-danger-700 dark:bg-danger-950/20 dark:border-danger-900 dark:text-danger-300';
    if (task.priority === 'High') return 'bg-warning-50 border-warning-200 text-warning-700 dark:bg-warning-950/20 dark:border-warning-900 dark:text-warning-300';
    return 'bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300';
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 90) return 'text-success-500';
    if (score >= 75) return 'text-warning-500';
    return 'text-danger-500';
  };

  return (
    <div className={`fixed inset-0 ${OVERLAY_Z} flex justify-end`}>
      {/* Dark overlay backdrop with click-to-close */}
      <div 
        className={`absolute inset-0 ${OVERLAY_SCRIM} transition-opacity animate-fadeIn`}
        onClick={onClose} 
      />

      {/* Main Drawer Container */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gov-drawer-title"
        tabIndex={-1}
        className="relative w-full max-w-md bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200 select-none focus:outline-none"
      >
        
        {/* TOP COMPACT NAVIGATION RAIL */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-slate-100 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-900/40">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
            <h2 id="gov-drawer-title" className="font-bold text-slate-700 dark:text-slate-300">
              {t('governanceDrawer.taskCounter', { current: currentIndex + 1 })}
            </h2>
            <span>/</span>
            <span>{totalTasks} {t('governanceDrawer.pending')}</span>
          </div>

          <div className="flex items-center gap-4">
            {/* Auto-advance toggler */}
            <label htmlFor="drawer_auto_advance_checkbox" className="flex items-center gap-1.5 cursor-pointer text-3xs text-slate-500 font-sans">
              <input
                type="checkbox"
                id="drawer_auto_advance_checkbox"
                checked={autoAdvance}
                onChange={(e) => setAutoAdvance(e.target.checked)}
                className="rounded-sm border-slate-300 text-brand-600 focus:ring-brand-500 w-3 h-3"
              />
              <span className="font-semibold tracking-tight">{t('governanceDrawer.autoAdvance')}</span>
            </label>

            {/* Prev/Next keys */}
            <div className="flex items-center gap-1 border-l border-slate-200 dark:border-slate-800 pl-3">
              <button
                onClick={() => onNavigate('prev')}
                disabled={currentIndex === 0}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title={t('governanceDrawer.prevTask')}
                aria-label={t('governanceDrawer.prevTask')}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onNavigate('next')}
                disabled={currentIndex === totalTasks - 1}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title={t('governanceDrawer.nextTask')}
                aria-label={t('governanceDrawer.nextTask')}
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors cursor-pointer"
              title={t('governanceDrawer.closeDrawer')}
              aria-label={t('governanceDrawer.closeDrawer')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* COMPACT MAIN WRAPPER (MAX 3 KEY BLOCKS VISIBLE IN VIEWPORT) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans">
          
          {/* Breadcrumb Header */}
          <div className="pb-2 border-b border-slate-100 dark:border-slate-800/60">
            <Breadcrumb items={[
              {
                label: t('common.home'),
                icon: Home,
                onClick: () => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }));
                }
              },
              {
                label: t('kb.subTabs.reviewQueue'),
                icon: ShieldCheck,
                onClick: () => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'review' }));
                }
              },
              { label: t('kb.breadcrumb.reviewTask'), icon: Eye }
            ]} />
          </div>

          {/* BLOCK 1: DECISION SUMMARY (DECISION FIRST) */}
          <div className={`p-3.5 border rounded-sm ${getSeverityStyles()} space-y-2.5 shadow-xs`}>
            <div className="flex items-start justify-between">
              <div>
                <span className="text-4xs font-bold uppercase tracking-wider font-mono text-slate-400 block">{t('governanceDrawer.detectedAnomaly')}</span>
                <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white leading-normal">
                  {task.feedbackType}
                </span>
              </div>
              {/* variant="inherit": the text colour comes from the ancestor that
                  encodes priority, and border-current follows it. A palette
                  variant here would break that inheritance. */}
              {/* border-current stated here rather than assumed from the
                  appearance: under variant="inherit" the primitive contributes no
                  colour at all, so the border has to be asked for. */}
              <Badge appearance="outline" variant="inherit" className="border-current bg-white dark:bg-slate-900">
                {task.priority && ['Urgent', 'High', 'Medium', 'Low'].includes(task.priority)
                  ? t(`dispatch.priority.${task.priority}`)
                  : t('governanceDrawer.priorityNormal')}
              </Badge>
            </div>

            {/* Automatic smart recommendation */}
            <div className="flex items-start gap-1.5 p-2 bg-white/70 dark:bg-slate-900/60 rounded-sm border border-slate-200/40 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-brand-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">{t('governanceDrawer.aiRecommendation')}</p>
                <p className="text-[10.5px] text-slate-500 leading-normal mt-0.5">{recommendation}</p>
              </div>
            </div>

            {/* High-speed visual heuristics */}
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200/30 text-center select-none">
              <div>
                <span className="text-3xs uppercase tracking-wider font-mono text-slate-400 block">{t('governanceDrawer.confidence')}</span>
                <span className={`text-xs font-bold font-mono ${getConfidenceColor(aiConfidence)}`}>
                  {aiConfidence}%
                </span>
              </div>
              <div className="border-x border-slate-200/30">
                <span className="text-3xs uppercase tracking-wider font-mono text-slate-400 block">{t('governanceDrawer.duplicates')}</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('governanceDrawer.itemsCount', { count: similarIncidents })}
                </span>
              </div>
              <div>
                <span className="text-3xs uppercase tracking-wider font-mono text-slate-400 block">{t('governanceDrawer.scopeStatus')}</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono">
                  {t('governanceDrawer.sopMatch')}
                </span>
              </div>
            </div>

            {/* Automated Flags */}
            <div className="flex flex-wrap gap-1 mt-1">
              {flags.map((flg, i) => (
                <span key={i} className="text-[8.5px] font-mono font-bold tracking-wide uppercase px-1.5 py-0.5 bg-slate-900/5 dark:bg-white/5 rounded-xs text-slate-500">
                  ⚡ {flg}
                </span>
              ))}
            </div>
          </div>

          {/* BLOCK 2: KEY CONTEXT (REDUCED READING - COLLAPSIBLE PREVIEWS) */}
          <div className="space-y-2 select-text">
            
            {/* Target Document */}
            <div className="p-2.5 bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-900 rounded-sm flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <span className="font-bold text-slate-800 dark:text-slate-200 truncate">{task.documentName}</span>
              </div>
              <span className="text-3xs text-slate-400 font-mono flex-shrink-0">
                {t('governanceDrawer.ownerPrefix')} {task.owner}
              </span>
            </div>

            {/* Target User/Agent Query (Collapsible) */}
            <div className="border border-slate-100 dark:border-slate-800 rounded-sm overflow-hidden text-xs">
              <button
                onClick={() => setIsQueryExpanded(!isQueryExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50/50 dark:bg-slate-900/20 text-left font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100/50 transition-colors"
              >
                <span className="font-bold uppercase tracking-wide font-mono text-4xs text-slate-400">{t('governanceDrawer.targetQueryHeader')}</span>
                {isQueryExpanded ? <ChevronUp className="h-3 w-3 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
              </button>
              
              <div className={`px-3 py-2.5 text-slate-600 dark:text-slate-300 transition-all duration-150 ${isQueryExpanded ? 'block border-t border-slate-100 dark:border-slate-900 bg-white dark:bg-slate-950' : 'line-clamp-1 bg-white/50 text-2xs leading-tight italic truncate'}`}>
                {isQueryExpanded ? (
                  <p className="italic leading-relaxed">"{task.agentQuery}"</p>
                ) : (
                  `"${task.agentQuery}"`
                )}
              </div>
            </div>

            {/* AI Response output (Collapsible) */}
            <div className="border border-slate-100 dark:border-slate-800 rounded-sm overflow-hidden text-xs">
              <button 
                onClick={() => setIsResponseExpanded(!isResponseExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50/50 dark:bg-slate-900/20 text-left font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100/50 transition-colors"
              >
                <span className="font-bold uppercase tracking-wide font-mono text-4xs text-slate-400">{t('governanceDrawer.aiResponseHeader')}</span>
                {isResponseExpanded ? <ChevronUp className="h-3 w-3 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
              </button>
              
              <div className={`px-3 py-2.5 text-slate-600 dark:text-slate-300 transition-all duration-150 ${isResponseExpanded ? 'block border-t border-slate-100 dark:border-slate-900 bg-white dark:bg-slate-950' : 'line-clamp-1 bg-white/50 text-2xs leading-tight italic truncate'}`}>
                {isResponseExpanded ? (
                  <p className="leading-relaxed font-sans">{task.messageContent}</p>
                ) : (
                  task.messageContent
                )}
              </div>
            </div>
          </div>

          {/* BLOCK 3: PROPERTIES MANAGEMENT (COLLAPSED / EDITABLE ON DEMAND) */}
          <div className="border border-slate-100 dark:border-slate-800 rounded-sm text-xs p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-4xs uppercase tracking-wide font-mono text-slate-400">{t('governanceDrawer.assignedProperties')}</span>
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="text-3xs font-bold text-brand-600 dark:text-brand-400 hover:underline"
              >
                {isEditing ? t('governanceDrawer.cancelEdit') : t('governanceDrawer.editTaskDetails')}
              </button>
            </div>

            {isEditing ? (
              <div className="space-y-3 pt-2 text-left">
                <div className="space-y-1">
                  <label htmlFor="edit_feedback_type" className="text-4xs font-mono font-bold uppercase text-slate-400">{t('governanceDrawer.feedbackTypeLabel')}</label>
                  <select
                    id="edit_feedback_type"
                    value={editedFeedbackType}
                    onChange={(e) => setEditedFeedbackType(e.target.value)}
                    className="w-full text-xs rounded border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="Outdated">{t('governanceDrawer.feedbackTypeOptions.outdated')}</option>
                    <option value="Missing information">{t('governanceDrawer.feedbackTypeOptions.missingInfo')}</option>
                    <option value="Incorrect">{t('governanceDrawer.feedbackTypeOptions.incorrect')}</option>
                    <option value="Formatting Drift">{t('governanceDrawer.feedbackTypeOptions.formattingDrift')}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="edit_assignee_owner" className="text-4xs font-mono font-bold uppercase text-slate-400">{t('governanceDrawer.assigneeOwnerLabel')}</label>
                  <input
                    id="edit_assignee_owner"
                    type="text"
                    value={editedOwner}
                    onChange={(e) => setEditedOwner(e.target.value)}
                    className="w-full text-xs rounded border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="w-full py-1.5 bg-slate-900 text-white dark:bg-brand-600 font-bold rounded-sm text-2xs"
                >
                  {t('governanceDrawer.applyConfiguration')}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-700 dark:text-slate-300">
                <div>
                  <span className="text-slate-400 mr-1.5">{t('governanceDrawer.ownerPrefix')}</span>
                  <span className="font-semibold">{task.owner}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">{t('governanceDrawer.divisionPrefix')}</span>
                  <span className="font-semibold">{task.department}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">{t('governanceDrawer.anomalyPrefix')}</span>
                  <span className="font-semibold">{task.feedbackType}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">{t('governanceDrawer.createdPrefix')}</span>
                  <span className="font-mono text-3xs">{new Date(task.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* BOTTOM FIXED PANEL: ULTRA-FAST ACTIONS */}
        <div className="flex-shrink-0 p-4 border-t border-slate-100 dark:border-slate-900 bg-slate-50 dark:bg-slate-900/20 space-y-2">
          
          {/* Main Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleQuickApprove}
              className="flex items-center justify-center gap-1.5 bg-success-600 hover:bg-success-700 text-white font-bold py-2 px-4 rounded-sm text-xs cursor-pointer transition-colors shadow-xs hover:shadow-xs"
              title={t('governanceDrawer.approveTitle')}
            >
              <Check className="h-4 w-4" />
              <span>{t('governanceDrawer.approveClose')}</span>
            </button>
            <button
              onClick={handleQuickReject}
              className="flex items-center justify-center gap-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-800 dark:text-slate-200 font-bold py-2 px-4 rounded-sm text-xs cursor-pointer transition-colors"
            >
              <X className="h-4 w-4" />
              <span>{t('governanceDrawer.rejectNeedsFix')}</span>
            </button>
          </div>

          {/* Terminal action: ban the underlying document (pulls it from retrieval). */}
          <button
            onClick={handleBan}
            className="w-full flex items-center justify-center gap-1.5 border border-danger-200 dark:border-danger-900/60 bg-danger-50 hover:bg-danger-100 text-danger-700 dark:bg-danger-950/20 dark:hover:bg-danger-950/40 dark:text-danger-300 font-bold py-2 px-4 rounded-sm text-xs cursor-pointer transition-colors"
            title={t('governanceDrawer.banTitle')}
          >
            <Ban className="h-4 w-4" />
            <span>{t('governanceDrawer.banDocument')}</span>
          </button>

          <p className="text-3xs text-slate-400 text-center">
            {t('governanceDrawer.proTipBeforeEnter')} <span className="font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded-xs font-bold text-slate-600">Enter</span> {t('governanceDrawer.proTipAfterEnter')} <span className="font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded-xs font-bold text-slate-600">←</span> / <span className="font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded-xs font-bold text-slate-600">→</span> {t('governanceDrawer.proTipAfterArrows')}
          </p>
        </div>

      </div>
    </div>
  );
};
