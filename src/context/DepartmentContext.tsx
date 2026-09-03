/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { Department } from '../types';
import { DEPARTMENTS } from '../constants/departments';
import { AuthContext } from './AuthContext';

interface DepartmentContextType {
  activeDepartment: Department;
  allDepartments: Department[];
  userDepartments: Department[];
  setActiveDepartmentId: (id: string) => void;
}

export const DepartmentContext = createContext<DepartmentContextType | undefined>(undefined);

export const DepartmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useContext(AuthContext);
  const currentUser = auth?.currentUser;

  const [allDepartments] = useState<Department[]>(DEPARTMENTS);
  const [activeDepartmentId, setActiveDepartmentIdState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('active_department_id');
      if (saved && DEPARTMENTS.some(d => d.id === saved)) {
        return saved;
      }
    } catch (e) {}
    return DEPARTMENTS[0].id;
  });

  const setActiveDepartmentId = useCallback((id: string) => {
    setActiveDepartmentIdState(id);
    try {
      localStorage.setItem('active_department_id', id);
    } catch (e) {}
  }, []);

  const activeDepartment = allDepartments.find(d => d.id === activeDepartmentId) || allDepartments[0] || DEPARTMENTS[0];

  // Dynamically compute userDepartments based on current logged in / impersonated user
  const userDepartments = React.useMemo(() => {
    if (!currentUser) return allDepartments;
    const hasWildcard = currentUser.departmentIds && currentUser.departmentIds.includes('*');
    if (hasWildcard) return allDepartments;
    
    return allDepartments.filter(d => currentUser.departmentIds && currentUser.departmentIds.includes(d.id));
  }, [allDepartments, currentUser]);

  // Safeguard: if activeDepartment is not in userDepartments (e.g. when changing impersonated operators),
  // automatically update activeDepartment to the first allowed user department. Persist the
  // correction (via setActiveDepartmentId) so a stored id the current user can't access isn't
  // re-read on every reload and re-trigger a one-frame wrong-department flash. Note activeDepartment
  // is UI scope only and never feeds rbac.ts's isIT, so this is a UX fix, not a security one.
  useEffect(() => {
    if (userDepartments.length > 0 && !userDepartments.some(d => d.id === activeDepartmentId)) {
      setActiveDepartmentId(userDepartments[0].id);
    }
  }, [userDepartments, activeDepartmentId, setActiveDepartmentId]);

  const value = useMemo(
    () => ({ activeDepartment, allDepartments, userDepartments, setActiveDepartmentId }),
    [activeDepartment, allDepartments, userDepartments, setActiveDepartmentId]
  );

  return (
    <DepartmentContext.Provider value={value}>
      {children}
    </DepartmentContext.Provider>
  );
};
