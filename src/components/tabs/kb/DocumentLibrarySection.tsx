import React from 'react';
import { DocumentLibraryView } from './DocumentLibraryView';
import { DocumentMetricsView } from './DocumentMetricsView';
import { KBDocument } from '../../../types';

interface DocumentLibrarySectionProps {
  activeSubTab: 'library' | 'metrics';
  filteredDocuments: KBDocument[];
  onUploadDoc: (newDoc: KBDocument) => void;
  onDeleteDoc: (id: string) => void;
  canManageKB: boolean;
  brandId: string;
  brandDisplayName: string;
  setSelectedDoc: (doc: KBDocument | null) => void;
  setIsDrawerOpen: (open: boolean) => void;
  searchGaps: any[];
  handleResolveGap: (gapId: string, queryText: string) => void;
  hasMoreDocuments: boolean;
  isLoadingMoreDocuments: boolean;
  onLoadMoreDocuments: () => void;
}

export const DocumentLibrarySection: React.FC<DocumentLibrarySectionProps> = (props) => {
  const {
    activeSubTab,
    filteredDocuments,
    onUploadDoc,
    onDeleteDoc,
    canManageKB,
    brandId,
    brandDisplayName,
    setSelectedDoc,
    setIsDrawerOpen,
    searchGaps,
    handleResolveGap,
    hasMoreDocuments,
    isLoadingMoreDocuments,
    onLoadMoreDocuments,
  } = props;

  return (
    <>
      {activeSubTab === 'library' && (
        <div id="kb_panel_library" role="tabpanel" aria-labelledby="kb_subtab_library" className="h-full min-h-0">
          <DocumentLibraryView
            documents={filteredDocuments}
            onUploadDoc={onUploadDoc}
            onDeleteDoc={onDeleteDoc}
            canManageKB={canManageKB}
            brandId={brandId}
            brandDisplayName={brandDisplayName}
            setSelectedDoc={setSelectedDoc}
            setIsDrawerOpen={setIsDrawerOpen}
            hasMoreDocuments={hasMoreDocuments}
            isLoadingMoreDocuments={isLoadingMoreDocuments}
            onLoadMoreDocuments={onLoadMoreDocuments}
          />
        </div>
      )}

      {activeSubTab === 'metrics' && (
        <div id="kb_panel_metrics" role="tabpanel" aria-labelledby="kb_subtab_metrics" className="h-full min-h-0">
          <DocumentMetricsView
            documents={filteredDocuments}
            searchGaps={searchGaps}
            handleResolveGap={handleResolveGap}
          />
        </div>
      )}
    </>
  );
};
