/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Knowledge Health Score, made auditable.
 *
 * The score starts at 100 and subtracts a penalty for each governance defect in
 * the corpus. The per-defect weights are **heuristic product judgement, not a
 * derived or calibrated model** — there is no ground-truth "health" to fit them
 * to. What matters, and what is defensible, is their *ordering*: the score should
 * fall fastest for the failure that leaves the corpus least trustworthy.
 *
 * Ordering rationale (worst first):
 *  - `unowned` (8): no one is accountable for the document at all — the deepest
 *    governance hole, because every other defect below assumes an owner exists to
 *    fix it.
 *  - `negativeFeedback` (6): users have actively flagged the answer as wrong; a
 *    known-bad document in front of readers outranks a merely stale or missing one.
 *  - `overdueReview` (5): past its review-by date — trustworthy once, unverified now.
 *  - `zeroResultQuery` (4): a retrieval gap rather than a bad document, and it is
 *    reconstructed from a rolling query log, so it is the most transient signal.
 *
 * These live here as named constants, in one place, so the weights can be tuned
 * (or replaced with a calibrated model) without hunting through JSX, and so the
 * UI can show the breakdown instead of a bare number.
 */

/** Points deducted per occurrence of each defect. Heuristic — see file header. */
export const HEALTH_WEIGHTS = {
  unowned: 8,
  negativeFeedback: 6,
  overdueReview: 5,
  zeroResultQuery: 4,
} as const;

/** The score never reads below this, so a bad day still shows a bounded number. */
export const HEALTH_FLOOR = 15;
export const HEALTH_MAX = 100;

export type HealthFactorKey = keyof typeof HEALTH_WEIGHTS;

export interface HealthDeduction {
  key: HealthFactorKey;
  /** Human label for the UI. */
  label: string;
  /** How many documents/queries tripped this factor. */
  count: number;
  /** Points removed per occurrence. */
  weight: number;
  /** count × weight — total points this factor removed. */
  points: number;
}

export interface HealthInputs {
  unowned: number;
  overdueReview: number;
  negativeFeedback: number;
  zeroResultQuery: number;
}

export interface KnowledgeHealth {
  /** Final score, clamped to [HEALTH_FLOOR, HEALTH_MAX]. */
  score: number;
  /** Raw 100 − Σ penalties, before clamping — exposed so the UI can say "floored". */
  rawScore: number;
  /** True when the raw score fell below the floor and was clamped up. */
  floored: boolean;
  /** Every factor, in severity order; `points: 0` where a factor is clean. */
  deductions: HealthDeduction[];
}

const LABELS: Record<HealthFactorKey, string> = {
  unowned: 'Unowned docs',
  negativeFeedback: 'Negative feedback',
  overdueReview: 'Overdue review',
  zeroResultQuery: 'Zero-result queries',
};

// Severity order the UI renders in — matches the file-header rationale.
const ORDER: HealthFactorKey[] = ['unowned', 'negativeFeedback', 'overdueReview', 'zeroResultQuery'];

/**
 * Compute the score and the full deduction breakdown from the current corpus
 * defect counts. Pure: same inputs → same output, no clock or IO.
 */
export function computeKnowledgeHealth(inputs: HealthInputs): KnowledgeHealth {
  const counts: Record<HealthFactorKey, number> = {
    unowned: inputs.unowned,
    negativeFeedback: inputs.negativeFeedback,
    overdueReview: inputs.overdueReview,
    zeroResultQuery: inputs.zeroResultQuery,
  };

  const deductions: HealthDeduction[] = ORDER.map((key) => {
    const count = Math.max(0, counts[key]);
    const weight = HEALTH_WEIGHTS[key];
    return { key, label: LABELS[key], count, weight, points: count * weight };
  });

  const totalPenalty = deductions.reduce((sum, d) => sum + d.points, 0);
  const rawScore = HEALTH_MAX - totalPenalty;
  const score = Math.min(HEALTH_MAX, Math.max(HEALTH_FLOOR, rawScore));

  return { score, rawScore, floored: rawScore < HEALTH_FLOOR, deductions };
}
