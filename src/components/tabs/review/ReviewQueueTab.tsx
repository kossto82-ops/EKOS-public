/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useContext } from 'react';
import { AuthContext } from '../../../context/AuthContext';
import { useBrand } from '../../../hooks/useBrand';
import { useDepartment } from '../../../hooks/useDepartment';
import { useToast } from '../../../hooks/useToast';
import { ShieldCheck } from 'lucide-react';
import { useBreadcrumbs } from '../../../context/BreadcrumbContext';
import { useLocale } from '../../../context/LocaleContext';
import { GovernanceTaskSkeleton } from '../../shared/Skeletons';

import { GovernancePanel } from '../kb/GovernancePanel';
import { GovernanceReviewDrawer } from '../kb/GovernanceReviewDrawer';
import { GovernancePanelProvider } from '../kb/GovernancePanelContext';
import { useKbDocuments } from '../../../hooks/useKbDocuments';
import { useKbGovernanceData } from '../../../hooks/useKbGovernanceData';
import { takePendingResolveGap } from '../../../utils/crossTabIntent';
import { useKbGovernanceModals } from '../../../hooks/useKbGovernanceModals';
import { useReviewQueueBreadcrumbs } from '../../../hooks/useReviewQueueBreadcrumbs';

interface ReviewQueueTabProps {}

/**
 * The content review/approval workflow, promoted out of the Knowledge Base
 * tab (which used to fold "browse the repository", "analytics" and "review
 * the queue" into one destination switched by an internal sub-tab). This is
 * now its own top-level destination: one job, one screen.
 *
 * Access is gated in App.tsx via canViewTab('review'), which uses the SAME
 * predicate (Administrator/LocationManager) that used to gate the
 * 'governance' sub-tab — see src/utils/rbac.ts's 'review' case. Because that
 * gate already keeps unauthorized users from ever mounting this component,
 * there is no separate in-component redirect here (the old sub-tab needed
 * one only because 'kb' itself was open to every role).
 */
export const ReviewQueueTab: React.FC<ReviewQueueTabProps> = () => {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { t } = useLocale();
  const { activeBrand } = useBrand();
  const { activeDepartment } = useDepartment();
  const auth = useContext(AuthContext);
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(false);

  // Brief skeleton loader on brand changes, mirroring the KB tab's own
  // sub-tab/brand-change loading treatment.
  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => setIsLoading(false), 600);
    return () => clearTimeout(timer);
  }, [activeBrand]);

  // Whether the caller governs ALL departments and should therefore see every
  // review-queue task regardless of the active-department selector — i.e. any
  // user scoped to '*' (Administrators). Team Leaders/others remain scoped to
  // their own department(s). See useKbGovernanceData for how this is used.
  const canSeeAllDepartments = (auth?.currentUser?.departmentIds || []).includes('*');

  const {
    documents,
    handleUploadDoc,
    updateDocumentApproval,
  } = useKbDocuments({
    brandId: activeBrand.id,
    departmentId: activeDepartment.id,
    toast,
  });

  const {
    searchGaps,
    saveSearchGaps,
    reviewTasks,
    filteredReviewTasks,
    saveReviewTasks,
    activeReviewTask,
    setActiveReviewTask,
    highlightedIndex,
    setHighlightedIndex,
    selectedTaskIds,
    setSelectedTaskIds,
    handleTransitionTask,
    handleReviewActionExecuted,
    handleReviewNavigate,
  } = useKbGovernanceData({
    departmentId: activeDepartment.id,
    canSeeAllDepartments,
    documents,
    updateDocumentApproval,
    toast,
  });

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
    handleResolveGap,
    handleSaveSandboxAddendum,
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
    handleOpenDispatchPortal,
    handleSaveDispatchAction,
  } = useKbGovernanceModals({
    activeBrand,
    handleUploadDoc,
    searchGaps,
    saveSearchGaps,
    reviewTasks,
    saveReviewTasks,
    toast,
  });

  // Drained once, on mount. Deliberately not a window listener: the sender is
  // unmounted by the time this component exists, so there is no moment at which
  // both a dispatcher and a listener are alive. Read via a ref so the effect
  // stays a mount effect — re-running it when handleResolveGap's identity
  // changes would find the slot already empty and do nothing, but the intent is
  // "exactly once", and saying so is cheaper than relying on that.
  const resolveGapRef = useRef(handleResolveGap);
  useEffect(() => { resolveGapRef.current = handleResolveGap; }, [handleResolveGap]);
  useEffect(() => {
    const pending = takePendingResolveGap();
    if (pending) resolveGapRef.current(pending.gapId, pending.queryText);
  }, []);

  useReviewQueueBreadcrumbs({
    activeReviewTask,
    setBreadcrumbs,
    t,
    setActiveReviewTask,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2 select-none">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-sans uppercase tracking-wider flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-success-500" /> {t('kb.subTabs.reviewQueue')}
        </h2>
      </div>

      {/* Main workspace container space */}
      <div className="flex-1 overflow-hidden min-h-0 pt-4">
        {isLoading ? (
          <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading content">
            <div className="flex items-center justify-between">
              <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-sm w-36 animate-pulse" />
              <div className="flex gap-2">
                <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded-sm w-24 animate-pulse" />
                <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded-sm w-24 animate-pulse" />
              </div>
            </div>
            <GovernanceTaskSkeleton count={4} />
          </div>
        ) : (
          <GovernancePanelProvider value={{
            reviewTasks: filteredReviewTasks,
            saveReviewTasks,
            updateDocumentApproval,
            selectedTaskIds,
            setSelectedTaskIds,
            highlightedIndex,
            setHighlightedIndex,
            activeReviewTask,
            setActiveReviewTask,
            handleTransitionTask,
            handleReviewActionExecuted,
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
            handleOpenDispatchPortal,
            handleSaveDispatchAction,
          }}>
            <GovernancePanel />
          </GovernancePanelProvider>
        )}
      </div>

      {activeReviewTask && (
        <GovernanceReviewDrawer
          task={activeReviewTask}
          tasksList={reviewTasks}
          currentIndex={reviewTasks.findIndex((t) => t.id === activeReviewTask.id)}
          totalTasks={reviewTasks.length}
          onClose={() => setActiveReviewTask(null)}
          onActionExecuted={handleReviewActionExecuted}
          onNavigate={handleReviewNavigate}
        />
      )}
    </div>
  );
};

export default ReviewQueueTab;
