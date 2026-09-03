import { describe, it, expect } from 'vitest';
import { isGroundableDoc, isRetrievableDoc, isDocVisibleToCaller } from '../src/server/grounding';

/**
 * Locks the shared grounding predicates used by /api/search, /api/kb-chat and
 * /api/copilot-draft (src/server/grounding.ts). Regression guard for the bug
 * where SOP_Referral_Program_EN.md (status:'pending' but with real content) was
 * excluded from /api/search while remaining answerable on /kb-chat, because the
 * three routes each inlined a different `status` check.
 */

const base = { approvalStatus: 'Under Review', content: 'A referral is a trackable code…', status: 'trained' };

describe('isGroundableDoc — governance gate (denylist)', () => {
  it('allows Approved and Under Review', () => {
    expect(isGroundableDoc({ ...base, approvalStatus: 'Approved' })).toBe(true);
    expect(isGroundableDoc({ ...base, approvalStatus: 'Under Review' })).toBe(true);
  });
  it('blocks Banned, Draft, soft-deleted and expired', () => {
    expect(isGroundableDoc({ ...base, approvalStatus: 'Banned' })).toBe(false);
    expect(isGroundableDoc({ ...base, approvalStatus: 'Draft' })).toBe(false);
    expect(isGroundableDoc({ ...base, deletedAt: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(isGroundableDoc({ ...base, expirationDate: '2000-01-01T00:00:00Z' })).toBe(false);
  });
});

describe('isRetrievableDoc — search/grounding candidate', () => {
  it("includes a 'pending' doc that has real content (the SOP_Referral case)", () => {
    expect(isRetrievableDoc({ approvalStatus: 'Under Review', status: 'pending', content: 'referral program details' })).toBe(true);
  });
  it("includes a 'trained' doc even with empty content", () => {
    expect(isRetrievableDoc({ approvalStatus: 'Approved', status: 'trained', content: '' })).toBe(true);
  });
  it("excludes a 'pending' doc with no content", () => {
    expect(isRetrievableDoc({ approvalStatus: 'Under Review', status: 'pending', content: '   ' })).toBe(false);
    expect(isRetrievableDoc({ approvalStatus: 'Under Review', status: 'pending' })).toBe(false);
  });
  it('excludes non-groundable docs regardless of content/status', () => {
    expect(isRetrievableDoc({ approvalStatus: 'Banned', status: 'trained', content: 'x' })).toBe(false);
    expect(isRetrievableDoc({ approvalStatus: 'Under Review', status: 'trained', content: 'x', deletedAt: '2026-01-01' })).toBe(false);
  });
});

/**
 * Caller-scope enforcement for AI grounding. Regression guard for the hole where
 * /api/kb-chat and /api/copilot-draft grounded on client-supplied doc arrays
 * (so any caller could inject arbitrary or another brand's content into the LLM
 * prompt) and /api/search honored only the REQUESTED brandId, never the
 * caller's own scope.
 */
describe('isDocVisibleToCaller — caller scope for AI grounding', () => {
  const globalDoc = { scope: 'global', departmentScope: 'global', departmentIds: [] };
  const northwind_deDoc = { scope: 'brand', brandId: 'northwind_de', departmentScope: 'global', departmentIds: [] };
  const esDoc = { scope: 'brand', brandId: 'northwind_es', departmentScope: 'global', departmentIds: [] };
  const csDoc = { scope: 'global', departmentScope: 'specific', departmentIds: ['customer_service'] };

  const admin = { brandIds: ['*'], departmentIds: ['*'] };
  const esAgent = { brandIds: ['northwind_es'], departmentIds: ['customer_service'] };

  it('an unrestricted admin sees every document', () => {
    for (const d of [globalDoc, northwind_deDoc, esDoc, csDoc]) {
      expect(isDocVisibleToCaller(d, admin)).toBe(true);
    }
  });

  it("a brand-scoped caller cannot reach ANOTHER brand's document", () => {
    expect(isDocVisibleToCaller(esDoc, esAgent)).toBe(true);
    expect(isDocVisibleToCaller(northwind_deDoc, esAgent)).toBe(false);
  });

  it('a requested brandId cannot WIDEN the caller\'s scope (privilege escalation)', () => {
    // The ES agent explicitly asks for northwind_de's documents — still denied.
    expect(isDocVisibleToCaller(northwind_deDoc, esAgent, { brandId: 'northwind_de' })).toBe(false);
  });

  it('a requested brandId DOES narrow within the allowed set', () => {
    expect(isDocVisibleToCaller(esDoc, admin, { brandId: 'northwind_de' })).toBe(false);
    expect(isDocVisibleToCaller(northwind_deDoc, admin, { brandId: 'northwind_de' })).toBe(true);
    // Global docs survive brand narrowing (they belong to every brand).
    expect(isDocVisibleToCaller(globalDoc, admin, { brandId: 'northwind_de' })).toBe(true);
  });

  it('department scope is enforced and narrowable', () => {
    const hrAgent = { brandIds: ['*'], departmentIds: ['human_resources'] };
    expect(isDocVisibleToCaller(csDoc, hrAgent)).toBe(false);
    expect(isDocVisibleToCaller(csDoc, esAgent)).toBe(true);
    expect(isDocVisibleToCaller(csDoc, admin, { departmentId: 'human_resources' })).toBe(false);
    expect(isDocVisibleToCaller(globalDoc, admin, { departmentId: 'human_resources' })).toBe(true);
  });

  it('a caller with no scope at all sees only global/global documents', () => {
    const nobody = { brandIds: [], departmentIds: [] };
    expect(isDocVisibleToCaller(globalDoc, nobody)).toBe(true);
    expect(isDocVisibleToCaller(esDoc, nobody)).toBe(false);
    expect(isDocVisibleToCaller(csDoc, nobody)).toBe(false);
    expect(isDocVisibleToCaller(globalDoc, undefined)).toBe(true);
  });
});
