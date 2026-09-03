import React, { useState, useEffect, useContext, useRef } from 'react';
import { AuthContext } from './context/AuthContext';
import { useBrand } from './hooks/useBrand';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ToastContainer } from './components/shared/Toast';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { useDarkMode } from './hooks/useDarkMode';
import { useIdleTimer } from './hooks/useIdleTimer';
import { IdleLockScreen } from './components/shared/IdleLockScreen';
import { useLocale } from './context/LocaleContext';
import ekosSymbol from './assets/brand/ekos-symbol.svg';

// Lazy Tabs import
const KnowledgeBaseTab   = React.lazy(() => import('./components/tabs/kb/KnowledgeBaseTab').then(m => ({ default: m.KnowledgeBaseTab })));
const AssistantTab       = React.lazy(() => import('./components/tabs/copilot/AssistantTab').then(m => ({ default: m.AssistantTab })));
const KnowledgeSourcesView = React.lazy(() => import('./components/sources/KnowledgeSourcesView').then(m => ({ default: m.KnowledgeSourcesView })));
const SettingsTab        = React.lazy(() => import('./components/tabs/settings/SettingsTab').then(m => ({ default: m.SettingsTab })));
const SyncIndexingTab    = React.lazy(() => import('./components/tabs/sync/SyncIndexingTab').then(m => ({ default: m.SyncIndexingTab })));
const SystemGovernanceTab = React.lazy(() => import('./components/tabs/governance/SystemGovernanceTab').then(m => ({ default: m.SystemGovernanceTab })));
const ReviewQueueTab      = React.lazy(() => import('./components/tabs/review/ReviewQueueTab').then(m => ({ default: m.ReviewQueueTab })));

import { Lock } from 'lucide-react';
import { Tab } from './types';

export default function App() {
  const auth = useContext(AuthContext);
  const { activeBrand } = useBrand();
  const { isDark, toggleDarkMode } = useDarkMode();
  const { isLocked, unlock } = useIdleTimer();
  const { t } = useLocale();
  
  // Active Tab state
  const getTabFromHash = (): Tab => {
    const hash = window.location.hash.replace('#/', '') as Tab;
    const validTabs: Tab[] = ['copilot', 'kb', 'sources', 'sync', 'governance', 'settings', 'review'];
    return validTabs.includes(hash) ? hash : 'copilot';
  };

  const [activeTab, setActiveTab] = useState<Tab>(getTabFromHash());

  // Responsive desktop requirements warning
  const [showResponsiveBanner, setShowResponsiveBanner] = useState(false);

  useEffect(() => {
    const isDismissed = sessionStorage.getItem('responsive_banner_dismissed') === 'true';
    if (!isDismissed) {
      const handleResize = () => {
        // Respect an explicit dismissal: without this the banner the user
        // dismissed pops back on the next resize (the listener stays attached).
        if (sessionStorage.getItem('responsive_banner_dismissed') === 'true') return;
        setShowResponsiveBanner(window.innerWidth < 1024);
      };
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  const handleDismissResponsiveBanner = () => {
    sessionStorage.setItem('responsive_banner_dismissed', 'true');
    setShowResponsiveBanner(false);
  };

  // Listen for programmatic tab switching events
  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const customEvent = e as CustomEvent<Tab>;
      if (customEvent.detail) {
        handleTabChangeWithHash(customEvent.detail);
      }
    };
    window.addEventListener('navigate_tab', handleNavigate as EventListener);
    return () => window.removeEventListener('navigate_tab', handleNavigate as EventListener);
  }, []);

  // If the active tab becomes disallowed after a role/impersonation switch,
  // redirect to a safe default instead of stranding the user on the
  // access-restricted screen (mirrors the brand/department auto-correct).
  // Declared before the early return, and keyed on the user id, so hook order
  // stays stable and it re-runs when the impersonated user changes.
  useEffect(() => {
    if (auth && !auth.canViewTab(activeTab)) {
      setActiveTab('copilot');
      window.location.hash = '/copilot';
    }
  }, [activeTab, auth?.currentUser?.id]);

  // Move focus to the main content region on tab change (skipping the initial
  // mount) and announce the new section, so keyboard/SR users aren't left on
  // the sidebar with a silently-swapped view.
  const mainRef = useRef<HTMLElement>(null);
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    mainRef.current?.focus();
  }, [activeTab]);

  if (!auth) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <img src={ekosSymbol} alt="" aria-hidden="true" className="h-8 w-8" />
          <div className="h-5 w-5 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
          <p className="text-xs font-semibold text-slate-400 tracking-wide uppercase">EKOS</p>
        </div>
      </div>
    );
  }

  const { currentUser, canViewTab } = auth;
  const isAuthorized = canViewTab(activeTab);

  const getActiveTabTitle = () => {
    switch (activeTab) {
      case 'kb': return t('nav.knowledgeBase');
      case 'review': return t('nav.queue');
      case 'copilot': return t('nav.assistant');
      case 'sources': return t('nav.sources');
      case 'sync': return t('nav.sync');
      case 'governance': return t('nav.governance');
      case 'settings': return t('nav.systemHealth');
      default: return t('nav.workspace');
    }
  };

  const handleTabChangeWithHash = (tab: Tab) => {
    setActiveTab(tab);
    window.location.hash = `/${tab}`;
  };

  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <ErrorBoundary>
    <div
      inert={isLocked || undefined}
      className="h-screen bg-slate-50 dark:bg-slate-950 font-sans flex text-slate-900 dark:text-[#fafafa] tracking-tight selection:bg-success-500/30 transition-colors duration-150 overflow-hidden"
    >

      {/* Toast notifications emitter */}
      <ToastContainer />

      {/* Main Left Unified Sidebar Navigation */}
      <Sidebar activeTab={activeTab} setActiveTab={handleTabChangeWithHash} />

      {/* Main Body Shell */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950 h-screen overflow-y-auto">

        {/* Small-screen advisory: informational only, never blocks navigation or interaction */}
        {showResponsiveBanner && (
          <div
            role="status"
            aria-live="polite"
            className="flex-shrink-0 flex items-start gap-3 px-4 py-2.5 bg-warning-50 dark:bg-warning-950/20 border-b border-warning-200 dark:border-warning-900/40 animate-in fade-in slide-in-from-top-2 duration-200"
          >
            <span className="text-sm leading-none mt-0.5" aria-hidden="true">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-warning-800 dark:text-warning-300">
                {t('responsiveBanner.title')}
              </p>
              <p className="text-2xs text-warning-700/80 dark:text-warning-400/80 leading-relaxed">
                {t('responsiveBanner.body')}
              </p>
            </div>
            <button
              onClick={handleDismissResponsiveBanner}
              className="flex-shrink-0 text-2xs font-semibold text-warning-800 dark:text-warning-300 hover:text-warning-900 dark:hover:text-warning-200 underline underline-offset-2 cursor-pointer"
              aria-label={t('responsiveBanner.dismissAria')}
            >
              {t('responsiveBanner.dismiss')}
            </button>
          </div>
        )}

        {/* Dynamic header row containing Selected Brand Selector and active Role Impersonator bar */}
        <Header
          title={getActiveTabTitle()}
          darkMode={isDark}
          onToggleDark={toggleDarkMode}
        />

        {/* Outer content container */}
        <main
          ref={mainRef}
          tabIndex={-1}
          aria-label={getActiveTabTitle()}
          className="flex-1 p-3 sm:p-4 md:p-6 pb-20 max-w-7xl w-full mx-auto bg-slate-50 dark:bg-slate-950/40 overflow-x-hidden focus:outline-none"
        >
          {/* Announce the active section to assistive tech on tab change */}
          <p className="sr-only" role="status" aria-live="polite">{getActiveTabTitle()}</p>

          <ErrorBoundary resetKeys={[activeTab]}>
            {isAuthorized ? (
              <div className="space-y-4">
                {/* Brand Indicator Header */}
                <span className="inline-flex items-center gap-1.5 text-3xs font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500 select-none uppercase">
                  {t('common.brand')} <span className="font-sans font-bold text-slate-600 dark:text-zinc-300">{activeBrand.displayName}</span>
                </span>

                {/* Render corresponding Tab */}
                <React.Suspense fallback={
                  <div className="flex items-center justify-center py-24">
                    <div className="h-4 w-4 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
                  </div>
                }>
                  {activeTab === 'kb' && <KnowledgeBaseTab />}
                  {activeTab === 'review' && <ReviewQueueTab />}
                  {activeTab === 'copilot' && <AssistantTab />}
                  {activeTab === 'sources' && <KnowledgeSourcesView />}
                  {activeTab === 'settings' && <SettingsTab />}
                  {activeTab === 'sync' && <SyncIndexingTab />}
                  {activeTab === 'governance' && <SystemGovernanceTab />}
                </React.Suspense>
              </div>
            ) : (
              <div className="h-[73vh] flex flex-col items-center justify-center border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-12 text-center select-none">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mb-4">
                  <Lock className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('access.restricted')}
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mt-1.5 leading-relaxed">
                  {t('access.noPermission')} <span className="font-mono font-semibold text-slate-600 dark:text-slate-400">({currentUser.role})</span>
                </p>
              </div>
            )}
          </ErrorBoundary>

        </main>
      </div>

    </div>
    {/* Rendered outside the inert app tree so it stays interactive while the
        rest of the app is disabled for assistive tech during an idle lock. */}
    {isLocked && <IdleLockScreen onUnlock={unlock} />}
    </ErrorBoundary>
  );
}
