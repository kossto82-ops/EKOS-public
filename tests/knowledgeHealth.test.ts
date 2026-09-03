import { describe, it, expect } from 'vitest';
import {
  computeKnowledgeHealth,
  HEALTH_WEIGHTS,
  HEALTH_FLOOR,
  HEALTH_MAX,
} from '../src/utils/knowledgeHealth.ts';

/**
 * The health score is shown to operators with its breakdown, so the number and
 * the deductions beside it must always add up — a score that did not equal
 * 100 minus its own listed penalties would be worse than no breakdown at all.
 */

const clean = { unowned: 0, overdueReview: 0, negativeFeedback: 0, zeroResultQuery: 0 };

describe('computeKnowledgeHealth', () => {
  it('is a perfect score with no defects', () => {
    const h = computeKnowledgeHealth(clean);
    expect(h.score).toBe(HEALTH_MAX);
    expect(h.rawScore).toBe(HEALTH_MAX);
    expect(h.floored).toBe(false);
    expect(h.deductions.every((d) => d.points === 0)).toBe(true);
  });

  it('subtracts count × weight per factor', () => {
    const h = computeKnowledgeHealth({ ...clean, unowned: 2, overdueReview: 1 });
    // 100 − 2×8 − 1×5 = 79
    expect(h.rawScore).toBe(100 - 2 * HEALTH_WEIGHTS.unowned - 1 * HEALTH_WEIGHTS.overdueReview);
    expect(h.score).toBe(79);
    expect(h.floored).toBe(false);
  });

  it('the score equals 100 minus the sum of listed deductions (the invariant the UI shows)', () => {
    const h = computeKnowledgeHealth({ unowned: 1, overdueReview: 2, negativeFeedback: 1, zeroResultQuery: 3 });
    const listed = h.deductions.reduce((sum, d) => sum + d.points, 0);
    expect(h.rawScore).toBe(HEALTH_MAX - listed);
  });

  it('clamps to the floor and reports it, keeping the raw score for context', () => {
    const h = computeKnowledgeHealth({ ...clean, unowned: 100 });
    expect(h.score).toBe(HEALTH_FLOOR);
    expect(h.rawScore).toBeLessThan(HEALTH_FLOOR);
    expect(h.floored).toBe(true);
  });

  it('orders deductions by severity, worst first', () => {
    const h = computeKnowledgeHealth(clean);
    expect(h.deductions.map((d) => d.key)).toEqual([
      'unowned',
      'negativeFeedback',
      'overdueReview',
      'zeroResultQuery',
    ]);
    // The declared ordering must match a strictly descending weight, or the
    // "worst first" claim in the file header is not actually true.
    const weights = h.deductions.map((d) => d.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });

  it('treats negative inputs as zero rather than adding points back', () => {
    const h = computeKnowledgeHealth({ ...clean, unowned: -3 });
    expect(h.score).toBe(HEALTH_MAX);
    expect(h.deductions.find((d) => d.key === 'unowned')?.points).toBe(0);
  });
});
