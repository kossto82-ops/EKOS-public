/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface EkosMarkProps {
  className?: string;
}

// Inlined (not <img src>) so `currentColor` picks up the surrounding text color —
// mirrors src/assets/brand/ekos-symbol-small-mono.svg (sub-32px, mono variant).
export const EkosMark: React.FC<EkosMarkProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" fill="currentColor" role="img" aria-label="EKOS" className={className}>
    <rect x="6" y="6" width="20" height="20" rx="2" />
    <rect x="14" y="14" width="20" height="20" rx="2" />
  </svg>
);
