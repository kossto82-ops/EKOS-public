/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../../../hooks/useToast';
import { Cpu, Eye, EyeOff, Save } from 'lucide-react';
import { AiProviderConfig } from '../../../types';
import { governanceService } from '../../../services/governanceService';
import { AiProviderConfigSchema } from '../../../schemas/validation';
import { useLocale } from '../../../context/LocaleContext';

interface AiProviderSettingsProps {
  isReadOnly?: boolean;
}

export const AiProviderSettings: React.FC<AiProviderSettingsProps> = ({ isReadOnly = false }) => {
  const toast = useToast();
  const { t } = useLocale();
  const [showKey, setShowKey] = useState(false);

  const [provider, setProvider] = useState<'gemini' | 'anthropic' | 'openai' | 'groq' | 'custom'>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [temperature, setTemperature] = useState(0.2);
  const [maxHistory, setMaxHistory] = useState(10);
  const [systemPromptOverride, setSystemPromptOverride] = useState('');
  const [customEndpointUrl, setCustomEndpointUrl] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Load configuration from service layer on mount
  useEffect(() => {
    governanceService.getAiConfig()
      .then(config => {
        if (!isMountedRef.current) return;
        setProvider(config.provider || 'gemini');
        setApiKey(config.apiKey || '');
        setModel(config.model || 'gemini-2.5-flash');
        setTemperature(config.temperature ?? 0.2);
        setMaxHistory(config.maxHistory ?? 10);
        setSystemPromptOverride(config.systemPromptOverride || '');
        setCustomEndpointUrl(config.customEndpointUrl || '');
      })
      .catch(e => {
        console.error('Failed to load AI Provider config:', e);
      });
  }, []);

  const handleSaveSettings = () => {
    const configToSave: AiProviderConfig = {
      provider,
      apiKey: apiKey.includes('••••') ? undefined : apiKey,
      model,
      temperature,
      maxHistory,
      systemPromptOverride,
      // Preserve the stored custom endpoint across saves. Omitting it here made
      // every save from this panel wipe a previously-configured URL.
      customEndpointUrl: customEndpointUrl || undefined,
    };

    // Validate using Zod schema
    const validationResult = AiProviderConfigSchema.safeParse(configToSave);

    if (!validationResult.success) {
      const fieldErrors: Record<string, string> = {};
      validationResult.error.issues.forEach((err) => {
        const fieldName = err.path[0]?.toString();
        if (fieldName) {
          fieldErrors[fieldName] = err.message;
        }
      });
      setErrors(fieldErrors);
      toast.error(t('settings.aiProvider.validationFailed') + ' ' + Object.values(fieldErrors).join(' '));
      return;
    }

    // Clear visual errors if validation passes
    setErrors({});

    governanceService.updateAiConfig(configToSave)
      .then(() => {
        toast.success(t('settings.aiProvider.saveSuccess'));
      })
      .catch(err => {
        toast.error(err instanceof Error ? err.message : t('settings.aiProvider.saveError'));
      });
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 transition-colors duration-150">
      <div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-sans flex items-center gap-1.5">
          <Cpu className="h-4.5 w-4.5 text-brand-600 dark:text-brand-400" />
          {t('settings.aiProvider.heading')}
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {t('settings.aiProvider.description')}
        </p>
      </div>

      <div className="space-y-4 max-w-xl text-xs font-semibold">
        {/* Core Provider Selection */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="ai_model_provider" className="text-slate-700 dark:text-slate-300">{t('settings.aiProvider.providerLabel')}</label>
            <select
              id="ai_model_provider"
              value={provider}
              onChange={(e) => {
                const val = e.target.value as any;
                setProvider(val);
                if (val === 'gemini') setModel('gemini-2.5-flash');
                else if (val === 'anthropic') setModel('claude-3-5-sonnet-20241022');
                else if (val === 'openai') setModel('gpt-4o');
                else if (val === 'groq') setModel('llama-3.3-70b-versatile');
                else if (val === 'custom') setModel('llama3:70b');
              }}
              aria-invalid={!!errors.provider}
              aria-describedby={errors.provider ? 'ai_provider_err' : undefined}
              className={`w-full rounded-md border px-3 py-1.5 font-bold focus:border-brand-500 dark:bg-slate-900 dark:text-white cursor-pointer ${
                errors.provider 
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
                  : 'border-slate-200 bg-white dark:border-slate-800'
              }`}
            >
              <option value="gemini">{t('settings.aiProvider.providerOptions.gemini')}</option>
              <option value="groq">{t('settings.aiProvider.providerOptions.groq')}</option>
              <option value="anthropic">{t('settings.aiProvider.providerOptions.anthropic')}</option>
              <option value="openai">{t('settings.aiProvider.providerOptions.openai')}</option>
              <option value="custom">{t('settings.aiProvider.providerOptions.custom')}</option>
            </select>
            {errors.provider && (
              <p id="ai_provider_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.provider}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ai_model_name" className="text-slate-700 dark:text-slate-300">{t('settings.aiProvider.modelLabel')}</label>
            <input
              id="ai_model_name"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t('settings.aiProvider.modelPlaceholder')}
              aria-invalid={!!errors.model}
              aria-describedby={errors.model ? 'ai_model_name_err' : undefined}
              className={`w-full rounded-md border px-3 py-1.5 font-bold focus:border-brand-500 dark:bg-slate-900 dark:text-white ${
                errors.model 
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
                  : 'border-slate-200 bg-white dark:border-slate-800'
              }`}
            />
            {errors.model && (
              <p id="ai_model_name_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.model}</p>
            )}
          </div>
        </div>

        {/* Custom endpoint (only relevant for the 'custom' provider) */}
        {provider === 'custom' && (
          <div className="space-y-1.5">
            <label htmlFor="custom_endpoint_url" className="text-slate-700 dark:text-slate-300">{t('settings.aiProvider.customEndpointLabel')}</label>
            <input
              id="custom_endpoint_url"
              type="url"
              value={customEndpointUrl}
              onChange={(e) => setCustomEndpointUrl(e.target.value)}
              placeholder={t('settings.aiProvider.customEndpointPlaceholder')}
              aria-invalid={!!errors.customEndpointUrl}
              aria-describedby={errors.customEndpointUrl ? 'custom_endpoint_url_err' : undefined}
              className={`w-full rounded-md border px-3 py-1.5 focus:border-brand-500 dark:bg-slate-900 dark:text-white font-mono ${
                errors.customEndpointUrl
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20'
                  : 'border-slate-200 bg-white dark:border-slate-800'
              }`}
            />
            {errors.customEndpointUrl && (
              <p id="custom_endpoint_url_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.customEndpointUrl}</p>
            )}
          </div>
        )}

        {/* Secure Key Setup */}
        <div className="space-y-1.5">
          <label htmlFor="provider_api_key" className="text-slate-700 dark:text-slate-300">{t('settings.aiProvider.apiKeyLabel')}</label>
          <div className="relative">
            <input
              id="provider_api_key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('settings.aiProvider.apiKeyPlaceholder')}
              aria-invalid={!!errors.apiKey}
              aria-describedby={errors.apiKey ? 'provider_api_key_err' : undefined}
              className={`w-full rounded-md border pl-3 pr-10 py-1.5 focus:border-brand-500 dark:bg-slate-900 dark:text-white font-mono ${
                errors.apiKey 
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
                  : 'border-slate-200 bg-white dark:border-slate-800'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              aria-label={showKey ? t('settings.aiProvider.hideKey') : t('settings.aiProvider.showKey')}
              aria-pressed={showKey}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.apiKey && (
            <p id="provider_api_key_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.apiKey}</p>
          )}
          {apiKey === '••••••••env' && (
            <p className="text-3xs text-success-600 dark:text-success-400 font-bold mt-1 leading-none">
              {t('settings.aiProvider.systemKeyActive')}
            </p>
          )}
          <span className="block text-3xs text-brand-600 dark:text-brand-400 font-medium mt-1">
            {t('settings.aiProvider.apiKeyNote')}
          </span>
        </div>

        {/* Temperature & History settings */}
        <div className="grid grid-cols-2 gap-4">
          {/* Temperature Slider */}
          <div className={`p-3.5 rounded-xl space-y-1.5 border transition-colors ${
            errors.temperature 
              ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
              : 'border-transparent bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800'
          }`}>
            <div className="flex justify-between items-center">
              <label htmlFor="model_temperature" className="text-slate-800 dark:text-slate-400 font-semibold">{t('settings.aiProvider.temperatureLabel')}</label>
              <span className="font-mono font-bold text-brand-700 dark:text-brand-400">
                {temperature.toFixed(1)}
              </span>
            </div>
            <input
              id="model_temperature"
              type="range"
              min="0"
              max="1.0"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value) || 0.0)}
              aria-invalid={!!errors.temperature}
              aria-describedby={errors.temperature ? 'model_temperature_err' : undefined}
              className="w-full accent-brand-600 cursor-pointer"
            />
            {errors.temperature && (
              <p id="model_temperature_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.temperature}</p>
            )}
            <span className="block text-4xs text-slate-400 font-normal">
              {t('settings.aiProvider.temperatureHelper')}
            </span>
          </div>

          {/* Max History Length */}
          <div className={`p-3.5 rounded-xl space-y-1.5 border transition-colors ${
            errors.maxHistory 
              ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
              : 'border-transparent bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800'
          }`}>
            <div className="flex justify-between items-center">
              <label htmlFor="max_history_frames" className="text-slate-800 dark:text-slate-400 font-semibold">{t('settings.aiProvider.maxHistoryLabel')}</label>
              <span className="font-mono font-bold text-brand-700 dark:text-brand-400">
                {t('settings.aiProvider.turns', { n: maxHistory })}
              </span>
            </div>
            <input
              id="max_history_frames"
              type="number"
              min="1"
              max="100"
              step="1"
              value={maxHistory}
              onChange={(e) => setMaxHistory(parseInt(e.target.value) || 10)}
              aria-invalid={!!errors.maxHistory}
              aria-describedby={errors.maxHistory ? 'max_history_frames_err' : undefined}
              className={`w-full rounded border px-2 py-0.5 focus:outline-hidden dark:bg-slate-950 dark:text-white ${
                errors.maxHistory 
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
                  : 'border-slate-200 bg-white dark:border-slate-800'
              }`}
            />
            {errors.maxHistory && (
              <p id="max_history_frames_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.maxHistory}</p>
            )}
            <span className="block text-4xs text-slate-400 font-normal">
              {t('settings.aiProvider.maxHistoryHelper')}
            </span>
          </div>
        </div>

        {/* Global instructions override */}
        <div className="space-y-1.5">
          <label htmlFor="system_prompt_override" className="text-slate-700 dark:text-slate-300">{t('settings.aiProvider.systemPromptLabel')}</label>
          <textarea
            id="system_prompt_override"
            value={systemPromptOverride}
            onChange={(e) => setSystemPromptOverride(e.target.value)}
            rows={3}
            aria-invalid={!!errors.systemPromptOverride}
            aria-describedby={errors.systemPromptOverride ? 'system_prompt_override_err' : undefined}
            placeholder={t('settings.aiProvider.systemPromptPlaceholder')}
            className={`w-full rounded-md border px-3 py-1.5 focus:border-brand-500 dark:bg-slate-900 dark:text-white font-medium ${
              errors.systemPromptOverride 
                ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
                : 'border-slate-200 bg-white dark:border-slate-800'
            }`}
          />
          {errors.systemPromptOverride && (
            <p id="system_prompt_override_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.systemPromptOverride}</p>
          )}
          <span className="block text-3xs text-slate-400 font-normal">
            {t('settings.aiProvider.systemPromptHelper')}
          </span>
        </div>

        {/* Trigger button */}
        <button
          type="button"
          onClick={handleSaveSettings}
          disabled={isReadOnly}
          className={`inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-950 dark:bg-brand-600 dark:hover:bg-brand-700 text-white px-4 py-2 text-xs font-bold shadow-xs cursor-pointer ${isReadOnly ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <Save className="h-4 w-4" />
          {t('settings.aiProvider.updateButton')}
        </button>
      </div>
    </div>
  );
};

export default AiProviderSettings;
