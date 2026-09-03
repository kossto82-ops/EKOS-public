/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { KBDocument, KBDocumentUpdate, PortalUser } from '../../../types';
import { X, Calendar, FileText, User, Sparkles, Home, Library, Eye, Pencil, Save, BarChart3 } from 'lucide-react';
import { MarkdownContent } from '../../shared/MarkdownContent';
import { Breadcrumb } from '../../shared/Breadcrumb';
import { DEPARTMENTS } from '../../../constants/departments';
import { useBrand } from '../../../hooks/useBrand';
import { getBrandDisplayName as getBrandName } from '../../../utils/brandUtils';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { OVERLAY_SCRIM, OVERLAY_Z } from '../../shared/DesignSystem';

interface DocumentDetailDrawerProps {
  doc: KBDocument | null;
  onClose: () => void;
  /** Whether the current viewer may edit this document at all (responsible owner or KB manager). */
  canEdit?: boolean;
  /** Whether the viewer is a KB manager (Admin/TeamLeader) — gates classification fields (department, region, owner). */
  canManage?: boolean;
  /** Persists an edit; resolves to whether the save succeeded. */
  onSave?: (id: string, patch: KBDocumentUpdate) => Promise<boolean>;
  /** Roster used to pick the responsible owner. */
  users?: PortalUser[];
  /** Opens the audit-profile side panel for this document (trust/usage metrics). */
  onViewAudit?: () => void;
}

export const DocumentDetailDrawer: React.FC<DocumentDetailDrawerProps> = ({ doc, onClose, canEdit = false, canManage = false, onSave, users = [], onViewAudit }) => {
  const { allBrands } = useBrand();
  const trapRef = useFocusTrap<HTMLDivElement>(!!doc);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editOwner, setEditOwner] = useState('');
  const [editOwnerId, setEditOwnerId] = useState('');
  const [editDepartments, setEditDepartments] = useState<string[]>([]); // [] = all departments (global); else department ids
  const [editRegion, setEditRegion] = useState('');        // '' = global; else a brandId
  const [isSaving, setIsSaving] = useState(false);

  const toggleDepartment = (deptId: string) =>
    setEditDepartments((prev) => (prev.includes(deptId) ? prev.filter((d) => d !== deptId) : [...prev, deptId]));

  // Seed ALL edit buffers from the current document. Used on open, and on
  // Cancel/Escape so a discarded change (including the department/region
  // selects, which were previously left dirty) never leaks into the next Save.
  const seedBuffers = () => {
    setEditContent(doc?.content || '');
    setEditOwner(doc?.owner || '');
    setEditOwnerId(doc?.ownerId || '');
    setEditDepartments(doc?.departmentScope === 'specific' ? (doc?.departmentIds || []) : []);
    setEditRegion(doc?.scope === 'brand' ? (doc?.brandId || '') : '');
  };

  const cancelEdit = () => {
    seedBuffers();
    setIsEditing(false);
  };

  // Re-seed and leave edit mode whenever the drawer opens a (different) document.
  useEffect(() => {
    setIsEditing(false);
    seedBuffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Esc closes the drawer, but not while editing — there it discards the
      // in-progress edit (re-seeding buffers) so an accidental keypress can't
      // carry a reverted change into the next Save.
      if (e.key === 'Escape') {
        if (isEditing) cancelEdit();
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, isEditing]);

  if (!doc) return null;

  const canEditDoc = canEdit && !!onSave;
  const responsibleUser = users.find((u) => u.id === doc.ownerId);

  // Combined "Function · Region" department label derived from the existing
  // scoping fields (departmentIds/departmentScope + scope/brandId). A document
  // can belong to MULTIPLE departments — join them all.
  const functionLabel = doc.departmentScope === 'specific' && doc.departmentIds && doc.departmentIds.length > 0
    ? doc.departmentIds.map((id) => DEPARTMENTS.find((d) => d.id === id)?.displayName || id).join(', ')
    : 'All departments';
  const regionLabel = doc.scope === 'brand' && doc.brandId
    ? getBrandName(doc.brandId, allBrands)
    : 'Global';
  const departmentLabel = `${functionLabel} · ${regionLabel}`;

  const handleSave = async () => {
    if (!onSave) return;
    // Dirty-tracking: only send fields the user actually changed. This avoids
    // (a) re-versioning the doc on a no-op content save, and (b) collapsing a
    // multi-department doc to a single id just because a manager saved an
    // unrelated field — the function/region fields are only written when their
    // select actually changed from the document's current value.
    const docDepartments = doc.departmentScope === 'specific' ? (doc.departmentIds || []) : [];
    const docRegion = doc.scope === 'brand' ? (doc.brandId || '') : '';
    // Order-insensitive set comparison so re-ordering alone isn't "dirty".
    const sameDepartments =
      editDepartments.length === docDepartments.length &&
      [...editDepartments].sort().join('\0') === [...docDepartments].sort().join('\0');

    const patch: KBDocumentUpdate = {};
    if (editContent !== (doc.content || '')) patch.content = editContent;
    if (canManage) {
      if (editOwner.trim() !== (doc.owner || '')) patch.owner = editOwner.trim();
      if ((editOwnerId || '') !== (doc.ownerId || '')) patch.ownerId = editOwnerId || null;
      if (!sameDepartments) {
        patch.departmentScope = editDepartments.length > 0 ? 'specific' : 'global';
        patch.departmentIds = editDepartments;
      }
      if (editRegion !== docRegion) {
        patch.scope = editRegion ? 'brand' : 'global';
        patch.brandId = editRegion || null;
      }
    }

    if (Object.keys(patch).length === 0) {
      setIsEditing(false); // nothing changed — don't hit the server (avoids a 400)
      return;
    }

    setIsSaving(true);
    const ok = await onSave(doc.id, patch);
    setIsSaving(false);
    if (ok) setIsEditing(false);
  };

  const isExpired = doc.approvalStatus === 'Expired' || (doc.expirationDate && new Date(doc.expirationDate) < new Date());

  const getApprovalBadgeStyles = () => {
    if (isExpired) {
      return 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
    }
    if (doc.approvalStatus === 'Approved') {
      return 'bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-950 dark:border-slate-200';
    }
    return 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800';
  };

  const getBrandDisplayName = (bId?: string) => {
    if (!bId) return 'Global (Shared)';
    return getBrandName(bId, allBrands);
  };

  return (
    <div className={`fixed inset-0 ${OVERLAY_Z} flex justify-end`}>
      {/* Overlay */}
      <div
        className={`absolute inset-0 ${OVERLAY_SCRIM} animate-fadeIn`}
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-drawer-title"
        tabIndex={-1}
        className="relative w-full max-w-4xl bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-900 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200 focus:outline-none"
      >
        
        {/* Header Section */}
        <div className="px-10 py-8 border-b border-slate-100 dark:border-slate-900 flex items-start justify-between select-none">
          <div className="space-y-3 max-w-[85%]">
            <Breadcrumb items={[
              { 
                label: 'Home', 
                icon: Home,
                onClick: () => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }));
                }
              },
              { 
                label: 'Documents', 
                icon: Library,
                onClick: () => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'kb' }));
                }
              },
              { label: 'Detail', icon: Eye },
              { label: doc.name, icon: FileText }
            ]} />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest font-sans">
                {getBrandDisplayName(doc.brandId)}
              </span>
              {doc.category && (
                <>
                  <span className="text-slate-300 dark:text-slate-700 font-bold text-xs">•</span>
                  <span className="text-3xs font-bold text-brand-600 dark:text-brand-400 uppercase tracking-wider font-mono">
                    {doc.category}
                  </span>
                </>
              )}
            </div>
            <h2 id="doc-drawer-title" className="text-2xl font-extrabold text-slate-900 dark:text-white font-sans tracking-tight leading-tight">
              {doc.name}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isEditing && onViewAudit && (
              <button
                type="button"
                onClick={onViewAudit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                title="View audit & usage metrics"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Audit
              </button>
            )}
            {canEditDoc && !isEditing && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
            {canEditDoc && isEditing && (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="h-3.5 w-3.5" />
                  {isSaving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={isSaving}
                  className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-50 dark:hover:text-white dark:hover:bg-slate-900 transition-colors cursor-pointer"
              aria-label="Close document drawer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Document Content Area */}
        <div className="flex-1 overflow-y-auto px-10 py-8 space-y-8 font-sans">
          
          {/* Flat Horizontal Metadata Strip */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-100 dark:border-slate-900 pb-6 text-xs text-slate-500 dark:text-slate-400 select-none">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-400 uppercase tracking-wider text-4xs">Scope:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{getBrandDisplayName(doc.brandId)}</span>
            </div>
            <span className="text-slate-200 dark:text-slate-800">•</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-400 uppercase tracking-wider text-4xs">Version:</span>
              <span className="font-mono font-bold text-slate-700 dark:text-slate-300">v{doc.version || '1.0.0'}</span>
            </div>
            <span className="text-slate-200 dark:text-slate-800">•</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-400 uppercase tracking-wider text-4xs">Owner:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{doc.owner || 'Operations Board'}</span>
            </div>
            <span className="text-slate-200 dark:text-slate-800">•</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-400 uppercase tracking-wider text-4xs">Responsible:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1">
                <User className="h-3 w-3 text-slate-400" />
                {responsibleUser ? responsibleUser.name : 'Unassigned'}
              </span>
            </div>
            <span className="text-slate-200 dark:text-slate-800">•</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-400 uppercase tracking-wider text-4xs">Department:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{departmentLabel}</span>
            </div>
            <span className="text-slate-200 dark:text-slate-800">•</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-400 uppercase tracking-wider text-4xs">Last Verified:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{doc.lastReviewDate || doc.uploadedAt || 'N/A'}</span>
            </div>
            <span className="text-slate-200 dark:text-slate-800">•</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-400 uppercase tracking-wider text-4xs">Status:</span>
              <span className={`px-2 py-0.5 rounded text-4xs font-mono font-bold tracking-wider border ${getApprovalBadgeStyles()}`}>
                {isExpired ? 'EXPIRED' : (doc.approvalStatus || 'APPROVED').toUpperCase()}
              </span>
            </div>
          </div>

          {/* Contextual Assistant Action Row */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 rounded-xl select-none">
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-brand-500" />
              <div className="text-xs text-left">
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Grounded AI Retrieval Available</span>
                <span className="text-slate-400 dark:text-slate-500 text-3xs">Ask questions or synthesize answers from this policy document in the Knowledge Assistant.</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem('preload_copilot_query', doc.name);
                window.dispatchEvent(new CustomEvent('navigate_tab', { detail: 'copilot' }));
                onClose();
              }}
              className="inline-flex items-center gap-1 bg-slate-950 text-white dark:bg-slate-200 dark:text-slate-950 px-3 py-1.5 text-xs font-bold font-sans rounded-lg hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors cursor-pointer flex-shrink-0"
            >
              Ask Assistant
            </button>
          </div>

          {/* Edit form (classification for managers + markdown content) */}
          {isEditing ? (
            <div className="space-y-5">
              {canManage && (
                <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 space-y-4">
                  <span className="block text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Classification &amp; ownership
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <span className="block text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                        Departments (functions)
                      </span>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Document departments">
                        {DEPARTMENTS.map((d) => {
                          const on = editDepartments.includes(d.id);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => toggleDepartment(d.id)}
                              aria-pressed={on}
                              className={`px-2.5 py-1 rounded-full text-2xs font-semibold border transition-colors cursor-pointer ${
                                on
                                  ? 'bg-brand-600 text-white border-brand-600'
                                  : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-brand-400'
                              }`}
                            >
                              {d.displayName}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-3xs text-slate-400 leading-normal">
                        {editDepartments.length === 0
                          ? 'None selected → visible to ALL departments (global).'
                          : `Assigned to ${editDepartments.length} department${editDepartments.length > 1 ? 's' : ''}.`}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="edit_doc_region" className="block text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                        Region / brand
                      </label>
                      <select
                        id="edit_doc_region"
                        value={editRegion}
                        onChange={(e) => setEditRegion(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-white outline-hidden focus:border-brand-500"
                      >
                        <option value="">Global (all brands)</option>
                        {allBrands.map((b) => (
                          <option key={b.id} value={b.id}>{b.displayName}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="edit_doc_responsible" className="block text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                        Responsible owner
                      </label>
                      <select
                        id="edit_doc_responsible"
                        value={editOwnerId}
                        onChange={(e) => setEditOwnerId(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-white outline-hidden focus:border-brand-500"
                      >
                        <option value="">Unassigned</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>{u.name} — {u.role}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="edit_doc_owner" className="block text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                        Owner label
                      </label>
                      <input
                        id="edit_doc_owner"
                        type="text"
                        value={editOwner}
                        onChange={(e) => setEditOwner(e.target.value)}
                        placeholder="e.g. Customer Service Operations"
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-white outline-hidden focus:border-brand-500"
                      />
                    </div>
                  </div>
                  <p className="text-3xs text-slate-400 leading-normal">
                    Set a specific department and/or region to scope this document (fixes wrongly-&quot;Global&quot; docs). The assigned owner can edit its content without KB-manage permission.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="edit_doc_content" className="block text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Document content (Markdown)
                </label>
                <textarea
                  id="edit_doc_content"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={22}
                  className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm font-mono leading-relaxed text-slate-800 dark:text-slate-200 outline-hidden focus:border-brand-500 resize-y"
                />
              </div>
            </div>
          ) : (
          /* Official SOP Document Prose Content */
          <div className="max-w-none">
            {doc.content ? (
              <MarkdownContent headingOffset={2}>{doc.content}</MarkdownContent>
            ) : (
              <p className="italic text-slate-400 text-sm">No guidelines text compiled inside this document record.</p>
            )}
          </div>
          )}

          {/* Related Documents Section (Clean list with no decorative borders or shadows) */}
          <div className="border-t border-slate-100 dark:border-slate-900 pt-8 max-w-none select-none">
            <span className="text-3xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-3">
              Related Document References
            </span>
            <div className="divide-y divide-slate-100 dark:divide-slate-900">
              <div className="flex items-center gap-3 py-3">
                <FileText className="h-4 w-4 text-slate-400" />
                <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                  Corporate Compliance Appendix 4.A
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default DocumentDetailDrawer;
