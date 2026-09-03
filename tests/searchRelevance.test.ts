import { describe, it, expect } from 'vitest';
import { fuzzyMatch, MOCK_KNOWLEDGE_BASE } from '../src/api/searchApi';

/**
 * Regression coverage for a real content-accuracy bug found in manual QA:
 * a query about the customer-facing refund/cooling-off policy matched
 * "SLA Non-Compliance Compensation Scheme" instead, because that entry's
 * keyword list included "refund" — a term that belongs to a completely
 * different topic (ans_refund_policy) — with a higher base weight, so it
 * won on raw weight despite being the wrong answer. See docs/DECISIONS.md (ADR-015).
 */
describe('fuzzyMatch (src/api/searchApi.ts)', () => {
  it('routes a refund/cooling-off question to the refund policy, not SLA penalties', () => {
    const result = fuzzyMatch(
      'Can a client request a refund after the cooling-off period?',
      MOCK_KNOWLEDGE_BASE
    );
    expect(result.id).toBe('ans_refund_policy');
  });

  it('routes an SLA breach/credit question to the SLA penalties entry', () => {
    const result = fuzzyMatch(
      'What credit is owed to a client after an SLA breach?',
      MOCK_KNOWLEDGE_BASE
    );
    expect(result.id).toBe('ans_sla_penalties');
  });

  it('prefers the entry with more matched keywords over one with a single higher-weight match', () => {
    // "billing" alone matches ans_billing (weight 8); "money"+"back" together
    // match ans_refund_policy (weight 7) on two keywords — match count should win.
    const result = fuzzyMatch('I want my money back', MOCK_KNOWLEDGE_BASE);
    expect(result.id).toBe('ans_refund_policy');
  });

  it('falls back to a generated answer when nothing matches', () => {
    const result = fuzzyMatch('What is the meaning of life?', MOCK_KNOWLEDGE_BASE);
    expect(result.id).toMatch(/^ans_gen_/);
  });
});
