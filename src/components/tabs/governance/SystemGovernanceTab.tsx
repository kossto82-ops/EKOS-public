/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useLayoutEffect, useContext } from 'react';
import { ShieldCheck, Cpu, Globe, Scale, Home, Gauge } from 'lucide-react';
import { AiProviderSettings } from '../settings/AiProviderSettings';
import { BrandManager } from '../settings/BrandManager';
import { TeamManager } from '../settings/TeamManager';
import { PolicyManager } from './PolicyManager';
import { useBreadcrumbs } from '../../../context/BreadcrumbContext';
import { AuthContext } from '../../../context/AuthContext';

type GovernanceSubTab = 'ai' | 'brands' | 'desk' | 'policies';

export const SystemGovernanceTab: React.FC = () => {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeSubTab, setActiveSubTab] = useState<GovernanceSubTab>('ai');

  const authContext = useContext(AuthContext);
  const currentUser = authContext?.currentUser;
  const isReadOnly = currentUser?.role === 'LocationManager';

  useLayoutEffect(() => {
    setBreadcrumbs([
      { 
        label: 'Home', 
        icon: Home,
        onClick: () => window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }))
      },
      { label: 'System Governance', icon: ShieldCheck }
    ]);
  }, [setBreadcrumbs]);

  return (
    <div id="system_governance_tab" className="space-y-8 font-sans text-left">
      {isReadOnly && (
        <div className="flex items-center gap-2 px-4 py-2.5 mb-4 bg-warning-50 dark:bg-warning-950/30 border border-warning-200 dark:border-warning-800 rounded-lg text-xs text-warning-700 dark:text-warning-400">
          <span>👁</span>
          <span>You have read-only access to Governance. Contact an Administrator to make changes.</span>
        </div>
      )}
      
      {/* Header section */}
      <section id="gov_header" className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-900 pb-5">
        <div>
          <h1 
            id="gov_title"
            className="text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2"
          >
            <ShieldCheck className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Governance
          </h1>
          <p 
            id="gov_subtitle"
            className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-2xl leading-relaxed font-sans font-medium"
          >
            Manage AI provider configuration, brand segments, and enforcement policies across the platform.
          </p>
        </div>
      </section>

      {/* Sub-navigation selector tabs */}
      <div 
        role="tablist"
        aria-label="Governance Settings Sub-tabs"
        className="flex border-b border-slate-200 dark:border-slate-800"
      >
        <button
          id="gov_subtab_ai"
          role="tab"
          aria-selected={activeSubTab === 'ai'}
          aria-controls="gov_panel_ai"
          onClick={() => setActiveSubTab('ai')}
          className={`px-4 py-2 border-b-2 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
            activeSubTab === 'ai'
              ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Cpu className="h-4 w-4" />
          AI Config
        </button>
        <button
          id="gov_subtab_brands"
          role="tab"
          aria-selected={activeSubTab === 'brands'}
          aria-controls="gov_panel_brands"
          onClick={() => setActiveSubTab('brands')}
          className={`px-4 py-2 border-b-2 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
            activeSubTab === 'brands'
              ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Globe className="h-4 w-4" />
          Brands
        </button>
        <button
          id="gov_subtab_policies"
          role="tab"
          aria-selected={activeSubTab === 'policies'}
          aria-controls="gov_panel_policies"
          onClick={() => setActiveSubTab('policies')}
          className={`px-4 py-2 border-b-2 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
            activeSubTab === 'policies'
              ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Scale className="h-4 w-4" />
          Policies
        </button>
        <button
          id="gov_subtab_desk"
          role="tab"
          aria-selected={activeSubTab === 'desk'}
          aria-controls="gov_panel_desk"
          onClick={() => setActiveSubTab('desk')}
          className={`px-4 py-2 border-b-2 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
            activeSubTab === 'desk'
              ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Gauge className="h-4 w-4" />
          Desk Ops
        </button>
      </div>

      {/* Renders active sub-view */}
      <div className="mt-4 transition-all duration-200">
        {activeSubTab === 'ai' && (
          <div id="gov_panel_ai" role="tabpanel" aria-labelledby="gov_subtab_ai">
            <AiProviderSettings isReadOnly={isReadOnly} />
          </div>
        )}
        {activeSubTab === 'brands' && (
          <div id="gov_panel_brands" role="tabpanel" aria-labelledby="gov_subtab_brands">
            <BrandManager isReadOnly={isReadOnly} />
          </div>
        )}
        {activeSubTab === 'desk' && (
          <div id="gov_panel_desk" role="tabpanel" aria-labelledby="gov_subtab_desk">
            <TeamManager isReadOnly={isReadOnly} />
          </div>
        )}
        {activeSubTab === 'policies' && (
          <div id="gov_panel_policies" role="tabpanel" aria-labelledby="gov_subtab_policies">
            <PolicyManager isReadOnly={isReadOnly} />
          </div>
        )}
      </div>

    </div>
  );
};
