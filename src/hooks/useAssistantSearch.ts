/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { KnowledgeAnswer } from '../types/knowledge';
import { SearchTimings } from '../types/apiContracts';
import { searchService } from '../services/searchService';
import { ApiError } from '../services/baseService';
import { governanceService } from '../services/governanceService';

interface UseAssistantSearchArgs {
  activeBrandId: string | undefined;
  activeDepartmentId: string;
  showToast: (message: string) => void;
  t: (path: string) => string;
  /** Active UI locale — forwarded to the backend so the AI answers in it. */
  locale?: string;
}

/**
 * Core search state and handlers for the Assistant tab: the search query,
 * result/error/loading state, API-key-configured check, and helpful/follow-up
 * feedback state. Extracted from AssistantTab.
 */
export function useAssistantSearch({ activeBrandId, activeDepartmentId, showToast, t, locale }: UseAssistantSearchArgs) {
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Tracks the most recently issued search so a slow/retried request that
  // resolves after a newer one can never overwrite the newer result on screen.
  const latestRequestIdRef = useRef(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<KnowledgeAnswer | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  /** True after an empty submit, so the UI can show a visible cue. */
  const [emptyQueryHint, setEmptyQueryHint] = useState(false);
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const [isApiKeyConfigured, setIsApiKeyConfigured] = useState<boolean | null>(null);
  // Tracks whether the currently displayed searchResult came from the real
  // AI backend or from the local keyword-matched fallback, so the UI can
  // warn the user instead of silently presenting simulated content as a
  // verified AI answer (see docs/DECISIONS.md ADR-015 for the incident this closes).
  const [retrievalSource, setRetrievalSource] = useState<'live_ai' | 'local_fallback' | null>(null);

  // Which retrievers actually ran. 'lexical' means semantic search did NOT — no
  // embedding provider, nothing backfilled, or a provider error — so the answer
  // was grounded by term matching alone. The server has always reported this and
  // the client has always discarded it, which made the most consequential
  // degradation this system has the only one the user could not see. On a corpus
  // of paraphrased/cross-lingual questions, lexical-only retrieval finds the
  // right document in ~5% of cases (docs/RAG.md §5.8); presenting that with a
  // confidence score and no caveat is the failure mode, not the low score.
  const [retrievalMode, setRetrievalMode] = useState<'hybrid' | 'lexical' | null>(null);

  // Where the last search's time went. The server has always measured this and
  // the client has always thrown it away, so "the search feels slow" stayed a
  // feeling — nobody could tell a slow model from slow retrieval, two problems
  // with completely different fixes. null until a real server answer arrives:
  // the offline fallback never reached the server and has nothing to report.
  const [timings, setTimings] = useState<SearchTimings | null>(null);

  // UX Feedback States
  const [helpfulState, setHelpfulState] = useState<'none' | 'yes' | 'no'>('none');
  const [followUpQuery, setFollowUpQuery] = useState('');

  useEffect(() => {
    const checkApiKey = async () => {
      try {
        const config = await governanceService.getAiConfig();
        const hasKey = !!(config && config.apiKey && config.apiKey.trim() !== "");
        setIsApiKeyConfigured(hasKey);
      } catch (err) {
        console.error("Failed to check API key configuration:", err);
        setIsApiKeyConfigured(false);
      }
    };
    checkApiKey();
  }, []);

  /**
   * Triggers search utilizing robust state wraps and auto-retries
   */
  const performSearch = useCallback(async (queryToExecute: string) => {
    if (!queryToExecute.trim()) {
      // Submitting an empty box (pressing Enter — the button is disabled, but the
      // form still submits) used to do nothing at all, with no feedback. Surface
      // a hint instead of silently swallowing the interaction.
      setEmptyQueryHint(true);
      return;
    }
    setEmptyQueryHint(false);

    const requestId = ++latestRequestIdRef.current;

    setIsSearching(true);
    setSearchError(null);
    setSearchResult(null);
    setRetrievalSource(null);
    setTimings(null);
    setHelpfulState('none');
    setFollowUpQuery('');

    const state = await searchService.search(queryToExecute, activeBrandId, activeDepartmentId, locale);

    // A newer search was issued while this one was in flight (including
    // retries/backoff) — drop this stale response instead of letting it
    // clobber the newer result already on screen.
    if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

    setIsSearching(false);
    if (state.error) {
      setSearchError(state.error);
      const isMissingKey =
        state.error.message?.includes('Missing Gemini API Key') ||
        state.error.details?.includes('Missing Gemini API Key') ||
        state.error.message?.toLowerCase().includes('api key') ||
        state.error.details?.toLowerCase().includes('api key');
      if (isMissingKey) {
        setIsApiKeyConfigured(false);
      }
    } else if (state.data) {
      setSearchResult(state.data.answer);
      setRetrievalSource(state.data.retrievalSource);
      setRetrievalMode(state.data.retrievalMode ?? null);
      setTimings(state.data.timings ?? null);
      // A local-fallback answer does not prove a real key is configured and
      // working — only a live_ai response does.
      if (state.data.retrievalSource === 'live_ai') {
        setIsApiKeyConfigured(true);
      }
    }
  }, [activeBrandId, activeDepartmentId, locale]);

  // When the active brand/department changes, discard the current answer and
  // drop any in-flight request. An answer scoped to the PREVIOUS brand/dept must
  // never stay on screen — or be overwritten by a late response — under the new
  // context (that would surface another tenant's content and citations). The
  // request-id guard alone doesn't cover this: a context switch issues no new
  // search, so we bump the id here to invalidate anything in flight.
  const contextRef = useRef(`${activeBrandId}|${activeDepartmentId}`);
  useEffect(() => {
    const key = `${activeBrandId}|${activeDepartmentId}`;
    if (contextRef.current === key) return; // initial mount / no real change — keep any preloaded query
    contextRef.current = key;
    latestRequestIdRef.current++;
    setSearchResult(null);
    setSearchError(null);
    setRetrievalSource(null);
    setTimings(null);
    setHelpfulState('none');
    setFollowUpQuery('');
  }, [activeBrandId, activeDepartmentId]);

  useEffect(() => {
    const preloadedQuery = sessionStorage.getItem('preload_copilot_query');
    if (preloadedQuery) {
      setSearchQuery(preloadedQuery);
      sessionStorage.removeItem('preload_copilot_query');
      performSearch(preloadedQuery);
    }
  }, [performSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(searchQuery);
  };

  /**
   * Handles user thumbs feedback click
   */
  const handleFeedbackSubmit = (type: 'yes' | 'no') => {
    setHelpfulState(type);
    showToast(t('assistant.toasts.feedbackSubmitted'));
  };

  /**
   * Prepares and loads follow up question to the main search box above
   */
  const handlePrepareFollowUp = useCallback(() => {
    if (!followUpQuery.trim()) return;
    setSearchQuery(followUpQuery);
    performSearch(followUpQuery);
  }, [followUpQuery, performSearch]);

  return {
    searchQuery,
    setSearchQuery,
    searchResult,
    setSearchResult,
    isSearching,
    searchError,
    setSearchError,
    isApiKeyConfigured,
    retrievalSource,
    retrievalMode,
    timings,
    helpfulState,
    setHelpfulState,
    followUpQuery,
    setFollowUpQuery,
    performSearch,
    handleSearch,
    handleFeedbackSubmit,
    handlePrepareFollowUp,
    emptyQueryHint,
    setEmptyQueryHint,
  };
}
