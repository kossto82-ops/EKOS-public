/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { PortalUser, UserRole, Tab } from '../types';
import { INITIAL_USERS } from '../constants/users';
import { canAccessTab, canPerformGovernanceAction, GovernanceAction } from '../utils/rbac';
import { getAuthMode, type AuthMode } from '../config/envConfig';
import { apiClient } from '../config/apiClient';

interface AuthContextType {
  currentUser: PortalUser;
  allUsers: PortalUser[];
  setCurrentUserById: (id: string) => void;
  setCurrentUser: (id: string) => void;
  updateUserStatus: (id: string, status: 'Active' | 'Away' | 'Inactive') => void;
  updatePortalUser: (id: string, updatedFields: Partial<PortalUser>) => void;
  canViewTab: (tab: Tab) => boolean;
  canAccess: (tab: Tab) => boolean;
  canPerformAction: (action: 'manage_users' | 'upload_kb' | 'manage_rates' | 'view_review_queue') => boolean;
  isAdmin: boolean;
  isTeamLeader: boolean;
  /** 'oauth' (corporate SSO session) or 'legacy' (impersonation). */
  authMode: AuthMode;
  /** End the session. In oauth mode calls /auth/logout; in legacy resets to admin. */
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const authMode = getAuthMode();

  // ---- OAuth (corporate SSO) session state --------------------------------
  // Only meaningful when authMode === 'oauth'. The identity is not simulated:
  // it is hydrated from GET /auth/me, which the backend resolves from the
  // httpOnly session cookie. A 401 there means "not signed in", and apiClient
  // has already redirected the browser to /auth/login by the time we observe it.
  const [oauthUser, setOauthUser] = useState<PortalUser | null>(null);
  const [oauthReady, setOauthReady] = useState<boolean>(authMode !== 'oauth');

  useEffect(() => {
    if (authMode !== 'oauth') return;
    let cancelled = false;
    (async () => {
      const res = await apiClient.get<PortalUser>('/auth/me');
      if (cancelled) return;
      if (res.success && res.data) setOauthUser(res.data);
      setOauthReady(true); // ready either way; a null user renders the sign-in prompt
    })();
    return () => { cancelled = true; };
  }, [authMode]);

  const [allUsers, setAllUsers] = useState<PortalUser[]>(() => {
    try {
      const saved = localStorage.getItem('portal_users');
      if (!saved) return INITIAL_USERS;

      const savedUsers: PortalUser[] = JSON.parse(saved);

      // Merge: structural fields (role, departmentIds, brandIds, permissions) always
      // come from INITIAL_USERS — the source of truth. Only mutable runtime fields
      // (status, lastActive) are carried over from what was saved. This prevents
      // stale localStorage snapshots from permanently locking a user out of
      // departments/brands/permissions added in later versions of the app.
      return INITIAL_USERS.map(sourceUser => {
        const savedMatch = savedUsers.find(s => s.id === sourceUser.id);
        if (!savedMatch) return sourceUser;
        return {
          ...sourceUser,
          status: savedMatch.status ?? sourceUser.status,
          lastActive: savedMatch.lastActive ?? sourceUser.lastActive,
        };
      });
    } catch (e) {
      return INITIAL_USERS;
    }
  });

  const [currentUserId, setCurrentUserId] = useState<string>(() => {
    const resolveInitialId = (): string => {
      try {
        const saved = localStorage.getItem('current_user_id');
        if (saved && INITIAL_USERS.some(u => u.id === saved)) {
          return saved;
        }
      } catch (e) {}
      return INITIAL_USERS[0].id; // default is Raúl García (Administrator)
    };
    const id = resolveInitialId();
    // Set synchronously here (during render, not in a useEffect below) so
    // it's already in localStorage before any child component's own mount
    // effect fires its first API request — child effects run before a
    // parent's on initial mount, so a useEffect here would lose that race
    // and send the first request(s) of every session with no identity.
    try {
      localStorage.setItem('auth_token', id);
    } catch (e) {}
    return id;
  });

  useEffect(() => {
    try {
      localStorage.setItem('portal_users', JSON.stringify(allUsers));
    } catch (e) {}
  }, [allUsers]);

  useEffect(() => {
    try {
      localStorage.setItem('current_user_id', currentUserId);
      // Carries the active user's id as the caller identity on every API
      // request (see src/config/apiClient.ts's Authorization header and
      // src/server/middleware/auth.ts's requireUser). This is what makes
      // server-side RBAC enforcement possible without a real IdP yet.
      // (Also set synchronously above for the very first render — see
      // that comment for why this effect alone isn't sufficient.)
      localStorage.setItem('auth_token', currentUserId);
    } catch (e) {}
  }, [currentUserId]);

  const setCurrentUserById = useCallback((id: string) => {
    if (allUsers.some(u => u.id === id)) {
      // Write the caller identity SYNCHRONOUSLY here, before setCurrentUserId
      // triggers re-render. Child components' refetch effects fire before this
      // parent's own useEffect (which also syncs auth_token), so relying on that
      // effect alone sent the first request(s) after an impersonation switch
      // under the PREVIOUS user's id. Mirrors the synchronous write at mount.
      try { localStorage.setItem('auth_token', id); } catch (e) {}
      setCurrentUserId(id);
    }
  }, [allUsers]);

  const setCurrentUser = setCurrentUserById;

  const updateUserStatus = useCallback((id: string, status: 'Active' | 'Away' | 'Inactive') => {
    setAllUsers(prev => prev.map(u => u.id === id ? { ...u, status } : u));
  }, []);

  const updatePortalUser = useCallback((id: string, updatedFields: Partial<PortalUser>) => {
    setAllUsers(prev => prev.map(u => u.id === id ? { ...u, ...updatedFields } : u));
  }, []);

  const logout = useCallback(() => {
    if (authMode === 'oauth') {
      // Destroy the server-side session, then reload — the fresh /auth/me will
      // 401 and apiClient redirects to /auth/login.
      apiClient.post('/auth/logout').finally(() => {
        if (typeof window !== 'undefined') window.location.reload();
      });
      return;
    }
    // Legacy: return to the default administrator profile.
    setCurrentUserById(INITIAL_USERS[0].id);
  }, [authMode, setCurrentUserById]);

  // In oauth mode the identity comes from the server session, not the simulated
  // roster. `currentUser` is only read once children render (past the sign-in
  // gate below), so it is guaranteed non-null there.
  const currentUser = authMode === 'oauth'
    ? (oauthUser as PortalUser)
    : (allUsers.find(u => u.id === currentUserId) || allUsers[0]);
  const effectiveAllUsers = authMode === 'oauth' ? (oauthUser ? [oauthUser] : []) : allUsers;

  const isAdmin = currentUser?.role === 'Administrator';
  const isTeamLeader = currentUser?.role === 'TeamLeader';

  // SECURITY: canAccess/canPerformAction below exist to hide tabs/actions
  // in the UI for a smooth UX — as of src/server/middleware/auth.ts, the
  // same rbac.ts rules are also enforced server-side on every /api/db/* and
  // AI route, keyed off the `auth_token` id set above. That said, identity
  // itself is still an unsigned id, not a verified token — see the residual
  // risk documented in docs/KNOWN_LIMITATIONS.md. Do not treat a passing
  // check here as proof the server will also allow the request.
  //
  // canAccess / canViewTab rules:
  // - 'settings': Administrator, TeamLeader (TeamLeader gets read-only)
  // - others: all roles
  const canAccess = useCallback((tab: Tab): boolean => {
    return canAccessTab(currentUser?.role, currentUser?.departmentIds || [], tab);
  }, [currentUser]);

  const canViewTab = canAccess;

  const canPerformAction = useCallback((action: GovernanceAction): boolean => {
    return canPerformGovernanceAction(currentUser?.role, currentUser?.departmentIds || [], action);
  }, [currentUser]);

  const value = useMemo(
    () => ({
      currentUser,
      allUsers: effectiveAllUsers,
      setCurrentUserById,
      setCurrentUser,
      updateUserStatus,
      updatePortalUser,
      canViewTab,
      canAccess,
      canPerformAction,
      isAdmin,
      isTeamLeader,
      authMode,
      logout,
    }),
    [currentUser, effectiveAllUsers, setCurrentUserById, setCurrentUser, updateUserStatus, updatePortalUser, canViewTab, canAccess, canPerformAction, isAdmin, isTeamLeader, authMode, logout]
  );

  // OAuth sign-in gate. Legacy mode skips this entirely (oauthReady starts true),
  // so its render path is unchanged. In oauth mode, children never mount until a
  // real identity exists — so no consumer sees an undefined currentUser.
  if (authMode === 'oauth' && (!oauthReady || !oauthUser)) {
    return (
      <div role="status" aria-live="polite" style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: '0.75rem', fontFamily: 'system-ui, sans-serif', color: '#475569',
      }}>
        <span>{oauthReady ? 'Redirecting to sign in…' : 'Signing you in…'}</span>
        {oauthReady && !oauthUser && (
          <a href={`${getApiBaseUrlForLogin()}/auth/login`} style={{ color: '#2563eb', textDecoration: 'underline' }}>
            Continue to sign in
          </a>
        )}
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

/** Base for the login link in the sign-in gate — mirrors apiClient's base. */
function getApiBaseUrlForLogin(): string {
  try {
    // Lazy import avoided; envConfig.getApiBaseUrl is pure. Empty string = same origin.
    return (import.meta as unknown as { env: Record<string, string | undefined> }).env?.VITE_API_URL || '';
  } catch {
    return '';
  }
}
