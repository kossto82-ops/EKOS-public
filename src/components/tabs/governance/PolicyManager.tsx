/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Scale, Plus, Globe2, Building2 } from 'lucide-react';
import { governanceRepository, IPolicy } from '../../../repositories/governanceRepository';
import { useDepartment } from '../../../hooks/useDepartment';
import { useAuth } from '../../../hooks/useAuth';
import { DEPARTMENTS } from '../../../constants/departments';
import { useToast } from '../../../hooks/useToast';
import { useLocale } from '../../../context/LocaleContext';
import { Modal } from '../../shared/Modal';
import { Badge, EmptyState } from '../../shared/DesignSystem';

interface PolicyManagerProps {
  isReadOnly?: boolean;
}

export const PolicyManager: React.FC<PolicyManagerProps> = ({ isReadOnly = false }) => {
  const { activeDepartment, userDepartments } = useDepartment();
  const auth = useAuth();
  const toast = useToast();
  const { t } = useLocale();
  const [policies, setPolicies] = useState<IPolicy[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('Compliance');
  const [newScope, setNewScope] = useState<'global' | 'specific'>('specific');
  const [newDeptIds, setNewDeptIds] = useState<string[]>([activeDepartment.id]);

  const canManagePolicies = !isReadOnly && (auth?.canPerformAction ? auth.canPerformAction('upload_kb') : false);

  useEffect(() => {
    governanceRepository.getPolicies()
      .then(setPolicies)
      .catch(err => {
        console.error('Failed to load policies:', err);
        toast.error(t('policyManager.loadError'));
      });
  }, []);

  // Show only policies relevant to the active department (or all, if user
  // has wildcard department access — mirrors the same rule used for documents).
  const isWildcardDept = userDepartments.length === DEPARTMENTS.length;
  const visiblePolicies = policies.filter(p =>
    p.departmentScope === 'global' ||
    isWildcardDept ||
    (p.departmentIds || []).includes(activeDepartment.id)
  );

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || !newTitle.trim() || !newDescription.trim()) return;

    const newPolicy: IPolicy = {
      id: `policy_${Date.now()}`,
      title: newTitle.trim(),
      description: newDescription.trim(),
      category: newCategory,
      departmentScope: newScope,
      departmentIds: newScope === 'specific' ? newDeptIds : undefined,
      createdAt: new Date().toISOString(),
      createdBy: auth?.currentUser?.name || 'Unknown'
    };

    const updated = [newPolicy, ...policies];
    setPolicies(updated);
    await governanceRepository.savePolicies(updated);
    toast.success(t('policyManager.createSuccess', { title: newPolicy.title }));

    setIsFormOpen(false);
    setNewTitle('');
    setNewDescription('');
    setNewCategory('Compliance');
    setNewScope('specific');
    setNewDeptIds([activeDepartment.id]);
  };

  const toggleDeptId = (deptId: string) => {
    setNewDeptIds(prev =>
      prev.includes(deptId) ? prev.filter(d => d !== deptId) : [...prev, deptId]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('policyManager.showingPoliciesFor')} <strong className="text-slate-700 dark:text-slate-300">{activeDepartment.displayName}</strong>
          {isWildcardDept && ` ${t('policyManager.allDeptsFullAccess')}`}
        </p>
        {(canManagePolicies || isReadOnly) && (
          <button
            onClick={() => setIsFormOpen(true)}
            disabled={isReadOnly}
            className={`flex items-center gap-1.5 text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-md transition-colors ${isReadOnly ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <Plus className="h-3.5 w-3.5" /> {t('policyManager.newPolicyButton')}
          </button>
        )}
      </div>

      {visiblePolicies.length === 0 && (
        <EmptyState
          icon={Scale}
          title={t('policyManager.noPoliciesTitle')}
          description={t('policyManager.noPoliciesBody')}
        />
      )}

      <div className="space-y-3">
        {visiblePolicies.map(policy => (
          <div
            key={policy.id}
            className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-white dark:bg-slate-950"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{policy.title}</h4>
                  <Badge appearance="outline" variant="brand">
                    {policy.category}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed max-w-2xl">
                  {policy.description}
                </p>
              </div>
              <div className="flex items-center gap-1 text-3xs font-mono text-slate-400 dark:text-slate-500 shrink-0">
                {policy.departmentScope === 'global' ? (
                  <><Globe2 className="h-3 w-3" /> {t('policyManager.globalScopeBadge')}</>
                ) : (
                  <>
                    <Building2 className="h-3 w-3" />
                    {(policy.departmentIds || []).length !== 1
                      ? t('policyManager.deptCountPlural', { count: (policy.departmentIds || []).length })
                      : t('policyManager.deptCountSingular', { count: (policy.departmentIds || []).length })}
                  </>
                )}
              </div>
            </div>
            <p className="text-3xs text-slate-400 dark:text-slate-500 mt-3 font-mono">
              {policy.createdBy} · {new Date(policy.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>

      {isFormOpen && (
        <Modal
          titleId="policy_manager_modal_title"
          title={t('policyManager.modalTitle')}
          icon={<Scale className="h-4 w-4 text-brand-600 dark:text-brand-400" />}
          onClose={() => setIsFormOpen(false)}
          onSubmit={handleCreatePolicy}
          closeAriaLabel={t('policyManager.closeAria')}
        >
          <div>
            <label htmlFor="policy_form_title" className="text-3xs text-slate-400 uppercase font-bold tracking-wider block mb-1">{t('policyManager.titleLabel')}</label>
            <input
              id="policy_form_title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
              className="w-full text-xs rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            />
          </div>
          <div>
            <label htmlFor="policy_form_category" className="text-3xs text-slate-400 uppercase font-bold tracking-wider block mb-1">{t('policyManager.categoryLabel')}</label>
            <select
              id="policy_form_category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-full text-xs rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            >
              <option>Data Retention</option>
              <option>SLA Escalation</option>
              <option>Access Review</option>
              <option>Compliance</option>
            </select>
          </div>
          <div>
            <label htmlFor="policy_form_description" className="text-3xs text-slate-400 uppercase font-bold tracking-wider block mb-1">{t('policyManager.descriptionLabel')}</label>
            <textarea
              id="policy_form_description"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              required
              rows={3}
              className="w-full text-xs rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            />
          </div>
          <div>
            <label className="text-3xs text-slate-400 uppercase font-bold tracking-wider block mb-2">{t('policyManager.scopeLabel')}</label>
            <div className="flex gap-4 mb-2">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" checked={newScope === 'global'} onChange={() => setNewScope('global')} />
                {t('policyManager.globalScopeOption')}
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" checked={newScope === 'specific'} onChange={() => setNewScope('specific')} />
                {t('policyManager.specificScopeOption')}
              </label>
            </div>
            {newScope === 'specific' && (
              <div className="flex flex-wrap gap-1.5">
                {DEPARTMENTS.map(d => (
                  <button
                    type="button"
                    key={d.id}
                    onClick={() => toggleDeptId(d.id)}
                    className={`text-3xs px-2 py-1 rounded-md border transition-colors ${
                      newDeptIds.includes(d.id)
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500'
                    }`}
                  >
                    {d.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setIsFormOpen(false)} className="px-3 py-1.5 text-xs font-semibold border border-slate-200 dark:border-slate-800 rounded-md">
              {t('common.cancel')}
            </button>
            <button type="submit" className="px-3 py-1.5 text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-md">
              {t('policyManager.createButton')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};
