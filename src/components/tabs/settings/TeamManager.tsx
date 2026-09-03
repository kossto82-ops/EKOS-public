/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../../../hooks/useToast';
import { ShieldCheck, Save } from 'lucide-react';
import { governanceService } from '../../../services/governanceService';
import { DeskSettingsSchema } from '../../../schemas/validation';
import { useLocale } from '../../../context/LocaleContext';

interface TeamManagerProps {
  isReadOnly?: boolean;
}

export const TeamManager: React.FC<TeamManagerProps> = ({ isReadOnly = false }) => {
  const toast = useToast();
  const { t } = useLocale();

  const [maxAnswerSec, setMaxAnswerSec] = useState(3.5);
  const [escalationStarLimit, setEscalationStarLimit] = useState(2);
  const [enableSlack, setEnableSlack] = useState(true);
  const [enableGdpr, setEnableGdpr] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Load team settings from governanceService on mount
  useEffect(() => {
    governanceService.getDeskSettings().then(settings => {
      if (!isMountedRef.current) return;
      setMaxAnswerSec(settings.maxAnswerSec);
      setEscalationStarLimit(settings.escalationStarLimit);
      setEnableSlack(settings.enableSlack);
      setEnableGdpr(settings.enableGdpr);
    }).catch(e => {
      console.error('Failed to load desk settings:', e);
    });
  }, []);

  const handleSaveTeamSettings = (e: React.FormEvent) => {
    e.preventDefault();
    
    const settings = {
      maxAnswerSec,
      escalationStarLimit,
      enableSlack,
      enableGdpr
    };

    const validationResult = DeskSettingsSchema.safeParse(settings);

    if (!validationResult.success) {
      const fieldErrors: Record<string, string> = {};
      validationResult.error.issues.forEach((err) => {
        const fieldName = err.path[0]?.toString();
        if (fieldName) {
          fieldErrors[fieldName] = err.message;
        }
      });
      setErrors(fieldErrors);
      toast.error(t('settings.teamManager.validationFailed') + ' ' + Object.values(fieldErrors).join(' '));
      return;
    }

    setErrors({});

    governanceService.updateDeskSettings(settings)
      .then(() => {
        toast.success(t('settings.teamManager.saveSuccess'));
      })
      .catch(err => {
        toast.error(t('settings.teamManager.saveError'));
      });
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 transition-colors duration-150">
      <div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-sans flex items-center gap-1.5">
          <ShieldCheck className="h-4.5 w-4.5 text-brand-600 dark:text-brand-400" />
          {t('settings.teamManager.heading')}
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {t('settings.teamManager.description')}
        </p>
      </div>

      <form onSubmit={handleSaveTeamSettings} className="space-y-4 font-medium max-w-xl">
        
        {/* Metric sliders */}
        <div className="space-y-3">
          <div className={`p-4 rounded-xl transition-colors border ${
            errors.maxAnswerSec 
              ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
              : 'border-transparent bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800'
          }`}>
            <div className="flex justify-between items-center text-xs">
              <label htmlFor="max_answer_time_target" className="font-semibold text-slate-800 dark:text-slate-400">{t('settings.teamManager.maxAnswerLabel')}</label>
              <span className="font-mono font-bold text-brand-700 dark:text-brand-400">
                {t('settings.teamManager.seconds', { n: maxAnswerSec.toFixed(1) })}
              </span>
            </div>
            <input
              id="max_answer_time_target"
              type="range"
              min="1.5"
              max="10"
              step="0.5"
              value={maxAnswerSec}
              onChange={(e) => setMaxAnswerSec(parseFloat(e.target.value) || 3.5)}
              className="w-full accent-brand-600 cursor-pointer"
            />
            {errors.maxAnswerSec && (
              <p className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.maxAnswerSec}</p>
            )}
            <span className="block text-3xs text-slate-400">{t('settings.teamManager.maxAnswerHelper')}</span>
          </div>

          <div className={`p-4 rounded-xl transition-colors border ${
            errors.escalationStarLimit 
              ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
              : 'border-transparent bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800'
          }`}>
            <div className="flex justify-between items-center text-xs">
              <label htmlFor="auto_escalation_star_threshold" className="font-semibold text-slate-800 dark:text-slate-400">{t('settings.teamManager.escalationLabel')}</label>
              <span className="font-mono font-bold text-brand-700 dark:text-brand-400">
                {t('settings.teamManager.starsOrLower', { n: escalationStarLimit })}
              </span>
            </div>
            <input
              id="auto_escalation_star_threshold"
              type="range"
              min="1"
              max="4"
              step="1"
              value={escalationStarLimit}
              onChange={(e) => setEscalationStarLimit(parseInt(e.target.value) || 2)}
              className="w-full accent-brand-600 cursor-pointer"
            />
            {errors.escalationStarLimit && (
              <p className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.escalationStarLimit}</p>
            )}
            <span className="block text-3xs text-slate-400">{t('settings.teamManager.escalationHelper')}</span>
          </div>
        </div>

        {/* Integration toggles */}
        <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-900">
          <span className="block text-3xs font-bold text-slate-400 uppercase tracking-widest font-mono mb-2">
            {t('settings.teamManager.integrationsHeader')}
          </span>

          <div className="space-y-2.5">
            <label className="flex items-center gap-3.5 cursor-pointer text-xs select-none">
              <input
                type="checkbox"
                checked={enableSlack}
                onChange={(e) => setEnableSlack(e.target.checked)}
                className="rounded text-brand-600 focus:ring-brand-500 h-4 w-4 accent-brand-700 cursor-pointer"
              />
              <div className="min-w-0">
                <span className="font-bold text-slate-800 dark:text-slate-200 block">{t('settings.teamManager.slackTitle')}</span>
                <span className="text-3xs text-slate-400 block font-normal">{t('settings.teamManager.slackDesc')}</span>
              </div>
            </label>

            <label className="flex items-center gap-3.5 cursor-pointer text-xs select-none">
              <input
                type="checkbox"
                checked={enableGdpr}
                onChange={(e) => setEnableGdpr(e.target.checked)}
                className="rounded text-brand-600 focus:ring-brand-500 h-4 w-4 accent-brand-700 cursor-pointer"
              />
              <div className="min-w-0">
                <span className="font-bold text-slate-800 dark:text-slate-200 block">{t('settings.teamManager.gdprTitle')}</span>
                <span className="text-3xs text-slate-400 block font-normal">{t('settings.teamManager.gdprDesc')}</span>
              </div>
            </label>
          </div>
        </div>

        <button
          type="submit"
          disabled={isReadOnly}
          className={`inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-950 dark:bg-brand-600 dark:hover:bg-brand-700 text-white px-4 py-2 text-xs font-bold shadow-xs cursor-pointer ${isReadOnly ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <Save className="h-4 w-4" />
          {t('settings.teamManager.updateButton')}
        </button>
      </form>

    </div>
  );
};
export default TeamManager;
