/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserRole, Tab } from '../types';

export type GovernanceAction = 'manage_users' | 'upload_kb' | 'manage_rates' | 'view_review_queue' | 'manage_governance';

/**
 * Single source of truth for tab-visibility rules, used by AuthContext's
 * `canAccess`/`canViewTab` and directly exercised by tests/auth.test.ts —
 * kept here as a pure function so both can share the same logic instead of
 * a test maintaining its own copy that can silently drift.
 */
export function canAccessTab(role: UserRole | undefined, departmentIds: string[], tab: Tab): boolean {
  const isIT = departmentIds.includes('it') || departmentIds.includes('*');
  switch (tab) {
    case 'sync':
      return role === 'Administrator' || isIT;
    case 'governance':
      return role === 'Administrator' || role === 'LocationManager';
    // The review queue (its own top-level tab) is gated on EXACTLY the same
    // predicate as the 'governance' case above — it used to be a sub-tab
    // gated by canAccess('governance') before the IA split promoted it to a
    // sibling destination. Keep these two cases identical; do not let them
    // drift independently.
    case 'review':
      return role === 'Administrator' || role === 'LocationManager';
    case 'settings':
      return role === 'Administrator' || role === 'LocationManager' || role === 'TeamLeader' || isIT;
    case 'kb':
    case 'copilot':
    case 'sources':
    default:
      return true;
  }
}

/**
 * Single source of truth for action-permission rules, used by AuthContext's
 * `canPerformAction` and directly exercised by tests/auth.test.ts.
 */
export function canPerformGovernanceAction(
  role: UserRole | undefined,
  departmentIds: string[],
  action: GovernanceAction
): boolean {
  if (!role) return false;
  const isIT = departmentIds.includes('it') || departmentIds.includes('*');
  switch (action) {
    case 'manage_users':
      return role === 'Administrator' || role === 'TeamLeader';
    case 'upload_kb':
      return role === 'Administrator' || role === 'TeamLeader' || role === 'LocationManager';
    case 'manage_rates':
      return role === 'Administrator';
    case 'manage_governance':
      // Writing governance config (AI provider, desk settings, gaps, review
      // tasks) is Administrator-only. LocationManager can VIEW the governance
      // tab (canAccessTab) but is read-only there — enforced server-side here,
      // not just by a disabled button in the UI.
      return role === 'Administrator';
    case 'view_review_queue':
      return role === 'Administrator' || role === 'TeamLeader' || role === 'LocationManager' || isIT;
    default:
      return false;
  }
}
