/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Names of the custom `window` events used to keep the Knowledge Base
 * governance state (search gaps, review tasks, guideline documents) in sync
 * across components/repositories that don't share state directly.
 * Centralized so a typo at any dispatch/listener call site is caught at
 * compile time instead of silently failing at runtime.
 */
export const KB_EVENTS = {
  SEARCH_GAPS_UPDATED: 'kb_search_gaps_updated',
  REVIEW_TASKS_UPDATED: 'kb_review_tasks_updated',
  // Dispatched by the Knowledge Base tab's Metrics view when a user clicks
  // "Resolve" on a search gap. The Sandbox editor that actually resolves it
} as const;
