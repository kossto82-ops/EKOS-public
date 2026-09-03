/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { Brand } from '../types';
import { BRANDS } from '../constants/brands';
import { AuthContext } from './AuthContext';
import { apiClient } from '../config/apiClient';

interface BrandContextType {
  activeBrand: Brand;
  allBrands: Brand[];
  userBrands: Brand[];
  setActiveBrandId: (id: string) => void;
  /** Persist a partial brand update to the DB (PATCH /api/db/brands/:id) and
   *  reconcile local state with the server's returned record. Throws on failure
   *  so callers can surface a real error instead of a fake success. */
  updateBrand: (id: string, patch: Partial<Brand>) => Promise<Brand>;
}

export const BrandContext = createContext<BrandContextType | undefined>(undefined);

export const BrandProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useContext(AuthContext);
  const currentUser = auth?.currentUser;

  const [allBrands, setAllBrands] = useState<Brand[]>(BRANDS);
  const [activeBrandId, setActiveBrandIdState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('active_brand_id');
      if (saved && BRANDS.some(b => b.id === saved)) {
        return saved;
      }
    } catch (e) {}
    return BRANDS[0].id;
  });

  useEffect(() => {
    let isMounted = true;
    const fetchBrands = async () => {
      try {
        const json = await apiClient.get<Brand[]>('/api/db/brands');
        if (json && json.success && Array.isArray(json.data) && json.data.length > 0) {
          if (isMounted) {
            setAllBrands(json.data);
          }
        }
      } catch (err) {
        console.error('Failed to load brands from DB, using static fallback:', err);
      }
    };
    fetchBrands();
    return () => {
      isMounted = false;
    };
  }, []);

  const setActiveBrandId = useCallback((id: string) => {
    setActiveBrandIdState(id);
    try {
      localStorage.setItem('active_brand_id', id);
    } catch (e) {}
  }, []);

  const updateBrand = useCallback(async (id: string, patch: Partial<Brand>): Promise<Brand> => {
    const res = await apiClient.patch<Brand>(`/api/db/brands/${id}`, patch);
    if (!res.success || !res.data) {
      const msg = typeof res.error === 'string' ? res.error : res.error?.message;
      throw new Error(msg || 'Failed to update brand');
    }
    const updated = res.data;
    setAllBrands(prev => prev.map(b => (b.id === id ? updated : b)));
    return updated;
  }, []);

  const activeBrand = allBrands.find(b => b.id === activeBrandId) || allBrands[0] || BRANDS[0];

  // Dynamically compute userBrands based on current logged in / impersonated user
  const userBrands = React.useMemo(() => {
    if (!currentUser) return allBrands;
    const hasWildcard = currentUser.brandIds.includes('*');
    if (hasWildcard) return allBrands;
    
    return allBrands.filter(b => currentUser.brandIds.includes(b.id));
  }, [allBrands, currentUser]);

  // Safeguard: if activeBrand is not in userBrands (e.g. when changing impersonated operators),
  // automatically update activeBrand to the first allowed user brand. Persist the
  // correction (via setActiveBrandId, not the bare state setter) so a stored id the
  // current user can't access isn't re-read on every reload and re-trigger a
  // one-frame wrong-brand flash.
  useEffect(() => {
    if (userBrands.length > 0 && !userBrands.some(b => b.id === activeBrandId)) {
      setActiveBrandId(userBrands[0].id);
    }
  }, [userBrands, activeBrandId, setActiveBrandId]);

  const value = useMemo(
    () => ({ activeBrand, allBrands, userBrands, setActiveBrandId, updateBrand }),
    [activeBrand, allBrands, userBrands, setActiveBrandId, updateBrand]
  );

  return (
    <BrandContext.Provider value={value}>
      {children}
    </BrandContext.Provider>
  );
};
