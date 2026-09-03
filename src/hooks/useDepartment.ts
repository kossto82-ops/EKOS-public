/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useContext } from 'react';
import { DepartmentContext } from '../context/DepartmentContext';

export function useDepartment() {
  const context = useContext(DepartmentContext);
  if (!context) {
    throw new Error('useDepartment must be used within a DepartmentProvider');
  }
  return context;
}
