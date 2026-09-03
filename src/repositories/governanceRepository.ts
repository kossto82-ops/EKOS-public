/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Policy storage for PolicyManager — the only live caller.
 *
 * The dead getAiConfig/updateAiConfig, getSearchGaps/saveSearchGaps,
 * getReviewTasks/saveReviewTasks and getDeskSettings/saveDeskSettings methods
 * were removed: every one of them read and wrote localStorage, which
 * contradicts the project invariant that SQLite is the source of truth. They
 * had no callers, but a future wire-up would have silently followed that stale
 * contract instead of the real /api/db/governance/* endpoints (via
 * governanceService) — and, for review tasks, instead of the document-derived
 * queue in useKbGovernanceData.ts.
 *
 * NOTE: getPolicies/savePolicies below are still localStorage-backed. That is a
 * known, separate gap (policies have no server route yet) — see the
 * "wire the Governance work-queue to its REST endpoints" item in the README.
 */

export interface ISearchGap {
  id: string;
  query: string;
  timestamp: string;
  hasResults: boolean;
  dominantSource: string;
  escalated: boolean;
  confidence: string;
  resolved: boolean;
}

export interface IPolicy {
  id: string;
  title: string;
  description: string;
  category: string;
  departmentScope: 'global' | 'specific';
  departmentIds?: string[];
  createdAt: string;
  createdBy: string;
}

export interface IDeskSettings {
  maxAnswerSec: number;
  escalationStarLimit: number;
  enableSlack: boolean;
  enableGdpr: boolean;
}

export interface IGovernanceRepository {

  getPolicies(): Promise<IPolicy[]>;
  savePolicies(policies: IPolicy[]): Promise<void>;

}

class GovernanceRepositoryImpl implements IGovernanceRepository {
  async getPolicies(): Promise<IPolicy[]> {
    try {
      const saved = localStorage.getItem('kb_policies');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to get policies:', e);
    }

    // Seed default policies — one per major department area, plus one global
    const defaultPolicies: IPolicy[] = [
      {
        id: 'policy_gdpr_retention',
        title: 'GDPR Data Retention Policy',
        description: 'Customer PII collected during support interactions must be retained for a maximum of 24 months, after which it must be anonymized or deleted. Requests for early deletion (Right to Erasure) must be processed within 30 days.',
        category: 'Data Retention',
        departmentScope: 'specific',
        departmentIds: ['legal', 'administration'],
        createdAt: new Date(Date.now() - 3600000 * 24 * 30).toISOString(),
        createdBy: 'Isabelle Mercier'
      },
      {
        id: 'policy_sla_escalation',
        title: 'SLA Escalation Policy',
        description: 'Any customer query left unresolved for more than 4 business hours must be escalated to the assigned Team Leader. Critical issues (system outages, billing disputes over €500) must be escalated immediately regardless of time elapsed.',
        category: 'SLA Escalation',
        departmentScope: 'specific',
        departmentIds: ['customer_service', 'call_center'],
        createdAt: new Date(Date.now() - 3600000 * 24 * 45).toISOString(),
        createdBy: 'Jamie Chen'
      },
      {
        id: 'policy_access_review',
        title: 'Quarterly Access Review Policy',
        description: 'All user role and brand access assignments must be reviewed on a quarterly basis. Inactive accounts (no login for 90+ days) must be flagged for deactivation.',
        category: 'Access Review',
        departmentScope: 'specific',
        departmentIds: ['it'],
        createdAt: new Date(Date.now() - 3600000 * 24 * 15).toISOString(),
        createdBy: 'Priya Anand'
      },
      {
        id: 'policy_confidentiality',
        title: 'Enterprise Confidentiality Standard',
        description: 'All employees, regardless of department, must not share internal pricing, client data, or operational procedures outside of authorized enterprise channels. Violations must be reported to Administration.',
        category: 'Compliance',
        departmentScope: 'global',
        createdAt: new Date(Date.now() - 3600000 * 24 * 60).toISOString(),
        createdBy: 'Raúl García'
      }
    ];
    localStorage.setItem('kb_policies', JSON.stringify(defaultPolicies));
    return defaultPolicies;
  }

  async savePolicies(policies: IPolicy[]): Promise<void> {
    try {
      localStorage.setItem('kb_policies', JSON.stringify(policies));
    } catch (e) {
      console.error('Failed to save policies:', e);
    }
  }

}

export const governanceRepository: IGovernanceRepository = new GovernanceRepositoryImpl();
