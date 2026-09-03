import { createContext, useContext } from 'react';
import type { ReviewTask } from '../../../types';

interface GovernancePanelContextValue {
  reviewTasks: ReviewTask[];
  saveReviewTasks: (updated: ReviewTask[]) => void;
  updateDocumentApproval: (docNames: Set<string>, decision: 'approved' | 'rejected' | 'banned') => void;
  selectedTaskIds: string[];
  setSelectedTaskIds: (updater: string[] | ((prev: string[]) => string[])) => void;
  highlightedIndex: number;
  setHighlightedIndex: (updater: number | ((prev: number) => number)) => void;
  activeReviewTask: ReviewTask | null;
  setActiveReviewTask: (task: ReviewTask | null) => void;
  handleTransitionTask: (taskId: string, nextStatus: 'Under Review' | 'Grounded & Updated') => void;
  handleReviewActionExecuted: (
    taskId: string,
    nextStatus: 'Under Review' | 'Grounded & Updated' | 'Rejected' | 'Banned',
    updatedTask?: ReviewTask
  ) => void;

  activeSandboxGap: { id: string; query: string } | null;
  setActiveSandboxGap: (gap: { id: string; query: string } | null) => void;
  sandboxFilename: string;
  setSandboxFilename: (val: string) => void;
  sandboxContent: string;
  setSandboxContent: (val: string) => void;
  sandboxOwner: string;
  setSandboxOwner: (val: string) => void;
  sandboxScope: 'global' | 'brand';
  setSandboxScope: (val: 'global' | 'brand') => void;
  handleSaveSandboxAddendum: () => void;
  activeDispatchTask: ReviewTask | null;
  setActiveDispatchTask: (task: ReviewTask | null) => void;
  dispatchOwnerName: string;
  setDispatchOwnerName: (val: string) => void;
  dispatchDepartment: string;
  setDispatchDepartment: (val: string) => void;
  dispatchPriority: 'Urgent' | 'High' | 'Medium' | 'Low';
  setDispatchPriority: (val: 'Urgent' | 'High' | 'Medium' | 'Low') => void;
  dispatchNotes: string;
  setDispatchNotes: (val: string) => void;
  handleOpenDispatchPortal: (task: ReviewTask) => void;
  handleSaveDispatchAction: () => void;
}

const GovernancePanelContext = createContext<GovernancePanelContextValue | null>(null);

export const useGovernancePanelContext = () => {
  const ctx = useContext(GovernancePanelContext);
  if (!ctx) throw new Error('useGovernancePanelContext must be used within GovernancePanelProvider');
  return ctx;
};

export const GovernancePanelProvider = GovernancePanelContext.Provider;
