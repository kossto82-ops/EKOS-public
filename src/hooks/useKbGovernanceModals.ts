/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { KBDocument, ReviewTask } from '../types';
import { Brand } from '../types';
import { ISearchGap } from '../repositories/governanceRepository';

const LEGACY_DEPT_MAP: Record<string, string[]> = {
  'Finance DE': ['finance'],
  'IT Support ES': ['it'],
  'Marketing FR': ['marketing'],
  'Operations DE': ['customer_service'],
  'Corporate Legal': ['legal'],
  'Global Administration': ['administration'],
};

interface UseKbGovernanceModalsArgs {
  activeBrand: Brand;
  handleUploadDoc: (doc: KBDocument) => void;
  searchGaps: ISearchGap[];
  saveSearchGaps: (gaps: ISearchGap[]) => void;
  reviewTasks: ReviewTask[];
  saveReviewTasks: (updated: ReviewTask[]) => void;
  toast: { success: (msg: string) => void; error: (msg: string) => void };
}

/**
 * Sandbox (SOP grounding addendum) and Dispatch (SLA reassignment) modal
 * state and handlers for the Governance work queue. Extracted from
 * KnowledgeBaseTab, now owned by ReviewQueueTab — the review queue's own
 * top-level destination. Permission-gating and cross-tab navigation for a
 * gap-resolve request initiated from the KB tab's Metrics view are the
 * CALLER's job (the KB tab leaves the gap in the slot in utils/crossTabIntent
 * and navigates; ReviewQueueTab drains it on mount); by the time
 * handleResolveGap runs here, the caller is already mounted on the review queue
 * and authorized to be there.
 */
export function useKbGovernanceModals({
  activeBrand,
  handleUploadDoc,
  searchGaps,
  saveSearchGaps,
  reviewTasks,
  saveReviewTasks,
  toast,
}: UseKbGovernanceModalsArgs) {
  // SOP Sandbox / Addendum Editor Modal States
  const [activeSandboxGap, setActiveSandboxGap] = useState<{ id: string; query: string } | null>(null);
  const [sandboxFilename, setSandboxFilename] = useState('');
  const [sandboxContent, setSandboxContent] = useState('');
  const [sandboxOwner, setSandboxOwner] = useState('Review Owner');
  const [sandboxScope, setSandboxScope] = useState<'global' | 'brand'>('brand');

  // Governance Dispatch Modal States
  const [activeDispatchTask, setActiveDispatchTask] = useState<ReviewTask | null>(null);
  const [dispatchOwnerName, setDispatchOwnerName] = useState('');
  const [dispatchDepartment, setDispatchDepartment] = useState('');
  const [dispatchPriority, setDispatchPriority] = useState<'Urgent' | 'High' | 'Medium' | 'Low'>('Medium');
  const [dispatchNotes, setDispatchNotes] = useState('');

  const handleResolveGap = (gapId: string, queryText: string) => {
    toast.success(`Opening SOP Grounding Sandbox Editor for "${queryText}"`);

    const cleanedTerm = queryText
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('_')
      .toLowerCase();
    const recommendedFilename = `Addendum_Manual_${cleanedTerm || 'rules'}.txt`;

    setActiveSandboxGap({ id: gapId, query: queryText });
    setSandboxFilename(recommendedFilename);
    setSandboxScope('brand');
    setSandboxOwner('Review Owner');
    setSandboxContent(
      `# ========================================== \n` +
        `# SLA GROUNDING RULES ADDENDUM MANUAL \n` +
        `# Resolving Customer Query Gap: "${queryText}" \n` +
        `# Brand: ${activeBrand.displayName} \n` +
        `# Date Created: ${new Date().toLocaleDateString()} \n` +
        `# ========================================== \n\n` +
        `[SLA Grounding Standard Operations Procedures Directives]\n` +
        `1. SCOPE AND RECEPTION METHODOLOGIES:\n` +
        `   * Standard response criteria matching the query "${queryText}" should prioritize first-contact resolution.\n` +
        `   * Ensure all operators utilize the localized customer database indicators.\n\n` +
        `2. SPECIFIC TARIFICATION & PROTOCOL RULES:\n` +
        `   * Standard flat-rate coverage is applied under Category-A SLA norms.\n` +
        `   * For advanced requests, escalate to regional support managers after 3 failed confidence matches.\n\n` +
        `3. VALIDATION CRITERIA:\n` +
        `   * Any further revision must undergo continuous quality checks & HITL review.\n`
    );
  };

  const handleSaveSandboxAddendum = () => {
    if (!activeSandboxGap) return;
    if (!sandboxFilename.trim() || !sandboxContent.trim()) {
      toast.error('Both file name and grounding rules content are required!');
      return;
    }

    const docId = 'kb_grounding_' + Math.random().toString(36).substring(2, 9);
    const newDocObj: KBDocument = {
      id: docId,
      name: sandboxFilename.endsWith('.txt') ? sandboxFilename : `${sandboxFilename}.txt`,
      type: 'txt',
      status: 'indexing',
      scope: sandboxScope,
      brandId: sandboxScope === 'brand' ? activeBrand.id : undefined,
      content: sandboxContent,
      uploadedAt: new Date().toISOString(),
      uploadedBy: sandboxOwner,
    };

    handleUploadDoc(newDocObj);

    const updatedGaps = searchGaps.map((g) =>
      g.id === activeSandboxGap.id
        ? {
            ...g,
            resolved: true,
            hasResults: true,
            escalated: false,
            dominantSource: newDocObj.name,
            confidence: 'High',
          }
        : g
    );
    saveSearchGaps(updatedGaps); // cache + state + cross-tab event + persist to SQLite

    toast.success(`Success! SLA guidelines updated via Sandbox and indexed dynamically.`);
    setActiveSandboxGap(null);
  };

  const handleOpenDispatchPortal = (task: ReviewTask) => {
    setActiveDispatchTask(task);
    setDispatchOwnerName(task.owner || 'Customer Service Operations');
    setDispatchDepartment(task.department || 'Operations');
    setDispatchPriority((task.priority as 'Urgent' | 'High' | 'Medium' | 'Low') || 'Medium');
    setDispatchNotes(task.dispatchNotes || '');
  };

  const handleSaveDispatchAction = () => {
    if (!activeDispatchTask) return;
    if (!dispatchOwnerName.trim() || !dispatchDepartment.trim()) {
      toast.error('Owner and department are required to dispatch this task.');
      return;
    }
    try {
      const updated = reviewTasks.map((t) =>
        t.id === activeDispatchTask.id
          ? {
              ...t,
              owner: dispatchOwnerName,
              department: dispatchDepartment,
              departmentIds: LEGACY_DEPT_MAP[dispatchDepartment] || [],
              priority: dispatchPriority,
              dispatchNotes: dispatchNotes,
              status: t.status === 'Feedback Received' ? 'Under Review' : t.status,
            }
          : t
      );
      saveReviewTasks(updated);
      toast.success(`Success! SLA task dispatched to content owner: ${dispatchOwnerName} (${dispatchDepartment})`);
      setActiveDispatchTask(null);
    } catch (e) {
      console.error(e);
      toast.error('Failed to configure governance dispatch target.');
    }
  };

  return {
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
  };
}
