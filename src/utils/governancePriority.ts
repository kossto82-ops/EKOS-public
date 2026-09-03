/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReviewTask } from '../types';

export interface DynamicPriority {
  level: 'Critical' | 'High' | 'Normal';
  reason: string;
  isAged: boolean;
  score: number;
  ageInDays: number;
}

// Operational Priority Calculation & Aging Rules
export function getDynamicPriority(task: ReviewTask): DynamicPriority {
  const ageInMs = Date.now() - new Date(task.createdAt).getTime();
  const ageInDays = ageInMs / (1000 * 60 * 60 * 24);

  let level: 'Critical' | 'High' | 'Normal' = 'Normal';
  if (task.priority === 'Urgent' || task.priority === 'Critical') {
    level = 'Critical';
  } else if (task.priority === 'High') {
    level = 'High';
  }

  let isAged = false;
  let reason = 'Baseline criteria met';

  // Rule 1: Severity boost
  const hasSevereFlags =
    task.flags &&
    (task.flags.includes('Price Mismatch') ||
      task.flags.includes('SLA Alert') ||
      task.flags.includes('SLA Drift'));
  if (hasSevereFlags) {
    if (level === 'Normal') {
      level = 'High';
      reason = 'Severity Boost: SLA Risk';
    } else if (level === 'High') {
      level = 'Critical';
      reason = 'Severity Boost: Price/SLA Anomaly';
    }
  }

  // Rule 2: Recurrent anomalies boost
  if ((task.similarIncidents ?? 0) >= 3 && level !== 'Critical') {
    level = 'Critical';
    reason = 'Recurrence Boost: Cumulative failures (≥3)';
  }

  // Rule 3: Time-based aging promotions
  if (ageInDays >= 5 && level !== 'Critical') {
    level = 'Critical';
    isAged = true;
    reason = 'Aging: Immediate Action required (>5 days)';
  } else if (ageInDays >= 2 && level === 'Normal') {
    level = 'High';
    isAged = true;
    reason = 'Aging: Queue promotion (>48h pending)';
  } else if (ageInDays >= 1 && level === 'High') {
    level = 'Critical';
    isAged = true;
    reason = 'Aging: Elevated priority (>24h pending)';
  }

  let levelWeight = 1000;
  if (level === 'Critical') levelWeight = 3000;
  else if (level === 'High') levelWeight = 2000;

  const score = levelWeight + ageInMs / 100000;

  return { level, reason, isAged, score, ageInDays };
}
