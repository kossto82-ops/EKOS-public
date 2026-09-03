/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect } from 'react';
import { Home, ShieldCheck, Eye } from 'lucide-react';
import { BreadcrumbItem } from '../components/shared/Breadcrumb';
import { ReviewTask } from '../types';

interface UseReviewQueueBreadcrumbsArgs {
  activeReviewTask: ReviewTask | null;
  setBreadcrumbs: (items: BreadcrumbItem[]) => void;
  t: (path: string) => string;
  setActiveReviewTask: (task: ReviewTask | null) => void;
}

/**
 * Drives the shared header breadcrumb trail for the Review Queue tab.
 * Mirrors useKbBreadcrumbs' pattern — extracted so the queue's own drawer
 * navigation (Home > Review Queue > Review Task) stays one small hook
 * instead of inline effect logic in ReviewQueueTab.
 */
export function useReviewQueueBreadcrumbs({
  activeReviewTask,
  setBreadcrumbs,
  t,
  setActiveReviewTask,
}: UseReviewQueueBreadcrumbsArgs) {
  useLayoutEffect(() => {
    const handleHomeClick = () => {
      setActiveReviewTask(null);
      window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }));
    };
    const handleQueueClick = () => {
      setActiveReviewTask(null);
      window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'review' }));
    };

    if (activeReviewTask) {
      setBreadcrumbs([
        { label: t('common.home'), icon: Home, onClick: handleHomeClick },
        { label: t('kb.subTabs.reviewQueue'), icon: ShieldCheck, onClick: handleQueueClick },
        { label: t('kb.breadcrumb.reviewTask'), icon: Eye }
      ]);
    } else {
      setBreadcrumbs([
        { label: t('common.home'), icon: Home, onClick: handleHomeClick },
        { label: t('kb.subTabs.reviewQueue'), icon: ShieldCheck }
      ]);
    }
  }, [activeReviewTask, setBreadcrumbs, t]);
}
