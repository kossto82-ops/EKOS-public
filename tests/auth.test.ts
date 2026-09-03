import { describe, it, expect } from 'vitest';
import { canAccessTab, canPerformGovernanceAction } from '../src/utils/rbac';

/**
 * Exercises the real RBAC logic in src/utils/rbac.ts — the same functions
 * AuthContext.tsx's canAccess()/canPerformAction() call — so a regression
 * in the actual production rules fails this suite instead of silently
 * drifting from a hand-copied replica.
 */
type Role = 'Administrator' | 'LocationManager' | 'TeamLeader' | 'Operator' | 'Agent';

describe('RBAC — canAccessTab (tab visibility)', () => {
  const roles: Role[] = ['Administrator', 'LocationManager', 'TeamLeader', 'Operator', 'Agent'];

  it('kb / copilot / sources are visible to every role', () => {
    for (const role of roles) {
      expect(canAccessTab(role, [], 'kb')).toBe(true);
      expect(canAccessTab(role, [], 'copilot')).toBe(true);
      expect(canAccessTab(role, [], 'sources')).toBe(true);
    }
  });

  it('sync is restricted to Administrator or IT department members', () => {
    expect(canAccessTab('Administrator', [], 'sync')).toBe(true);
    expect(canAccessTab('Agent', ['it'], 'sync')).toBe(true);
    expect(canAccessTab('Agent', ['*'], 'sync')).toBe(true);
    expect(canAccessTab('LocationManager', [], 'sync')).toBe(false);
    expect(canAccessTab('TeamLeader', [], 'sync')).toBe(false);
    expect(canAccessTab('Agent', ['customer_service'], 'sync')).toBe(false);
  });

  it('governance is restricted to Administrator and LocationManager only (not even IT)', () => {
    expect(canAccessTab('Administrator', [], 'governance')).toBe(true);
    expect(canAccessTab('LocationManager', [], 'governance')).toBe(true);
    expect(canAccessTab('TeamLeader', [], 'governance')).toBe(false);
    expect(canAccessTab('Operator', [], 'governance')).toBe(false);
    expect(canAccessTab('Agent', ['it'], 'governance')).toBe(false);
  });

  it('settings is open to Administrator, LocationManager, TeamLeader, and IT', () => {
    expect(canAccessTab('Administrator', [], 'settings')).toBe(true);
    expect(canAccessTab('LocationManager', [], 'settings')).toBe(true);
    expect(canAccessTab('TeamLeader', [], 'settings')).toBe(true);
    expect(canAccessTab('Agent', ['it'], 'settings')).toBe(true);
    expect(canAccessTab('Operator', [], 'settings')).toBe(false);
    expect(canAccessTab('Agent', ['customer_service'], 'settings')).toBe(false);
  });
});

describe('RBAC — canPerformGovernanceAction', () => {
  it('manage_users is Administrator/TeamLeader only', () => {
    expect(canPerformGovernanceAction('Administrator', [], 'manage_users')).toBe(true);
    expect(canPerformGovernanceAction('TeamLeader', [], 'manage_users')).toBe(true);
    expect(canPerformGovernanceAction('LocationManager', [], 'manage_users')).toBe(false);
    expect(canPerformGovernanceAction('Agent', [], 'manage_users')).toBe(false);
  });

  it('upload_kb includes LocationManager alongside Administrator/TeamLeader', () => {
    expect(canPerformGovernanceAction('LocationManager', [], 'upload_kb')).toBe(true);
    expect(canPerformGovernanceAction('Administrator', [], 'upload_kb')).toBe(true);
    expect(canPerformGovernanceAction('TeamLeader', [], 'upload_kb')).toBe(true);
    expect(canPerformGovernanceAction('Operator', [], 'upload_kb')).toBe(false);
  });

  it('manage_governance is Administrator-only — LocationManager can VIEW governance but not write (S7)', () => {
    // The governance tab is visible to LocationManager (canAccessTab), but the
    // write action must be Admin-only so the read-only UI is enforced server-side
    // too (governance POST routes are gated on this action, not requireTab).
    expect(canPerformGovernanceAction('Administrator', [], 'manage_governance')).toBe(true);
    expect(canAccessTab('LocationManager', [], 'governance')).toBe(true);
    expect(canPerformGovernanceAction('LocationManager', [], 'manage_governance')).toBe(false);
    expect(canPerformGovernanceAction('TeamLeader', [], 'manage_governance')).toBe(false);
    expect(canPerformGovernanceAction('Agent', ['it'], 'manage_governance')).toBe(false);
  });

  it('manage_rates is Administrator-only', () => {
    expect(canPerformGovernanceAction('Administrator', [], 'manage_rates')).toBe(true);
    expect(canPerformGovernanceAction('LocationManager', [], 'manage_rates')).toBe(false);
    expect(canPerformGovernanceAction('TeamLeader', [], 'manage_rates')).toBe(false);
  });

  it('view_review_queue includes IT department regardless of role', () => {
    expect(canPerformGovernanceAction('Agent', ['it'], 'view_review_queue')).toBe(true);
    expect(canPerformGovernanceAction('Operator', ['customer_service'], 'view_review_queue')).toBe(false);
  });

  it('returns false for an undefined role regardless of action', () => {
    expect(canPerformGovernanceAction(undefined, ['it'], 'view_review_queue')).toBe(false);
  });
});
