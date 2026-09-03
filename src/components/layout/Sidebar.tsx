/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext, useState, useRef, useEffect } from 'react';
import { Tab } from '../../types';
import { AuthContext } from '../../context/AuthContext';
import { useBrand } from '../../hooks/useBrand';
import { useDepartment } from '../../hooks/useDepartment';
import { useDarkMode } from '../../hooks/useDarkMode';
import { resolveIcon } from '../../utils/iconResolver';
import { NavItem } from './NavItem';
import { BrandBadge } from '../shared/BrandBadge';
import { useLocale } from '../../context/LocaleContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { OVERLAY_Z } from '../shared/DesignSystem';
import { 
  Library, 
  Sparkles, 
  Activity,
  Layers,
  RefreshCw,
  ShieldCheck,
  Globe,
  ClipboardList
} from 'lucide-react';

interface SidebarProps {
  activeTab: Tab;
  setActiveTab?: (tab: Tab) => void;
  onTabChange?: (tab: Tab) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  activeTab, 
  setActiveTab, 
  onTabChange
}) => {
  const auth = useContext(AuthContext);
  const { activeBrand, userBrands, setActiveBrandId } = useBrand();
  const { activeDepartment, userDepartments, setActiveDepartmentId } = useDepartment();
  const { t } = useLocale();
  const [showBrandSelector, setShowBrandSelector] = useState(false);
  const [showDeptSelector, setShowDeptSelector] = useState(false);
  const [brandSearch, setBrandSearch] = useState('');
  const selectorRef = useRef<HTMLDivElement>(null);
  const deptSelectorRef = useRef<HTMLDivElement>(null);
  const brandTrapRef = useFocusTrap<HTMLDivElement>(showBrandSelector);
  const deptTrapRef = useFocusTrap<HTMLDivElement>(showDeptSelector);

  if (!auth) return null;
  const { currentUser, canViewTab } = auth;

  const handleTabChange = onTabChange || setActiveTab;

  useEffect(() => {
    if (!showBrandSelector) {
      setBrandSearch('');
    }
  }, [showBrandSelector]);

  useEffect(() => {
    if (!showBrandSelector && !showDeptSelector) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowBrandSelector(false);
        setShowDeptSelector(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showBrandSelector, showDeptSelector]);

  // High-Efficiency Minimal Navigation
  const primaryNavigation: { tab: Tab; label: string; description: string; icon: React.ElementType }[] = [
    { tab: 'copilot', label: t('nav.assistant'), description: t('nav_desc.assistant'), icon: Sparkles },
    { tab: 'kb', label: t('nav.knowledgeBase'), description: t('nav_desc.knowledgeBase'), icon: Library },
    { tab: 'review', label: t('nav.queue'), description: t('nav_desc.queue'), icon: ClipboardList },
    { tab: 'sources', label: t('nav.sources'), description: t('nav_desc.sources'), icon: Layers },
    { tab: 'sync', label: t('nav.sync'), description: t('nav_desc.sync'), icon: RefreshCw },
    { tab: 'governance', label: t('nav.governance'), description: t('nav_desc.governance'), icon: ShieldCheck },
    { tab: 'settings', label: t('nav.systemHealth'), description: t('nav_desc.systemHealth'), icon: Activity }
  ];

  // Map activeBrand id to hex colors for subtle border lighting
  const getBrandHexColor = (id: string): string => {
    if (id === 'northwind_es') return '#f97316'; // orange
    if (id === 'northwind_bureau') return '#6366f1';       // indigo
    if (id === 'northwind_de') return '#3b82f6';         // blue
    return '#6366f1';
  };

  const userTooltip = `${currentUser?.name || t('sidebar.defaultUser')} · ${currentUser?.role || t('sidebar.defaultRole')} · ${t('sidebar.switchRolesHint')}`;

  const nameParts = currentUser?.name ? currentUser.name.split(' ') : [];
  const initials = nameParts.length > 1 
    ? (nameParts[0][0] + nameParts[1][0]).toUpperCase()
    : (currentUser?.name ? currentUser.name[0] : 'U').toUpperCase();

  const filteredBrands = userBrands.filter(b => {
    const q = brandSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      (b.displayName && b.displayName.toLowerCase().includes(q)) ||
      (b.shortCode && b.shortCode.toLowerCase().includes(q))
    );
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setShowBrandSelector(false);
      }
      if (deptSelectorRef.current && !deptSelectorRef.current.contains(event.target as Node)) {
        setShowDeptSelector(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <aside className="relative flex h-screen w-14 flex-col justify-between border-r border-slate-800 bg-slate-950 py-3 text-slate-400 flex-shrink-0 z-40 select-none">
      
      {/* Top Section: Brand Mark & Navigation */}
      <div className="flex flex-col items-center gap-6 w-full">
        <div 
          className="flex h-7 w-7 items-center justify-center rounded-sm bg-slate-900 border text-3xs font-bold"
          style={{ borderColor: getBrandHexColor(activeBrand.id) }}
        >
          <span style={{ color: getBrandHexColor(activeBrand.id) }}>
            {activeBrand.shortCode || '??'}
          </span>
        </div>

        {/* Streamlined Operational Navigation */}
        <div className="flex flex-col gap-1.5 w-full items-center">
          {primaryNavigation.map((item) => {
            const isAuth = canViewTab(item.tab);
            return (
              <NavItem
                key={item.tab}
                tab={item.tab}
                label={item.label}
                description={item.description}
                group="WORKSPACE"
                icon={item.icon}
                isActive={activeTab === item.tab}
                onClick={() => handleTabChange && handleTabChange(item.tab)}
                isAuthorized={isAuth}
              />
            );
          })}
        </div>
      </div>

      {/* Bottom Section: Brand Switcher, User */}
      <div className="flex flex-col items-center gap-2 relative" ref={selectorRef}>
        
        {/* Brand switcher quick dropdown popup (if toggled) */}
        {showBrandSelector && (
          <div
            ref={brandTrapRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('sidebar.brandSelector')}
            tabIndex={-1}
            className={`absolute bottom-[44px] left-14 bg-slate-900 border border-slate-800 rounded p-1.5 shadow-xl ${OVERLAY_Z} flex flex-col gap-1 min-w-[170px] max-w-[210px] animate-in fade-in slide-in-from-bottom-2 duration-100 focus:outline-none`}
          >
            <div className="px-2 py-1 border-b border-slate-800/60 mb-1 text-4xs font-mono uppercase tracking-wider text-slate-500 font-bold">
              {t('sidebar.activeBrand')}
            </div>

            <div className="px-1.5 py-0.5">
              <input
                type="text"
                value={brandSearch}
                onChange={(e) => setBrandSearch(e.target.value)}
                placeholder={t('sidebar.searchBrands')}
                aria-label={t('sidebar.searchBrandsAria')}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-3xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors focus-visible:ring-1 focus-visible:ring-brand-500"
              />
            </div>

            <div className="px-2 pb-1 text-4xs text-slate-500 font-mono font-bold">
              {t('sidebar.brandsCount', { filtered: filteredBrands.length, total: userBrands.length })}
            </div>

            <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1 pr-0.5">
              {filteredBrands.length === 0 ? (
                <div className="py-3 text-center text-3xs text-slate-500 font-medium italic">
                  {t('sidebar.noBrandsFound')}
                </div>
              ) : (
                filteredBrands.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setActiveBrandId(b.id);
                      setShowBrandSelector(false);
                    }}
                    className={`flex items-center gap-2 p-1.5 rounded-sm hover:bg-slate-800 text-left transition-colors cursor-pointer w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
                      activeBrand.id === b.id ? 'bg-slate-800/60 border border-slate-700/50' : 'border border-transparent'
                    }`}
                  >
                    <BrandBadge brand={b} size="xs" />
                    <span className="text-3xs font-sans truncate text-zinc-300 font-medium">
                      {b.displayName.split('.')[0] || b.displayName}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Department Switcher */}
        <div className="relative flex flex-col items-center" ref={deptSelectorRef}>
          {showDeptSelector && (
            <div
              ref={deptTrapRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('sidebar.departmentSelector')}
              tabIndex={-1}
              className={`absolute bottom-[44px] left-14 bg-slate-900 border border-slate-800 rounded p-1.5 shadow-xl ${OVERLAY_Z} flex flex-col gap-1 min-w-[170px] max-w-[210px] animate-in fade-in slide-in-from-bottom-2 duration-100 focus:outline-none`}
            >
              <div className="px-2 py-1 border-b border-slate-800/60 mb-1 text-4xs font-mono uppercase tracking-wider text-slate-500 font-bold">
                {t('sidebar.activeDepartment')}
              </div>

              <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1 pr-0.5">
                {userDepartments.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setActiveDepartmentId(d.id);
                      setShowDeptSelector(false);
                    }}
                    className={`flex items-center gap-2 p-1.5 rounded-sm hover:bg-slate-800 text-left transition-colors cursor-pointer w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
                      activeDepartment.id === d.id ? 'bg-slate-800/60 border border-slate-700/50' : 'border border-transparent'
                    }`}
                  >
                    <div className="flex h-4 w-4 items-center justify-center text-slate-400">
                      {resolveIcon(d.icon, "h-3.5 w-3.5")}
                    </div>
                    <span className="text-3xs font-sans truncate text-zinc-300 font-medium">
                      {d.displayName}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setShowDeptSelector(!showDeptSelector)}
            aria-haspopup="dialog"
            aria-expanded={showDeptSelector}
            className={`flex flex-col h-auto w-10 items-center justify-center rounded-sm py-1 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              showDeptSelector ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title={t('sidebar.switchDeptTitle', { name: activeDepartment.displayName })}
          >
            {resolveIcon(activeDepartment.icon, "h-4 w-4 mb-0.5")}
            <span className="text-5xs font-mono font-bold tracking-tighter leading-none max-w-[40px] truncate">
              {activeDepartment.displayName}
            </span>
          </button>
        </div>

        {/* Brand Switcher */}
        <button
          onClick={() => setShowBrandSelector(!showBrandSelector)}
          aria-haspopup="dialog"
          aria-expanded={showBrandSelector}
          className={`flex h-8 w-8 items-center justify-center rounded-sm transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            showBrandSelector ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title={t('sidebar.switchBrandTitle')}
          aria-label={t('sidebar.switchBrandTitle')}
        >
          <Globe className="h-4 w-4" />
        </button>

        {/* User initials */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 border text-3xs font-bold select-none cursor-help hover:border-slate-600 transition-colors" style={{ borderColor: getBrandHexColor(activeBrand.id) + '40', color: getBrandHexColor(activeBrand.id) }} title={userTooltip}>
          <span aria-hidden="true">{initials}</span>
          <span className="sr-only">{userTooltip}</span>
        </div>

      </div>

    </aside>
  );
};
