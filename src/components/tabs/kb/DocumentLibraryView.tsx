/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { KBDocument } from '../../../types';
import { DocList } from './DocList';

interface DocumentLibraryViewProps {
  documents: KBDocument[];
  onUploadDoc: (newDoc: KBDocument) => void;
  onDeleteDoc: (id: string) => void;
  canManageKB: boolean;
  brandId: string;
  brandDisplayName: string;
  setSelectedDoc: (doc: KBDocument | null) => void;
  setIsDrawerOpen: (isOpen: boolean) => void;
  hasMoreDocuments: boolean;
  isLoadingMoreDocuments: boolean;
  onLoadMoreDocuments: () => void;
}

export const DocumentLibraryView: React.FC<DocumentLibraryViewProps> = ({
  documents,
  onUploadDoc,
  onDeleteDoc,
  canManageKB,
  brandId,
  brandDisplayName,
  setSelectedDoc,
  setIsDrawerOpen,
  hasMoreDocuments,
  isLoadingMoreDocuments,
  onLoadMoreDocuments,
}) => {
  return (
    <div className="flex h-full w-full gap-6 overflow-hidden min-h-0">
      <div className="flex-1 h-full overflow-hidden bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-900 rounded-sm flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-900 flex-shrink-0 flex items-center justify-between bg-slate-50/40 dark:bg-slate-900/10">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider font-sans">
              Repository
            </h3>
          </div>
        </div>
        <div className="flex-1 overflow-hidden min-h-0">
          <DocList
            documents={documents}
            onUpload={onUploadDoc}
            onDelete={onDeleteDoc}
            canManage={canManageKB}
            brandId={brandId}
            brandDisplayName={brandDisplayName}
            onSelectDoc={(doc) => {
              setSelectedDoc(doc);
              setIsDrawerOpen(true);
            }}
            hasMore={hasMoreDocuments}
            isLoadingMore={isLoadingMoreDocuments}
            onLoadMore={onLoadMoreDocuments}
          />
        </div>
      </div>
    </div>
  );
};
