/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { UserRole } from '../../types';
import { ShieldAlert } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

interface RoleGateProps {
  roles: UserRole[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const AccessDenied: React.FC<{ roles?: string[] }> = ({ roles }) => {
  const { t } = useLocale();
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center select-none" id="access_denied_layout">
      <div className="max-w-md w-full border border-red-900/40 bg-red-950/30 rounded-xl p-8 backdrop-blur-xs shadow-2xl">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-red-950/60 rounded-full text-red-500 border border-red-900/50">
            <ShieldAlert className="h-8 w-8 motion-safe:animate-pulse" />
          </div>
        </div>
        <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider font-mono mb-2">{t('access.securityBreach')}</h3>
        <h2 className="text-xl font-bold font-serif text-white tracking-tight mb-2">{t('access.accessRestricted')}</h2>
        <p className="text-xs text-red-300/80 leading-relaxed font-sans mb-4">
          {t('access.deniedBody')}
        </p>
        <div className="text-3xs text-red-400/60 font-mono">
          {t('access.requiredRoles')}: {roles?.map(r => r.toUpperCase()).join(' | ') || 'ADMIN'}
        </div>
      </div>
    </div>
  );
};

// SECURITY: this only hides children in the UI for the simulated current
// user — it enforces nothing server-side. A caller can still perform the
// gated action directly against the API regardless of role. See the "Open
// critical finding" callout in docs/KNOWN_LIMITATIONS.md.
export const RoleGate: React.FC<RoleGateProps> = ({ roles, fallback, children }) => {
  const auth = useContext(AuthContext);
  // Fail closed: with no auth context, hide the gated children (render the
  // fallback or nothing) rather than exposing them. Enforcement is still
  // server-side; this is defense-in-depth for the UI layer.
  if (!auth) return <>{fallback ?? null}</>;
  const { currentUser } = auth;
  const isAuthorized = roles.includes(currentUser.role);

  if (!isAuthorized) {
    return <>{fallback || <AccessDenied roles={roles.map(String)} />}</>;
  }

  return <>{children}</>;
};

export default RoleGate;
