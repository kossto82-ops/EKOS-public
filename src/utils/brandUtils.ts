/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Brand } from '../types';

const COLOR_MAP: Record<string, string> = {
  orange: '#f97316',
  blue: '#3b82f6',
  emerald: '#10b981',
  violet: '#8b5cf6',
  fuchsia: '#d946ef',
  rose: '#f43f5e',
  amber: '#f59e0b',
  teal: '#14b8a6',
  indigo: '#6366f1',
  slate: '#64748b',
  cyan: '#06b6d4',
  pink: '#ec4899',
  lime: '#84cc16',
  sky: '#0ea5e9',
};

export function getBrandDisplayName(brandId: string | undefined, brands: Brand[]): string {
  if (!brandId) return '';
  const brand = brands.find(b => b.id === brandId);
  return brand ? brand.displayName : brandId;
}

export function getBrandHexColor(brandId: string, brands: Brand[]): string {
  if (!brandId) return '#6366f1';
  const brand = brands.find(b => b.id === brandId);
  if (!brand || !brand.color) return '#6366f1';
  return COLOR_MAP[brand.color] || '#6366f1';
}
