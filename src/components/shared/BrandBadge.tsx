/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Brand } from '../../types';
import { BRANDS } from '../../constants/brands';
import { Badge } from './DesignSystem';

interface BrandBadgeProps {
  brand?: Brand;
  brandId?: string;
  /**
   * Kept for call-site compatibility. Both current call sites (Header,
   * Sidebar) already pass "xs", which now maps onto Badge's own standard
   * outline weight — there is no second outline size to pick between
   * post-migration, so this no longer changes the render. Left in the props
   * rather than removed so existing call sites don't need touching for an
   * unrelated refactor.
   */
  size?: 'sm' | 'xs';
  className?: string;
  id?: string;
}

export const BrandBadge: React.FC<BrandBadgeProps> = ({
  brand,
  brandId,
  className = '',
  id
}) => {
  // Resolve brand if brandId is given
  const resolvedBrand = brand || BRANDS.find(b => b.id === brandId);

  if (!resolvedBrand || brandId === '*') {
    return (
      <Badge
        id={id}
        appearance="outline"
        variant="neutral"
        className={className}
      >
        ALL
      </Badge>
    );
  }

  // Accent colour, keyed off shortCode: violet for ES, blue for FR, emerald
  // for DE, indigo as the shared default for every other brand — unchanged
  // from the pre-migration mapping. Expressed as the same hex triad
  // utils/brandUtils.ts's COLOR_MAP uses, driven through Badge's
  // `appearance="outline"` + `variant="inherit"`, the pattern already built
  // for the header's runtime-coloured brand chip, rather than hand-rolling a
  // second outline-badge geometry with its own colour objects.
  let accentHex = '#6366f1'; // indigo
  const code = resolvedBrand.shortCode?.toUpperCase();
  if (code === 'ES') accentHex = '#8b5cf6'; // violet
  else if (code === 'FR') accentHex = '#3b82f6'; // blue
  else if (code === 'DE') accentHex = '#10b981'; // emerald

  return (
    <Badge
      id={id}
      appearance="outline"
      variant="inherit"
      className={className}
      style={{
        color: accentHex,
        borderColor: accentHex + '40',
        backgroundColor: accentHex + '1a'
      }}
    >
      <span className="font-mono font-bold">{resolvedBrand.shortCode}</span>
    </Badge>
  );
};
