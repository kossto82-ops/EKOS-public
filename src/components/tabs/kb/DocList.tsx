/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { KBDocument } from '../../../types';
import { useToast } from '../../../hooks/useToast';
import { useBrand } from '../../../hooks/useBrand';
import { useDepartment } from '../../../hooks/useDepartment';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useLocale } from '../../../context/LocaleContext';
import { getBrandDisplayName as getBrandName } from '../../../utils/brandUtils';
import { extractFileText } from '../../../utils/extractFileText';
import { downloadKbDocument } from '../../../utils/documentDownload';
import { Modal } from '../../shared/Modal';
import {
  Download,
  Trash2,
  ShieldAlert,
  Upload
} from 'lucide-react';
import { EmptyState } from '../../shared/DesignSystem';

// Fixed pixel heights the virtualized list (react-window's List, below) uses
// to compute row positions without rendering every row. Must match the
// actual rendered height of a category header / DocRow — if either
// component's content grows (e.g. a wrapped title line), bump the matching
// constant, since react-window doesn't measure DOM, it trusts these values.
const CATEGORY_HEADER_ROW_HEIGHT = 56;
const DOC_ROW_HEIGHT = 76;

type ListRow =
  | { kind: 'header'; category: string; count: number }
  | { kind: 'doc'; doc: KBDocument };

interface DocListProps {
  documents: KBDocument[];
  onUpload: (doc: KBDocument, scope: 'global' | 'brand') => void;
  onDelete: (id: string) => void;
  canManage: boolean;
  brandId: string;
  brandDisplayName: string;
  brandColor?: string;
  brandBadgeIcon?: React.ReactNode;
  onSelectDoc?: (doc: KBDocument) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

interface DocRowProps {
  doc: KBDocument;
  canManage: boolean;
  isPendingDelete: boolean;
  docBrandDisplayName: string;
  onSelectDoc?: (doc: KBDocument) => void;
  onDownload: (doc: KBDocument) => void;
  onDeleteStart: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}

/**
 * A single document row. Memoized so filter/sort/category-grouping
 * re-renders in the parent only re-render the specific row(s) whose own
 * props (e.g. isPendingDelete) actually changed.
 */
const DocRow: React.FC<DocRowProps> = React.memo(function DocRow({
  doc,
  canManage,
  isPendingDelete,
  docBrandDisplayName,
  onSelectDoc,
  onDownload,
  onDeleteStart,
  onDeleteConfirm,
  onDeleteCancel,
}) {
  const { t } = useLocale();
  const isExpired = doc.approvalStatus === 'Expired' || (doc.expirationDate && new Date(doc.expirationDate) < new Date());

  const getApprovalBadgeStyles = () => {
    if (doc.approvalStatus === 'Banned') {
      return 'bg-danger-50 text-danger-700 dark:bg-danger-950/20 dark:text-danger-300 border-danger-200 dark:border-danger-900/60';
    }
    if (isExpired) {
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-400 border-slate-200 dark:border-slate-800';
    }
    if (doc.approvalStatus === 'Approved') {
      return 'bg-slate-950 text-white dark:bg-slate-800 dark:text-slate-200 border-slate-950 dark:border-slate-800';
    }
    return 'bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-400 border-slate-200 dark:border-slate-800';
  };

  return (
    <div
      className="group relative flex items-center justify-between py-3.5 px-4 text-sm font-sans select-none transition-all border-b border-slate-100 dark:border-slate-900 hover:bg-slate-50/40 dark:hover:bg-slate-900/10 rounded-sm"
    >
      <div className="flex items-start gap-4 min-w-0 flex-1">
        {/* Column 1: Primary Title and Secondary metadata. The title itself
            is the "open details" control — deliberately not a row-wide
            role="button" wrapper, since Download/Delete below are real
            <button>s and nesting interactive controls inside another one
            is an axe-core "nested-interactive" violation (screen readers
            and some pointer/keyboard flows can't reliably reach the inner
            controls). See docs/DECISIONS.md ADR-015 for the incident this fixed. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => onSelectDoc?.(doc)}
              aria-label={t('kb.docList.openDetailsAria', { name: doc.name })}
              className="text-sm font-bold text-left text-slate-900 dark:text-slate-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors truncate min-w-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-sm"
            >
              {doc.name}
            </button>
            {doc.isImportant && (
              <span className="inline-flex items-center bg-slate-950 text-white dark:bg-slate-200 dark:text-slate-950 px-1.5 py-0.2 text-5xs font-mono tracking-wider uppercase font-bold rounded-xs">
                {t('kb.docList.priorityBadge')}
              </span>
            )}
          </div>
          {/* Secondary Metadata Row */}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 dark:text-slate-400 select-none">
            <span className="font-semibold text-slate-700 dark:text-slate-400">{doc.owner || t('kb.docList.defaultOwner')}</span>
            <span className="text-slate-200 dark:text-slate-800">•</span>
            <span className="font-mono text-2xs">{doc.lastReviewDate || doc.uploadedAt || t('kb.docList.notAvailable')}</span>
            <span className="text-slate-200 dark:text-slate-800">•</span>
            <span className="font-medium text-slate-400 dark:text-slate-500">{docBrandDisplayName}</span>
          </div>
        </div>
      </div>

      {/* Column 2: Tertiary - Version & Status */}
      <div className="flex items-center gap-4 text-xs shrink-0 select-none px-6">
        <span className="font-mono text-slate-600 dark:text-slate-500 font-bold bg-slate-50 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-100 dark:border-slate-800 text-3xs">
          v{doc.version || '1.0.0'}
        </span>
        <span className={`px-2 py-0.5 rounded text-4xs font-bold font-mono tracking-wider border ${getApprovalBadgeStyles()}`}>
          {doc.approvalStatus === 'Banned' ? 'BANNED' : isExpired ? 'EXPIRED' : (doc.approvalStatus || 'APPROVED').toUpperCase()}
        </span>
      </div>

      {/* Column 3: Actions */}
      <div className="flex items-center gap-1 shrink-0 select-none">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDownload(doc);
          }}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white transition-colors cursor-pointer"
          title={t('kb.docList.downloadTitle')}
          aria-label={t('kb.docList.downloadAria', { name: doc.name })}
        >
          <Download className="h-3.5 w-3.5" />
        </button>

        {canManage && isPendingDelete && (
          <div className="flex items-center gap-1 animate-fadeIn" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onDeleteConfirm(doc.id)}
              className="rounded-lg px-2 py-1 text-3xs font-bold uppercase tracking-wide bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
            >
              {t('kb.docList.confirmDelete')}
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              className="rounded-lg px-2 py-1 text-3xs font-bold uppercase tracking-wide text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {t('kb.docList.deleteCancel')}
            </button>
          </div>
        )}

        {canManage && !isPendingDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteStart(doc.id);
            }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700 dark:hover:bg-slate-800 dark:hover:text-red-500 transition-all cursor-pointer"
            title={t('kb.docList.deleteTitle')}
            aria-label={t('kb.docList.deleteAria', { name: doc.name })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
});

interface VirtualRowProps {
  rows: ListRow[];
  canManage: boolean;
  pendingDeleteId: string | null;
  getBrandDisplayName: (bId?: string) => string;
  onSelectDoc?: (doc: KBDocument) => void;
  onDownload: (doc: KBDocument) => void;
  onDeleteStart: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}

/**
 * Row renderer for react-window's List. `ariaAttributes` (role="listitem" +
 * aria-posinset/aria-setsize) is provided by react-window itself — spread
 * onto both row kinds so a screen reader gets correct position/count
 * context even though only a window of rows exists in the DOM at once.
 */
function VirtualRow({
  index,
  style,
  ariaAttributes,
  rows,
  canManage,
  pendingDeleteId,
  getBrandDisplayName,
  onSelectDoc,
  onDownload,
  onDeleteStart,
  onDeleteConfirm,
  onDeleteCancel,
}: RowComponentProps<VirtualRowProps>): React.ReactElement | null {
  const { t } = useLocale();
  const row = rows[index];

  if (row.kind === 'header') {
    return (
      <div style={style} {...ariaAttributes} className="flex items-center gap-2 select-none px-6 pt-8 pb-2 box-border">
        <span className="text-3xs font-extrabold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          {row.category}
        </span>
        <div className="flex-1 h-[1px] bg-slate-100 dark:bg-slate-900" />
        <span className="text-3xs font-mono text-slate-400 dark:text-slate-500 font-bold">
          {t(row.count === 1 ? 'kb.docList.docCountSingular' : 'kb.docList.docCountPlural', { count: row.count })}
        </span>
      </div>
    );
  }

  return (
    <div style={style} {...ariaAttributes} className="px-6 box-border">
      <DocRow
        doc={row.doc}
        canManage={canManage}
        isPendingDelete={pendingDeleteId === row.doc.id}
        docBrandDisplayName={getBrandDisplayName(row.doc.brandId)}
        onSelectDoc={onSelectDoc}
        onDownload={onDownload}
        onDeleteStart={onDeleteStart}
        onDeleteConfirm={onDeleteConfirm}
        onDeleteCancel={onDeleteCancel}
      />
    </div>
  );
}

export const DocList: React.FC<DocListProps> = ({
  documents,
  onUpload,
  onDelete,
  canManage,
  brandId,
  brandDisplayName,
  onSelectDoc,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore
}) => {
  const toast = useToast();
  const { t } = useLocale();
  const { allBrands } = useBrand();
  const { activeDepartment, allDepartments } = useDepartment();

  // --- FILTER, SEARCH, AND SORT STATES ---
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('recent');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Debounced so filtering doesn't re-run on every keystroke — the input
  // itself still updates instantly via `searchQuery`.
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200);

  // --- DYNAMIC META EXTRACTORS ---
  const availableCategories = useMemo(
    () => Array.from(new Set(documents.map((d) => d.category).filter(Boolean))) as string[],
    [documents]
  );

  const getBrandDisplayName = (bId?: string) => {
    if (!bId) return t('kb.docList.globalShared');
    return getBrandName(bId, allBrands);
  };

  // --- FILTERING LOGIC ---
  const filteredDocs = useMemo(() => documents.filter((doc) => {
    // 0. Search Query Filter
    if (debouncedSearchQuery.trim() !== '') {
      const q = debouncedSearchQuery.toLowerCase();
      const matchesName = doc.name?.toLowerCase().includes(q);
      const matchesCategory = doc.category?.toLowerCase().includes(q);
      const matchesOwner = doc.owner?.toLowerCase().includes(q);
      const matchesContent = doc.content?.toLowerCase().includes(q);
      if (!matchesName && !matchesCategory && !matchesOwner && !matchesContent) {
        return false;
      }
    }

    // 1. Brand Filter
    if (brandFilter !== 'all') {
      if (brandFilter === 'global' && doc.scope !== 'global') return false;
      if (brandFilter === 'active' && (doc.scope !== 'brand' || doc.brandId !== brandId)) return false;
      if (brandFilter !== 'global' && brandFilter !== 'active') {
        if (doc.scope === 'global') return false;
        if (doc.scope === 'brand' && doc.brandId !== brandFilter) return false;
      }
    }

    // 2. Category Filter
    if (categoryFilter !== 'all') {
      if (doc.category !== categoryFilter) return false;
    }

    // 3. Status Filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'Expired') {
        const isExpired = doc.approvalStatus === 'Expired' || (doc.expirationDate && new Date(doc.expirationDate) < new Date());
        if (!isExpired) return false;
      } else {
        if (doc.approvalStatus !== statusFilter) return false;
      }
    }

    return true;
  }), [documents, debouncedSearchQuery, brandFilter, categoryFilter, statusFilter, brandId]);

  // --- SORTING LOGIC ---
  const sortedDocs = useMemo(() => [...filteredDocs].sort((a, b) => {
    // 1. Visual Hierarchy: Important documents always rise to the top
    if (a.isImportant && !b.isImportant) return -1;
    if (!a.isImportant && b.isImportant) return 1;

    // 2. Secondary sorting based on selected attribute
    if (sortBy === 'recent') {
      const dateA = new Date(a.uploadedAt || a.lastReviewDate || 0).getTime();
      const dateB = new Date(b.uploadedAt || b.lastReviewDate || 0).getTime();
      return dateB - dateA;
    }

    if (sortBy === 'alphabetical') {
      return a.name.localeCompare(b.name);
    }

    return 0;
  }), [filteredDocs, sortBy]);

  const handleDownload = (doc: KBDocument) => {
    // Built in the browser from the content already loaded with the document —
    // see src/utils/documentDownload.ts for why there is no file to stream and
    // why a non-text extension is rewritten to .txt.
    const filename = downloadKbDocument(doc);
    if (filename) {
      toast.success(t('kb.docList.downloadToast', { name: filename }));
    } else {
      // A document whose ingestion produced no text has nothing to hand over.
      // Saying so is the point: this button used to report success regardless.
      toast.error(t('kb.docList.downloadEmpty', { name: doc.name }));
    }
  };

  const handleDeleteConfirm = (id: string) => {
    setPendingDeleteId(null);
    onDelete(id);
  };

  const handleDeleteCancel = () => setPendingDeleteId(null);

  // Group documents by category, then flatten into a single ordered row
  // list (header rows interleaved with doc rows) for react-window's List
  // below — it renders a flat sequence of fixed-position rows, so the
  // grouping has to be baked into row order/kind rather than nested
  // wrapper elements. Computed in one memoized pass so an unrelated
  // re-render (e.g. toggling the delete-confirm UI) doesn't redo the
  // Set/sort/group/flatten work every time.
  const rows = useMemo<ListRow[]>(() => {
    const groups = new Map<string, KBDocument[]>();
    for (const doc of sortedDocs) {
      const cat = doc.category || 'General Guidelines';
      const existing = groups.get(cat);
      if (existing) existing.push(doc);
      else groups.set(cat, [doc]);
    }
    // Sort categories alphabetically, putting 'General Guidelines' last
    const categories = Array.from(groups.keys()).sort((a, b) => {
      if (a === 'General Guidelines') return 1;
      if (b === 'General Guidelines') return -1;
      return a.localeCompare(b);
    });
    const out: ListRow[] = [];
    for (const category of categories) {
      const docs = groups.get(category) || [];
      if (docs.length === 0) continue;
      out.push({ kind: 'header', category, count: docs.length });
      for (const doc of docs) out.push({ kind: 'doc', doc });
    }
    return out;
  }, [sortedDocs]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  // After a file is picked and its text extracted, we hold it here and open a
  // scope dialog so the uploader chooses WHERE the document lives (global vs
  // this brand, all departments vs specific ones) instead of it silently being
  // pinned to the current brand + current department — which made uploads
  // "disappear" the moment you looked at another brand/department.
  const [pendingUpload, setPendingUpload] = useState<{ name: string; ext: KBDocument['type']; content: string } | null>(null);
  const [uploadScope, setUploadScope] = useState<'global' | 'brand'>('brand');
  const [uploadDeptScope, setUploadDeptScope] = useState<'global' | 'specific'>('specific');
  const [uploadDeptIds, setUploadDeptIds] = useState<string[]>([activeDepartment.id]);

  const ALLOWED_UPLOAD_EXTENSIONS: KBDocument['type'][] = ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'md'];
  const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

  const isAllowedUploadExtension = (value: string): value is KBDocument['type'] =>
    (ALLOWED_UPLOAD_EXTENSIONS as string[]).includes(value);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!isAllowedUploadExtension(ext)) {
      toast.error(t('kb.docList.unsupportedFileType', { ext: ext || '?', types: ALLOWED_UPLOAD_EXTENSIONS.join(', ') }));
      e.target.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(t('kb.docList.fileTooLarge', { size: (file.size / (1024 * 1024)).toFixed(1) }));
      e.target.value = '';
      return;
    }

    setIsExtracting(true);
    try {
      const content = await extractFileText(file, ext);
      // Default the scope dialog to the current context, then let the user change it.
      setUploadScope('brand');
      setUploadDeptScope('specific');
      setUploadDeptIds([activeDepartment.id]);
      setPendingUpload({ name: file.name, ext, content });
    } catch (err: any) {
      toast.error(t('kb.docList.readError', { name: file.name, message: err?.message || t('kb.docList.readErrorFallback') }));
    } finally {
      setIsExtracting(false);
      e.target.value = '';
    }
  };

  const toggleUploadDept = (id: string) => {
    setUploadDeptIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  };

  const handleConfirmUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingUpload) return;
    const isGlobalDept = uploadDeptScope === 'global';
    const departmentIds = isGlobalDept ? [] : uploadDeptIds;
    if (!isGlobalDept && departmentIds.length === 0) {
      toast.error(t('kb.docList.chooseDepartmentError'));
      return;
    }
    const newDoc = {
      id: 'kb_' + Date.now(),
      name: pendingUpload.name,
      type: pendingUpload.ext,
      // Ingestion is synchronous: the file's text is already extracted
      // client-side and sent as `content`, so the document is fully ingested the
      // moment it's created. It was previously created as 'pending' with NO job
      // ever flipping it to 'trained', leaving every uploaded doc stuck
      // un-indexed (and, before the isRetrievableDoc fix, invisible to /api/search).
      // The governance state — awaiting human validation — is `approvalStatus`
      // ('Under Review'), not the ingestion `status`.
      status: 'trained' as const,
      scope: uploadScope,
      brandId: uploadScope === 'brand' ? brandId : undefined,
      departmentScope: uploadDeptScope,
      departmentIds,
      uploadedAt: new Date().toISOString(),
      uploadedBy: 'Current User',
      category: 'Operations Manual',
      approvalStatus: 'Under Review' as const,
      content: pendingUpload.content,
    };
    onUpload(newDoc, uploadScope);
    setPendingUpload(null);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-slate-950 font-sans">
      
      {/* 1. DISCOVERY WORKSPACE PANEL */}
      <div className="px-6 py-4 bg-white dark:bg-slate-950 border-b border-slate-100 dark:border-slate-900 space-y-4 flex-shrink-0 select-none">
        
        {/* Search Input Row */}
        <div className="relative">
          <label htmlFor="doc_search_query" className="sr-only">{t('kb.docList.searchAriaLabel')}</label>
          <input
            type="text"
            id="doc_search_query"
            placeholder={t('kb.docList.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-500 text-xs font-semibold rounded-lg pl-3 pr-12 py-2 border border-transparent focus:border-slate-200 dark:focus:border-slate-800 focus:outline-hidden transition-all focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded-xs"
              title={t('kb.docList.clearSearchTitle')}
            >
              {t('kb.docList.clear')}
            </button>
          )}
        </div>

        {/* Horizontal Select Filters Grid/Row */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">

          {/* Brand Scope Selector */}
          <div className="flex items-center gap-2">
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('kb.docList.scopeLabel')}
            </span>
            <div className="flex items-center gap-1">
              {[
                { id: 'all', label: t('kb.docList.scopeAllOption') },
                { id: 'global', label: t('kb.docList.scopeGlobalOption') },
                { id: 'active', label: brandDisplayName }
              ].map((scope) => {
                const isActive = brandFilter === scope.id;
                return (
                  <button
                    key={scope.id}
                    type="button"
                    onClick={() => setBrandFilter(scope.id)}
                    className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-950 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {scope.label}
                  </button>
                );
              })}
            </div>
          </div>

          <span className="text-slate-200 dark:text-slate-800 font-bold hidden sm:inline">|</span>

          {/* Category Selector */}
          <div className="flex items-center gap-2">
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('kb.docList.categoryLabel')}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  categoryFilter === 'all'
                    ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-950 font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('kb.docList.categoryAllOption')}
              </button>
              {availableCategories.map((cat) => {
                const isActive = categoryFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-950 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          <span className="text-slate-200 dark:text-slate-800 font-bold hidden sm:inline">|</span>

          {/* Status Selector */}
          <div className="flex items-center gap-2">
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('kb.docList.statusLabel')}
            </span>
            <div className="flex items-center gap-1">
              {[
                { id: 'all', label: t('kb.docList.statusAllOption') },
                { id: 'Approved', label: t('kb.docList.statusApprovedOption') },
                { id: 'Under Review', label: t('kb.docList.statusReviewOption') },
                { id: 'Draft', label: t('kb.docList.statusDraftOption') },
                { id: 'Expired', label: t('kb.docList.statusExpiredOption') },
                { id: 'Banned', label: t('kb.docList.statusBannedOption') }
              ].map((status) => {
                const isActive = statusFilter === status.id;
                return (
                  <button
                    key={status.id}
                    type="button"
                    onClick={() => setStatusFilter(status.id)}
                    className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-950 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {status.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sorting Selection aligned to the right */}
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="doc_sort_by" className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('kb.docList.sortLabel')}
            </label>
            <select
              id="doc_sort_by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="text-2xs bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 border-none rounded-md px-2 py-1 text-slate-700 dark:text-slate-300 font-semibold focus:outline-hidden cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <option value="recent">{t('kb.docList.sortRecentOption')}</option>
              <option value="alphabetical">{t('kb.docList.sortAlphabeticalOption')}</option>
            </select>
          </div>
          {canManage && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
                onChange={handleFileSelect}
                aria-label={t('kb.docList.uploadFileInputAria')}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExtracting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-md transition-colors cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                {isExtracting ? t('kb.docList.readingFile') : t('kb.docList.uploadDocument')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 2. HIGH-DENSITY DOCUMENT DIRECTORY LIST VIEW */}
      <div className="flex-1 min-h-0 bg-white dark:bg-slate-950 flex flex-col">
        {sortedDocs.length === 0 ? (
          <div className="h-full overflow-y-auto px-6 py-4">
            {/* role/aria-live pass through EmptyState's prop spread: this is the
                announcement a screen-reader user gets when a filter empties the
                list, and it has to survive the migration. */}
            <EmptyState
              role="status"
              aria-live="polite"
              icon={ShieldAlert}
              title={t('kb.docList.emptyTitle')}
              description={t('kb.docList.emptyBody')}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setBrandFilter('all');
                    setCategoryFilter('all');
                    setStatusFilter('all');
                  }}
                  className="text-xs font-bold text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300 underline cursor-pointer"
                >
                  {t('kb.docList.clearFilters')}
                </button>
              }
            />
          </div>
        ) : (
          // Virtualized (react-window) instead of mapping every row: only
          // the rows currently scrolled into view are ever mounted, so
          // render cost stays flat whether the library has dozens or
          // thousands of documents (see docs/KNOWN_LIMITATIONS.md's
          // "Chunk-Based Document Loading" hardening item). The server now
          // paginates /api/db/documents too — the "Load more documents"
          // affordance below fetches subsequent pages on demand rather than
          // the client always holding the entire filtered set in memory.
          //
          // Tradeoff: category grouping is now row order/kind rather than
          // nested <div role="group"> wrappers, since react-window renders
          // a flat, absolutely-positioned row sequence. Each row still
          // gets react-window's own aria-posinset/aria-setsize/listitem
          // semantics (see VirtualRow), but a screen reader can no longer
          // query "how many documents in category X" as a DOM group — the
          // count is still visually and textually present in each header
          // row's own content.
          <>
            <div className="flex-1 min-h-0">
              <List
                rowComponent={VirtualRow}
                rowCount={rows.length}
                rowHeight={(index) => (rows[index]?.kind === 'header' ? CATEGORY_HEADER_ROW_HEIGHT : DOC_ROW_HEIGHT)}
                rowProps={{
                  rows,
                  canManage,
                  pendingDeleteId,
                  getBrandDisplayName,
                  onSelectDoc,
                  onDownload: handleDownload,
                  onDeleteStart: setPendingDeleteId,
                  onDeleteConfirm: handleDeleteConfirm,
                  onDeleteCancel: handleDeleteCancel,
                }}
                style={{ height: '100%', width: '100%' }}
                defaultHeight={600}
              />
            </div>
            {hasMore && (
              <div className="flex-shrink-0 flex items-center justify-center py-3 border-t border-slate-100 dark:border-slate-900">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  className="text-xs font-bold text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isLoadingMore ? t('kb.docList.loadingMore') : t('kb.docList.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {pendingUpload && (
        <Modal
          titleId="upload_scope_title"
          title={t('kb.docList.uploadModalTitle')}
          icon={<Upload className="h-4 w-4 text-brand-600 dark:text-brand-400" />}
          onClose={() => setPendingUpload(null)}
          onSubmit={handleConfirmUpload}
          closeAriaLabel={t('kb.docList.cancelUploadAria')}
        >
          <div className="space-y-4 text-xs text-slate-700 dark:text-slate-300">
            <p className="text-slate-500 dark:text-slate-400">
              {t('kb.docList.chooseVisibility', { name: pendingUpload.name })}
            </p>

            {/* Brand scope */}
            <fieldset className="space-y-2">
              <legend className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">{t('kb.docList.brandScopeLegend')}</legend>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="upload_scope" checked={uploadScope === 'brand'} onChange={() => setUploadScope('brand')} className="accent-brand-600" />
                <span>{t('kb.docList.brandOnlyOption')} <span className="font-semibold">({brandDisplayName})</span></span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="upload_scope" checked={uploadScope === 'global'} onChange={() => setUploadScope('global')} className="accent-brand-600" />
                <span>{t('kb.docList.globalVisibilityOption')}</span>
              </label>
            </fieldset>

            {/* Department visibility */}
            <fieldset className="space-y-2">
              <legend className="text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">{t('kb.docList.deptVisibilityLegend')}</legend>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="upload_dept_scope" checked={uploadDeptScope === 'global'} onChange={() => setUploadDeptScope('global')} className="accent-brand-600" />
                <span>{t('kb.docList.allDepartmentsOption')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="upload_dept_scope" checked={uploadDeptScope === 'specific'} onChange={() => setUploadDeptScope('specific')} className="accent-brand-600" />
                <span>{t('kb.docList.specificDepartmentsOption')}</span>
              </label>
              {uploadDeptScope === 'specific' && (
                <div className="ml-6 grid grid-cols-2 gap-1.5 pt-1">
                  {allDepartments.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={uploadDeptIds.includes(d.id)} onChange={() => toggleUploadDept(d.id)} className="accent-brand-600" />
                      <span className="truncate">{d.displayName}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setPendingUpload(null)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {t('kb.docList.cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Upload className="h-3.5 w-3.5" />
              {t('kb.docList.upload')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default DocList;
