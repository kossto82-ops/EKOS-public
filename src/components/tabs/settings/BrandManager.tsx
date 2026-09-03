/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useBrand } from '../../../hooks/useBrand';
import { useToast } from '../../../hooks/useToast';
import { Settings, HelpCircle, Save } from 'lucide-react';
import { BrandSchema } from '../../../schemas/validation';
import { useLocale } from '../../../context/LocaleContext';

interface BrandManagerProps {
  isReadOnly?: boolean;
}

export const BrandManager: React.FC<BrandManagerProps> = ({ isReadOnly = false }) => {
  const { activeBrand, updateBrand } = useBrand();
  const toast = useToast();
  const { t } = useLocale();

  // Load editable brand overrides
  const [displayName, setDisplayName] = useState(activeBrand.displayName);
  const [vatLabel, setVatLabel] = useState(activeBrand.vatLabel);
  const [vatRate, setVatRate] = useState(activeBrand.vatRate * 100);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Sync state when active brand changes in header
  useEffect(() => {
    setDisplayName(activeBrand.displayName);
    setVatLabel(activeBrand.vatLabel);
    setVatRate(activeBrand.vatRate * 100);
    setErrors({});
  }, [activeBrand]);

  const handleSaveOverrides = async (e: React.FormEvent) => {
    e.preventDefault();

    const dataToValidate = {
      displayName,
      shortCode: activeBrand.shortCode || 'XX',
      vatRate: vatRate / 100,
      vatLabel,
      currency: activeBrand.currency || 'EUR',
    };

    const validationResult = BrandSchema.safeParse(dataToValidate);

    if (!validationResult.success) {
      const fieldErrors: Record<string, string> = {};
      validationResult.error.issues.forEach((err) => {
        const fieldName = err.path[0]?.toString();
        if (fieldName) {
          fieldErrors[fieldName] = err.message;
        }
      });
      setErrors(fieldErrors);
      toast.error(t('settings.brandManager.validationFailed') + ' ' + Object.values(fieldErrors).join(' '));
      return;
    }

    setErrors({});

    // Persist to the brand record on the server (source of truth), then let
    // BrandContext reconcile from the returned row. No optimistic/localStorage
    // write: the toast reflects the real result of the PATCH.
    setSaving(true);
    try {
      await updateBrand(activeBrand.id, {
        displayName,
        vatLabel,
        vatRate: vatRate / 100,
      });
      toast.success(t('settings.brandManager.saveSuccess', { name: displayName }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.brandManager.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 transition-colors duration-150">
      <div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-sans flex items-center gap-1.5">
          <Settings className="h-4.5 w-4.5 text-brand-600 dark:text-brand-400" />
          {t('settings.brandManager.heading')}
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {t('settings.brandManager.description')}{' '}
          <span className="font-semibold text-slate-700 dark:text-slate-300">{activeBrand.displayName}</span>.
        </p>
      </div>

      <form onSubmit={handleSaveOverrides} className="space-y-4 font-medium max-w-xl">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label htmlFor="brand_display_name" className="block text-3xs font-bold text-slate-500 uppercase tracking-widest mb-1">
              {t('settings.brandManager.aliasLabel')}
            </label>
            <input
              id="brand_display_name"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              aria-invalid={!!errors.displayName}
              aria-describedby={errors.displayName ? 'brand_display_name_err' : undefined}
              className={`w-full rounded-md border bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-brand-500 focus:outline-hidden dark:bg-slate-900 dark:text-white ${
                errors.displayName
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            />
            {errors.displayName && (
              <p id="brand_display_name_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.displayName}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="brand_vat_label" className="block text-3xs font-bold text-slate-500 uppercase tracking-widest mb-1">
              {t('settings.brandManager.taxLabelLabel')}
            </label>
            <input
              id="brand_vat_label"
              type="text"
              required
              value={vatLabel}
              onChange={(e) => setVatLabel(e.target.value)}
              aria-invalid={!!errors.vatLabel}
              aria-describedby={errors.vatLabel ? 'brand_vat_label_err' : undefined}
              className={`w-full rounded-md border bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-brand-500 focus:outline-hidden dark:bg-slate-900 dark:text-white ${
                errors.vatLabel
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            />
            {errors.vatLabel && (
              <p id="brand_vat_label_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.vatLabel}</p>
            )}
          </div>

          <div>
            <label htmlFor="brand_vat_rate" className="block text-3xs font-bold text-slate-500 uppercase tracking-widest mb-1">
              {t('settings.brandManager.taxRateLabel')}
            </label>
            <input
              id="brand_vat_rate"
              type="number"
              min="0"
              max="50"
              step="0.1"
              required
              value={vatRate}
              onChange={(e) => setVatRate(parseFloat(e.target.value) || 0)}
              aria-invalid={!!errors.vatRate}
              aria-describedby={errors.vatRate ? 'brand_vat_rate_err' : undefined}
              className={`w-full rounded-md border bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-brand-500 focus:outline-hidden dark:bg-slate-900 dark:text-white ${
                errors.vatRate
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20' 
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            />
            {errors.vatRate && (
              <p id="brand_vat_rate_err" className="text-red-600 dark:text-red-400 text-3xs mt-1 font-bold leading-none">{errors.vatRate}</p>
            )}
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-brand-50/50 border border-brand-200 p-3 rounded-lg dark:bg-brand-950/10 dark:border-brand-900/40 flex items-start gap-2.5">
          <HelpCircle className="h-4.5 w-4.5 text-brand-600 dark:text-brand-400 flex-shrink-0 mt-0.5" />
          <p className="text-3xs text-brand-600 dark:text-brand-300 leading-relaxed">
            {t('settings.brandManager.infoBox')}
          </p>
        </div>

        <button
          type="submit"
          disabled={isReadOnly || saving}
          className={`inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-950 dark:bg-brand-600 dark:hover:bg-brand-700 text-white px-4 py-2 text-xs font-bold shadow-xs cursor-pointer ${isReadOnly || saving ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <Save className="h-4 w-4" />
          {saving ? t('settings.brandManager.saving') : t('settings.brandManager.applyButton')}
        </button>
      </form>

    </div>
  );
};
export default BrandManager;
