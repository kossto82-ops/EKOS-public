/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tab } from '../../types';
import { resolveIcon } from '../../utils/iconResolver';

interface NavItemProps {
  tab: Tab;
  label: string;
  description?: string;
  group?: string;
  icon: React.ElementType;
  isActive: boolean;
  onClick: () => void;
  badgeCount?: number;
  isAuthorized?: boolean;
}

export const NavItem: React.FC<NavItemProps> = ({
  tab,
  label,
  description,
  group,
  icon: Icon,
  isActive,
  onClick,
  badgeCount,
  isAuthorized = true
}) => {
  if (!isAuthorized) return null;
  return (
    <div className="relative group flex items-center justify-center my-0.5" id={`nav_tab_wrapper_${tab}`}>
      <button
        onClick={onClick}
        id={`nav_tab_${tab}`}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        className={`flex h-10 w-10 items-center justify-center rounded-md transition-all duration-150 cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
          isActive
            ? 'bg-slate-800 text-white border border-slate-700/50 shadow-xs'
            : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
        }`}
      >
        {/* Left vertical selection accent bar */}
        {isActive && (
          <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-brand-500 rounded-r-md"></div>
        )}
        <span className="flex-shrink-0">
          <Icon className="h-4 w-4" />
        </span>

        {/* Small metric count overlay */}
        {badgeCount !== undefined && badgeCount > 0 && (
          <span
            className={`absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-sm px-1 text-3xs leading-none font-mono font-bold border ${
              isActive
                ? 'bg-brand-600 text-white border-white/10'
                : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
          >
            {badgeCount}
          </span>
        )}
      </button>

      {/* Right-side floating Tooltip */}
      <div className="absolute left-14 bg-slate-950 text-white rounded-sm p-2 z-50 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:translate-x-1 group-focus-within:opacity-100 group-focus-within:translate-x-1 translate-x-0 transition-all duration-150 shadow-lg border border-slate-800 flex flex-col gap-0 min-w-[160px]">
        {group && (
          <span className="text-5xs font-mono font-bold uppercase tracking-widest text-slate-500">
            {group}
          </span>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-bold text-slate-100">{label}</span>
        </div>
      </div>
    </div>
  );
};
