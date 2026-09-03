/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface DepartmentScopeable {
  departmentScope?: 'global' | 'specific';
  departmentIds?: string[];
}

interface BrandAndDepartmentScopeable extends DepartmentScopeable {
  scope?: 'global' | 'brand';
  brandId?: string;
}

/**
 * Single source of truth for the brand+department visibility rule applied
 * to KB documents, used by useKbDocuments.ts's `filteredDocuments` and
 * directly exercised by tests/dept.test.ts.
 */
export function isDocumentVisible(
  doc: BrandAndDepartmentScopeable,
  brandId: string,
  departmentId: string
): boolean {
  const brandMatch = doc.scope === 'global' || doc.brandId === brandId;
  const deptMatch = isVisibleToDepartment(doc, departmentId);
  return brandMatch && deptMatch;
}

/**
 * Single source of truth for the department-scope guard applied to
 * knowledge sources, used by KnowledgeSourcesView.tsx's `filteredSources`
 * and directly exercised by tests/dept.test.ts.
 */
export function isVisibleToDepartment(scopeable: DepartmentScopeable, departmentId: string): boolean {
  if (scopeable.departmentScope === 'specific' && !(scopeable.departmentIds || []).includes(departmentId)) {
    return false;
  }
  return true;
}
