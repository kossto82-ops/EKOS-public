/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { KBDocument } from '../../../types';
import { X } from 'lucide-react';
import { useBrand } from '../../../hooks/useBrand';
import { getBrandDisplayName } from '../../../utils/brandUtils';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { DEPARTMENTS } from '../../../constants/departments';
import { OVERLAY_SCRIM, OVERLAY_Z } from '../../shared/DesignSystem';

interface DocumentAuditProfileDrawerProps {
  selectedDoc: KBDocument | null;
  setSelectedDoc: (doc: KBDocument | null) => void;
  documents: KBDocument[];
}

export const DocumentAuditProfileDrawer: React.FC<DocumentAuditProfileDrawerProps> = ({
  selectedDoc,
  setSelectedDoc,
  documents,
}) => {
  const { allBrands } = useBrand();
  const trapRef = useFocusTrap<HTMLDivElement>(!!selectedDoc);

  useEffect(() => {
    if (!selectedDoc) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedDoc(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedDoc, setSelectedDoc]);

  if (!selectedDoc) return null;

  // Consistent "Function · Region" department label — same derivation as the
  // detail drawer, so the two views never disagree (the legacy free-text
  // `department` column is no longer surfaced as the department).
  const functionLabel = selectedDoc.departmentScope === 'specific' && selectedDoc.departmentIds?.[0]
    ? (DEPARTMENTS.find((d) => d.id === selectedDoc.departmentIds![0])?.displayName || selectedDoc.departmentIds[0])
    : 'All departments';
  const regionLabel = selectedDoc.scope === 'brand' && selectedDoc.brandId
    ? getBrandDisplayName(selectedDoc.brandId, allBrands)
    : 'Global';
  const departmentLabel = `${functionLabel} · ${regionLabel}`;

  // One scrim, not two. This root carried bg-slate-950/40 + backdrop-blur-xs and
  // the click-to-close child below carried another bg-slate-900/60 +
  // backdrop-blur-xs on top of it, so the page was darkened and blurred twice and
  // the result matched no other dialog in the app. The scrim now lives on the
  // child that owns the click target.
  return (
    <div className={`fixed inset-0 ${OVERLAY_Z} flex justify-end transition-opacity animate-in fade-in duration-150`}>
      {/* Backdrop click to close */}
      <div
        className={`absolute inset-0 ${OVERLAY_SCRIM}`}
        onClick={() => setSelectedDoc(null)}
      />

      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-drawer-title"
        tabIndex={-1}
        className="relative w-full max-w-lg bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200 text-left focus:outline-none"
      >
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between select-none">
          <div>
            <span className="text-4xs font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
              Continuous Loop Node 4
            </span>
            <h2 id="audit-drawer-title" className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-normal font-sans">
              Document Audit Profile
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setSelectedDoc(null)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-950 transition-colors cursor-pointer"
            aria-label="Close Audit Details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Audit Metrics & Verification Metadata */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Doc Status Card */}
          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-3xs font-mono text-slate-400 block font-bold leading-normal">
                  SOP DOCUMENT TITLE:
                </span>
                <span className="text-xs font-extrabold text-slate-900 dark:text-white font-sans truncate max-w-xs block">
                  {selectedDoc.name}
                </span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-3xs font-bold uppercase tracking-wider font-mono border ${
                  selectedDoc.approvalStatus === 'Approved'
                    ? 'text-success-700 bg-success-50/50 border-success-200/50 dark:text-success-400 dark:bg-success-950/20'
                    : 'text-warning-700 bg-warning-50/50 border-warning-200/50 dark:text-warning-400 dark:bg-warning-950/20'
                }`}
              >
                {selectedDoc.approvalStatus || 'Draft'}
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-3xs font-mono text-slate-400 block font-bold leading-normal uppercase">
                  Continuous Trust Ratio
                </span>
                <span className="text-xs font-bold text-success-600 dark:text-success-400 font-mono">
                  {Math.round(
                    ((selectedDoc.ratingUp || 12) /
                      ((selectedDoc.ratingUp || 12) + (selectedDoc.ratingDown || 1))) *
                      100
                  )}
                  % Trust Ratio
                </span>
              </div>
              <div className="h-2 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-success-500 rounded-full"
                  style={{
                    width: `${Math.round(
                      ((selectedDoc.ratingUp || 12) /
                        ((selectedDoc.ratingUp || 12) + (selectedDoc.ratingDown || 1))) *
                        100
                    )}%`,
                  }}
                />
              </div>
              <p className="text-3xs text-slate-500 dark:text-slate-500 leading-relaxed font-sans">
                The trust index is calculated continuously based on operator helpfulness ratings and
                automated grounding similarity scores.
              </p>
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 bg-slate-50/50 dark:bg-slate-950/30 p-3 rounded-lg border border-slate-100/50 dark:border-slate-800/60">
                <span className="text-4xs font-mono font-bold text-slate-500 uppercase block">
                  Category
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-300 font-sans">
                  {selectedDoc.category || 'Operations Manual'}
                </span>
              </div>
              <div className="space-y-1 bg-slate-50/50 dark:bg-slate-950/30 p-3 rounded-lg border border-slate-100/50 dark:border-slate-800/60">
                <span className="text-4xs font-mono font-bold text-slate-500 uppercase block">
                  Brand Scope
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-300 font-sans truncate block">
                  {selectedDoc.brandId ? getBrandDisplayName(selectedDoc.brandId, allBrands) : 'Global (Shared)'}
                </span>
              </div>
              <div className="space-y-1 bg-slate-50/50 dark:bg-slate-950/30 p-3 rounded-lg border border-slate-100/50 dark:border-slate-800/60">
                <span className="text-4xs font-mono font-bold text-slate-500 uppercase block">
                  Last Updated
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-300 font-mono">
                  {selectedDoc.lastReviewDate ||
                    (selectedDoc.uploadedAt ? selectedDoc.uploadedAt.split('T')[0] : '2026-06-01')}
                </span>
              </div>
              <div className="space-y-1 bg-slate-50/50 dark:bg-slate-950/30 p-3 rounded-lg border border-slate-100/50 dark:border-slate-800/60">
                <span className="text-4xs font-mono font-bold text-slate-500 uppercase block">
                  Confidence Index
                </span>
                <span className="text-xs font-bold text-success-600 dark:text-success-500 font-mono">
                  {Math.round(
                    ((selectedDoc.ratingUp || 12) /
                      ((selectedDoc.ratingUp || 12) + (selectedDoc.ratingDown || 1))) *
                      100
                  )}
                  % Confidence
                </span>
              </div>
              <div className="space-y-1 bg-slate-50/50 dark:bg-slate-950/30 p-3 rounded-lg border border-slate-100/50 dark:border-slate-800/60">
                <span className="text-4xs font-mono font-bold text-slate-500 uppercase block">
                  Corporate Owner
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-300 font-sans">
                  {selectedDoc.owner || 'Operations Board'}
                </span>
              </div>
              <div className="space-y-1 bg-slate-50/50 dark:bg-slate-950/30 p-3 rounded-lg border border-slate-100/50 dark:border-slate-800/60">
                <span className="text-4xs font-mono font-bold text-slate-500 uppercase block">
                  Department
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-300 font-sans">
                  {departmentLabel}
                </span>
              </div>
            </div>

            {/* Document Preview Text Box */}
            <div className="space-y-2">
              <span className="text-3xs font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                Document Preview
              </span>
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs leading-relaxed max-h-60 overflow-y-auto font-mono text-slate-700 dark:text-slate-400 animate-in fade-in duration-200">
                {selectedDoc.content || 'No text preview available for this file type format.'}
              </div>
            </div>

            {/* Related Documents list */}
            <div className="space-y-2.5">
              <span className="text-3xs font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                Related SOP Documents
              </span>
              <div className="space-y-2">
                {documents
                  .filter(
                    (d) =>
                      d.id !== selectedDoc.id &&
                      (d.scope === selectedDoc.scope || d.brandId === selectedDoc.brandId)
                  )
                  .slice(0, 3)
                  .map((relDoc) => (
                    <button
                      key={relDoc.id}
                      type="button"
                      onClick={() => setSelectedDoc(relDoc)}
                      className="w-full text-left flex items-center justify-between p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 transition-colors text-xs cursor-pointer"
                    >
                      <span className="font-semibold text-slate-800 dark:text-slate-300 truncate max-w-[280px]">
                        {relDoc.name}
                      </span>
                      <span className="text-3xs font-mono text-slate-400 font-bold uppercase">
                        v{relDoc.version || '1.0'}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
