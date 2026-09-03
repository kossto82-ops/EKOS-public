/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext, useState, useRef, useEffect } from 'react';
import { useBrand } from '../../hooks/useBrand';
import { useDepartment } from '../../hooks/useDepartment';
import { AuthContext } from '../../context/AuthContext';
import { BrandBadge } from '../shared/BrandBadge';
import { Badge } from '../shared/DesignSystem';
import { EkosMark } from '../shared/EkosMark';
import { Bell, ChevronRight, Sun, Moon, ChevronDown, LogOut } from 'lucide-react';
import { useBreadcrumbs } from '../../context/BreadcrumbContext';
import { Breadcrumb } from '../shared/Breadcrumb';
import { getBrandHexColor as resolveBrandHex } from '../../utils/brandUtils';
import { useLocale, SUPPORTED_LOCALES, LocaleCode } from '../../context/LocaleContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { OVERLAY_Z } from '../shared/DesignSystem';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  darkMode?: boolean;
  onToggleDark?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  ctaLabel,
  onCtaClick,
  darkMode,
  onToggleDark
}) => {
  const { activeBrand, allBrands } = useBrand();
  const { activeDepartment } = useDepartment();
  const { breadcrumbs } = useBreadcrumbs();
  const { locale, setLocale, t } = useLocale();
  const auth = useContext(AuthContext);

  if (!auth) return null;
  const { currentUser, allUsers, setCurrentUserById, authMode, logout } = auth;

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuTrapRef = useFocusTrap<HTMLDivElement>(isDropdownOpen);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDropdownOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDropdownOpen]);

  // Active brand color mapping for team badge
  const getBrandHexColor = (id: string): string => {
    return resolveBrandHex(id, allBrands);
  };

  const brandColor = getBrandHexColor(activeBrand.id);

  const handleDarkToggle = onToggleDark;
  const isDarkModeActive = darkMode;

  const filteredUsers = (allUsers || []).filter(u => {
    const query = searchQuery.toLowerCase();
    return (
      u.name.toLowerCase().includes(query) ||
      u.role.toLowerCase().includes(query) ||
      u.email.toLowerCase().includes(query) ||
      u.brandIds.some(b => b.toLowerCase().includes(query)) ||
      u.departmentIds.some(d => d.toLowerCase().includes(query))
    );
  });

  return (
    <header className="sticky top-0 z-40 flex h-11 w-full items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 text-slate-800 dark:text-[#fafafa] selection:bg-success-500/30 transition-shadow">
      
      {/* Left: EKOS product mark -> divider -> active brand BrandBadge (pill) -> chevron-right -> Breadcrumb */}
      <div className="flex items-center gap-2">
        <EkosMark className="h-4 w-4 text-slate-800 dark:text-zinc-100 flex-shrink-0" />
        <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800/80" aria-hidden="true" />
        <BrandBadge brand={activeBrand} size="xs" id="header_active_brand_badge" />
        <ChevronRight className="h-3 w-3 text-slate-400" />
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumb items={breadcrumbs} />
        ) : (
          <>
            <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-100 font-sans tracking-tight">
              {title}
            </span>
            {subtitle && (
              <span className="text-3xs text-slate-400 dark:text-slate-500 ml-2 font-bold select-none uppercase tracking-wide">
                {subtitle}
              </span>
            )}
          </>
        )}
      </div>

      {/* Right control center */}
      <div className="flex items-center gap-3">
        
        {/* Active department + brand chip (e.g. "IT · ES"), coloured from the
            active brand at runtime — hence variant="inherit", which supplies no
            palette of its own so these inline styles are the only source of
            colour rather than an override of dead variant classes. */}
        <Badge
          appearance="outline"
          variant="inherit"
          className="whitespace-nowrap"
          style={{
            color: brandColor,
            borderColor: brandColor + '30',
            backgroundColor: brandColor + '0d'
          }}
        >
          {activeDepartment.displayName} · {activeBrand.shortCode || '??'}
        </Badge>

        {/* Language Switcher */}
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as LocaleCode)}
          aria-label={t('header.language')}
          className="text-xs bg-transparent border border-slate-200 dark:border-slate-800 rounded-md px-2 py-1 text-slate-600 dark:text-slate-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 cursor-pointer"
        >
          {SUPPORTED_LOCALES.map(l => (
            <option key={l.code} value={l.code} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-zinc-200">{l.label}</option>
          ))}
        </select>

        {/* Dark Mode Toggle Button */}
        {onToggleDark && (
          <button
            onClick={onToggleDark}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/85 transition-colors cursor-pointer flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            title={darkMode ? t('header.switchToLight') : t('header.switchToDark')}
            aria-label={t('header.toggleDark')}
            aria-pressed={!!darkMode}
          >
            {darkMode ? (
              <Sun className="h-3.5 w-3.5 text-warning-500" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {/* Vertical divider */}
        <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800/80"></div>

        {/* In oauth mode the identity is a real corporate SSO session, not an
            impersonation — show a read-only chip and a real Sign out, and hide
            the user switcher entirely. */}
        {authMode === 'oauth' ? (
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-slate-700 dark:text-zinc-300 text-xs font-medium"
              title={currentUser?.email}
            >
              <span className="font-semibold">{currentUser?.name}</span>
              <span className="text-slate-300 dark:text-slate-600 select-none">·</span>
              <span className="text-3xs bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-zinc-400 px-1.5 py-0.5 rounded-md font-mono uppercase tracking-wider font-bold scale-95">
                {currentUser?.role}
              </span>
            </div>
            <button
              onClick={() => logout()}
              className="flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 hover:border-danger-300 dark:hover:border-danger-700 text-slate-600 dark:text-zinc-300 hover:text-danger-600 dark:hover:text-danger-400 text-xs font-medium transition-all cursor-pointer focus:outline-none"
              title={t('header.signOut')}
              aria-label={t('header.signOut')}
            >
              <LogOut className="h-3 w-3" />
              <span>{t('header.signOut')}</span>
            </button>
          </div>
        ) : (
        /* Interactive User Switcher / Simulation Dropdown (legacy mode) */
        <div className="relative" ref={dropdownRef} id="user-simulation-dropdown">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-zinc-300 text-xs font-medium transition-all cursor-pointer focus:outline-none"
            title={t('header.switchUserTitle')}
            aria-label={t('header.switchUserAria', { name: currentUser?.name || 'unknown', role: currentUser?.role || 'unknown role' })}
            aria-haspopup="dialog"
            aria-expanded={isDropdownOpen}
          >
            <span className="font-semibold">{currentUser?.name}</span>
            <span className="text-slate-300 dark:text-slate-600 select-none">·</span>
            <span className="text-3xs bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-zinc-400 px-1.5 py-0.5 rounded-md font-mono uppercase tracking-wider font-bold scale-95">
              {currentUser?.role}
            </span>
            <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isDropdownOpen && (
            <div
              ref={menuTrapRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('header.selectProfile')}
              tabIndex={-1}
              className={`absolute right-0 top-full mt-2 w-80 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg text-slate-800 dark:text-zinc-200 ${OVERLAY_Z} overflow-hidden py-1 focus:outline-none`}
            >
              {/* Header inside dropdown */}
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
                <span className="text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {t('header.selectProfile')}
                </span>
                {currentUser?.id !== 'u1' && (
                  <button
                    onClick={() => {
                      setCurrentUserById('u1');
                      setIsDropdownOpen(false);
                    }}
                    className="text-3xs font-semibold text-danger-500 hover:text-danger-600 flex items-center gap-1 cursor-pointer bg-transparent border-none"
                  >
                    <LogOut className="h-2.5 w-2.5" />
                    {t('header.resetToAdmin')}
                  </button>
                )}
              </div>

              {/* Search input to easily search through the 30 users */}
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800/60">
                <label htmlFor="user_switcher_search" className="sr-only">{t('header.searchPlaceholder')}</label>
                <input
                  type="text"
                  id="user_switcher_search"
                  placeholder={t('header.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-brand-500 text-slate-800 dark:text-zinc-200"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              {/* Scrollable list of active users */}
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100/60 dark:divide-slate-800/30">
                {filteredUsers.length > 0 ? (
                  filteredUsers.map(user => {
                    const isSelected = currentUser?.id === user.id;
                    const deptLabel = user.departmentIds.includes('*') ? t('header.allDepts') : user.departmentIds.join(', ');
                    const brandLabel = user.brandIds.includes('*') ? t('header.allBrands') : user.brandIds.join(', ');

                    return (
                      <button
                        key={user.id}
                        onClick={() => {
                          setCurrentUserById(user.id);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 flex flex-col gap-0.5 transition-colors cursor-pointer border-none ${
                          isSelected ? 'bg-brand-50/50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium' : ''
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="font-semibold truncate max-w-[160px] text-slate-800 dark:text-zinc-200">
                            {user.name}
                          </span>
                          <span className="text-5xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-zinc-400 font-mono tracking-wider scale-95 origin-right">
                            {user.role}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-3xs text-slate-400 dark:text-slate-500 mt-0.5">
                          <span className="truncate max-w-[130px] font-mono">{user.email}</span>
                          <span className="truncate max-w-[110px] text-right text-4xs font-semibold text-slate-500 dark:text-zinc-400">
                            {brandLabel}
                          </span>
                        </div>
                        <div className="text-4xs font-mono text-slate-400 dark:text-slate-500">
                          {t('header.dept')} <span className="text-slate-500 dark:text-zinc-400 font-medium">{deptLabel}</span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="text-center py-4 text-xs text-slate-400 dark:text-slate-500">
                    {t('header.noProfilesMatch')}
                  </div>
                )}
              </div>

              {/* Reset simulator footer */}
              <div className="px-3 py-2 bg-slate-50/60 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800/60 text-3xs text-slate-400 dark:text-slate-500 text-center select-none font-sans leading-normal">
                {t('header.testHint')}
              </div>
            </div>
          )}
        </div>
        )}

      </div>
    </header>
  );
};
