/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReviewTask } from '../types';
import { INITIAL_REVIEW_TASKS } from '../constants/kb';
import { KB_EVENTS } from '../constants/events';
import { governanceService } from './governanceService';

/**
 * Feeds new review tasks into the Governance work queue when an agent reports
 * an issue from the Assistant.
 *
 * Persistence is durable: the task is POSTed to the server
 * (/api/db/governance/report → SQLite) so it survives reloads and is visible
 * to governance reviewers on any device. The localStorage write is kept as a
 * same-browser cache and cross-tab sync channel (REVIEW_TASKS_UPDATED), so a
 * governance view already open in this browser updates live and the flow still
 * works offline. useKbGovernanceData.ts treats the server as the source of
 * truth on load and falls back to this cache when the server is unreachable.
 *
 * The local write also mirrors the hook's schema-version guard: if a report is
 * filed before the governance tab has ever mounted and we wrote tasks without
 * stamping the version key, the hook would later see a version mismatch and
 * wipe the cache, silently dropping the just-reported task.
 */

const STORAGE_KEY = 'kb_review_tasks';
const VERSION_KEY = 'kb_review_tasks_version';
const TASKS_VERSION = 'v2';

/**
 * Reads the current review-task list, applying the same version guard and
 * initial-seed fallback as useKbGovernanceData so the two stay consistent.
 */
function loadReviewTasks(): ReviewTask[] {
  try {
    if (localStorage.getItem(VERSION_KEY) !== TASKS_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(VERSION_KEY, TASKS_VERSION);
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as ReviewTask[];
  } catch (e) {
    console.error('reviewQueueService: failed to read review tasks:', e);
  }
  // Seed the same defaults the governance hook would, so the queue a reporter
  // creates lines up with what the governance tab shows on first load.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_REVIEW_TASKS));
  return [...INITIAL_REVIEW_TASKS];
}

/**
 * Appends a task to the front of the queue (newest first). Persists durably to
 * the server and updates the local cache, notifying any mounted governance
 * view via the cross-tab event. The server write runs in the background so the
 * caller (a form submit handler) stays synchronous; if it fails, the task is
 * still cached locally and the failure is logged.
 */
export function enqueueReviewTask(task: ReviewTask): ReviewTask[] {
  const updated = [task, ...loadReviewTasks()];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event(KB_EVENTS.REVIEW_TASKS_UPDATED));
  } catch (e) {
    console.error('reviewQueueService: failed to cache review task locally:', e);
  }
  // Durable persistence to SQLite. Fire-and-forget: reporting must not block on
  // the network, and the local cache already reflects the task.
  governanceService.submitReport(task).catch((e) => {
    console.error('reviewQueueService: failed to persist review task to server:', e);
  });
  return updated;
}

export interface ReportReviewTaskInput {
  /** Report category chosen in the dialog, used as the feedback type. */
  category: string;
  /** Free-text problem description the agent typed. */
  details: string;
  /** Document/source the report is filed against. */
  documentName: string;
  /** The query that surfaced the answer being reported, for reviewer context. */
  agentQuery: string;
  /** The person responsible for the document, so the task routes to them. */
  owner: string;
  /** Human-readable department/domain label. */
  department: string;
  /** Department id(s) used to scope the task in the queue. */
  departmentIds?: string[];
  /** Confidence of the reported answer, if known. */
  aiConfidence?: number;
}

/**
 * Builds a ReviewTask from a submitted issue report. A freshly reported issue
 * lands as 'Feedback Received' so it counts toward the queue's pending total
 * and shows up as needing a reviewer's attention.
 */
export function buildReportReviewTask(input: ReportReviewTaskInput): ReviewTask {
  return {
    id: `report_${Date.now()}`,
    documentName: input.documentName,
    feedbackType: input.category,
    agentQuery: input.agentQuery,
    messageContent: input.details.trim(),
    status: 'Feedback Received',
    createdAt: new Date().toISOString(),
    owner: input.owner,
    department: input.department,
    departmentIds: input.departmentIds,
    priority: 'High',
    aiConfidence: input.aiConfidence,
    similarIncidents: 0,
    flags: ['Agent Reported'],
  };
}
