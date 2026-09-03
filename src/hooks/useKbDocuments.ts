/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { KBDocument, KBDocumentUpdate } from '../types';
import { INITIAL_KB_DOCS } from '../constants/kb';
import { documentApi } from '../api/documentApi';
import { isDocumentVisible } from '../utils/scoping';

interface UseKbDocumentsArgs {
  brandId: string;
  departmentId: string;
  toast: { success: (msg: string) => void; error: (msg: string) => void };
}

/**
 * Document library state: fetch/sync with the server, brand+department
 * filtering, and the upload/delete/version-bump mutations. Extracted from
 * KnowledgeBaseTab.
 */
export function useKbDocuments({ brandId, departmentId, toast }: UseKbDocumentsArgs) {
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const [documents, setDocuments] = useState<KBDocument[]>(INITIAL_KB_DOCS);
  const [hasMoreDocuments, setHasMoreDocuments] = useState(false);
  const [isLoadingMoreDocuments, setIsLoadingMoreDocuments] = useState(false);
  const nextOffsetRef = useRef<number | null>(null);

  useEffect(() => {
    // Guards against rapid brand switching: if the brand changes again before
    // this request resolves, its (now-stale) response is discarded instead
    // of overwriting whatever the newer request already loaded.
    let isStale = false;
    documentApi.getDocuments(brandId).then(res => {
      if (isStale) return;
      if (res.success && res.data?.documents?.length) {
        setDocuments(res.data.documents);
        setHasMoreDocuments(res.data.hasMore);
        nextOffsetRef.current = res.data.nextOffset;
      }
    }).catch((err) => {
      if (isStale) return;
      console.error('Failed to load documents:', err);
      toast.error('Could not load the document library — showing the last known list. Refresh to retry.');
    });
    return () => { isStale = true; };
  }, [brandId]);

  /**
   * Fetches the next server-side page (see GetDocumentsResponse.nextOffset)
   * and appends any not-already-loaded documents — the endpoint no longer
   * returns the entire table in one response (docs/KNOWN_LIMITATIONS.md's
   * "Chunk-Based Document Loading" item).
   */
  const loadMoreDocuments = useCallback(async () => {
    if (nextOffsetRef.current == null || isLoadingMoreDocuments) return;
    setIsLoadingMoreDocuments(true);
    try {
      const res = await documentApi.getDocuments(brandId, { offset: nextOffsetRef.current });
      if (!isMountedRef.current) return;
      if (res.success && res.data) {
        setDocuments(prev => {
          const seenIds = new Set(prev.map(d => d.id));
          const fresh = res.data.documents.filter(d => !seenIds.has(d.id));
          return [...prev, ...fresh];
        });
        setHasMoreDocuments(res.data.hasMore);
        nextOffsetRef.current = res.data.nextOffset;
      } else {
        toast.error('Could not load more documents. Try again.');
      }
    } catch {
      if (isMountedRef.current) toast.error('Could not load more documents. Try again.');
    } finally {
      if (isMountedRef.current) setIsLoadingMoreDocuments(false);
    }
  }, [brandId, isLoadingMoreDocuments, toast]);

  // NOTE: we deliberately do NOT mirror the document list into localStorage.
  // The server is the source of truth (see the fetch effect above), and the old
  // mirror JSON.stringify'd the entire growing corpus (full markdown content) on
  // every mutation — O(n^2) main-thread work that silently blew the ~5MB quota.
  // (The old localStorage reader, documentRepository, has since been removed.)

  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => isDocumentVisible(doc, brandId, departmentId));
  }, [documents, brandId, departmentId]);

  const handleUploadDoc = useCallback(async (newDoc: KBDocument) => {
    const enriched: KBDocument = {
      ...newDoc,
      owner: newDoc.owner || 'Customer Service Operations',
      department: newDoc.department || 'Operations',
      category: newDoc.category || 'Operations Manual',
      isImportant: newDoc.isImportant || false,
      reviewFrequency: 'Every 90 days',
      expirationDate: '2026-12-31',
      // New uploads are unapproved until a reviewer approves them in the queue.
      approvalStatus: 'Under Review',
      version: '1.0',
      lastReviewDate: new Date().toISOString().split('T')[0],
      viewsCount: 1,
      ratingUp: 0,
      ratingDown: 0,
    };

    setDocuments((prev) => [enriched, ...prev]);

    const response = await documentApi.uploadDocument(enriched);
    if (!isMountedRef.current) return;

    if (!response.success) {
      setDocuments((prev) => prev.filter((d) => d.id !== enriched.id));
      toast.error(`Couldn't save "${enriched.name}": ${response.error?.message || 'the server rejected the upload.'}`);
      return;
    }

    setDocuments((prev) =>
      prev.map((d) => (d.id === enriched.id ? { ...d, status: 'trained' } : d))
    );
    toast.success(`Operational document "${enriched.name}" fully index-grounded in Knowledge Base.`);
  }, []);

  const handleDeleteDoc = useCallback(async (id: string) => {
    const previous = documents.find((d) => d.id === id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    const response = await documentApi.deleteDocument(id);
    if (!isMountedRef.current) return;
    // Don't swallow failures: a rejected delete previously vanished silently
    // from the list while the server kept the row, so it reappeared on the next
    // reload. Roll the row back into view and surface the error instead.
    if (!response.success && previous) {
      setDocuments((prev) => (prev.some((d) => d.id === id) ? prev : [previous, ...prev]));
      toast.error(`Couldn't delete "${previous.name}": ${response.error?.message || 'the server rejected the delete.'}`);
    }
  }, [documents, toast]);

  /**
   * Edits a document's content/metadata (used by the responsible owner or a KB
   * manager from the document drawer). Optimistic: applies the change to local
   * state immediately, then persists via PATCH. On success it merges the
   * AUTHORITATIVE server row — the server may change fields the client didn't
   * send (a content edit bumps version + resets approvalStatus to Under Review),
   * so merging only the local patch would leave the row/drawer showing a stale
   * version and 'Approved' badge. On failure it rolls back and surfaces the
   * error. Resolves to the updated document (for the caller to sync its own
   * selection) or null if the save failed.
   */
  const handleUpdateDoc = useCallback(
    async (id: string, patch: KBDocumentUpdate): Promise<KBDocument | null> => {
      const previous = documents.find((d) => d.id === id);
      // null (clear ownerId/brandId) is valid over the wire; for local display
      // state treat it as absent. Cast because the merge briefly widens types.
      setDocuments((list) => list.map((d) => (d.id === id ? ({ ...d, ...patch } as KBDocument) : d)));

      const response = await documentApi.updateDocument(id, patch);
      if (!isMountedRef.current) return response.success ? (response.data?.document ?? null) : null;

      if (!response.success) {
        if (previous) setDocuments((list) => list.map((d) => (d.id === id ? previous : d)));
        toast.error(`Couldn't save changes to "${previous?.name || id}": ${response.error?.message || 'the server rejected the update.'}`);
        return null;
      }

      const serverDoc = response.data?.document;
      if (serverDoc) {
        setDocuments((list) => list.map((d) => (d.id === id ? ({ ...d, ...serverDoc } as KBDocument) : d)));
      }
      toast.success(`Document "${previous?.name || id}" updated.`);
      return serverDoc ? ({ ...(previous as KBDocument), ...serverDoc }) : ({ ...(previous as KBDocument), ...patch } as KBDocument);
    },
    [documents, toast]
  );

  /**
   * Applies a governance decision (approve / needs-fix / ban) to the documents
   * behind the given names. Resolved SERVER-SIDE by name (via
   * documentApi.setGovernanceDecision), so it works even when the target isn't
   * on the currently-loaded/brand page — the previous by-name-against-in-memory
   * approach silently no-op'd off-page docs. Local state is then reconciled to
   * the server's returned rows (version bump + status), and any name that
   * matched zero documents, or a failed call, surfaces a toast instead of
   * silently diverging.
   */
  const updateDocumentApproval = useCallback(
    async (docNames: Set<string>, decision: 'approved' | 'rejected' | 'banned') => {
      if (docNames.size === 0) return;
      const names = [...docNames];
      const results = await Promise.all(
        names.map((name) => documentApi.setGovernanceDecision(name, decision))
      );
      if (!isMountedRef.current) return;

      const updatedDocs = results.flatMap((r) => (r.success && r.data ? r.data.documents : []));
      if (updatedDocs.length > 0) {
        const byId = new Map(updatedDocs.map((d) => [d.id, d]));
        setDocuments((prev) => prev.map((d) => (byId.has(d.id) ? { ...d, ...byId.get(d.id)! } : d)));
      }

      const failed = results.some((r) => !r.success);
      const totalUpdated = results.reduce((n, r) => n + (r.success && r.data ? r.data.updated : 0), 0);
      if (failed) {
        toast.error(`Couldn't save the ${decision} decision to the server — reload to see the current state.`);
      } else if (totalUpdated === 0) {
        toast.error(`No matching document was found to ${decision}. The task was updated but no document changed.`);
      }
    },
    [toast]
  );

  return {
    documents,
    filteredDocuments,
    handleUploadDoc,
    handleDeleteDoc,
    handleUpdateDoc,
    updateDocumentApproval,
    hasMoreDocuments,
    isLoadingMoreDocuments,
    loadMoreDocuments,
  };
}
