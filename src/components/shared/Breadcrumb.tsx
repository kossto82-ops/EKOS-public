/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useLocale } from '../../context/LocaleContext';

export interface BreadcrumbItem {
  label: string;
  icon?: React.ElementType;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
  const { t } = useLocale();
  if (!items || items.length === 0) return null;

  return (
    <nav
      className="flex items-center flex-wrap gap-1.5 text-xs text-slate-500 dark:text-slate-400 select-none font-sans"
      aria-label={t('breadcrumb.navAria')}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={index}>
            <div
              role={item.onClick ? "button" : undefined}
              tabIndex={item.onClick ? 0 : undefined}
              aria-current={isLast ? 'page' : undefined}
              onClick={item.onClick}
              onKeyDown={item.onClick ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  item.onClick?.();
                }
              } : undefined}
              className={`flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded-sm ${
                isLast
                  ? 'font-bold text-slate-900 dark:text-white border-b-2 border-brand-500/70'
                  : item.onClick
                    ? 'font-medium text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400 cursor-pointer transition-colors'
                    : 'font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-500 dark:text-slate-500" />}
              <span className="truncate max-w-[120px] sm:max-w-[200px]">{item.label}</span>
            </div>
            {!isLast && (
              <span className="text-slate-300 dark:text-slate-700 px-0.5 select-none" aria-hidden="true">/</span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
