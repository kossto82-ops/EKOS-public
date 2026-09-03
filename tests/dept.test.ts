import { describe, it, expect } from 'vitest';
import { isDocumentVisible, isVisibleToDepartment } from '../src/utils/scoping';

/**
 * Exercises the real scoping logic in src/utils/scoping.ts — the same
 * functions useKbDocuments.ts's filteredDocuments and
 * KnowledgeSourcesView.tsx's filteredSources call — so a regression in the
 * actual production rules fails this suite instead of silently drifting
 * from a hand-copied replica.
 */
interface DocLike {
  id: string;
  scope: 'global' | 'brand';
  brandId?: string;
  departmentScope: 'global' | 'specific';
  departmentIds?: string[];
}

describe('Document scoping — isDocumentVisible (useKbDocuments.ts)', () => {
  const docs: DocLike[] = [
    { id: 'global-global', scope: 'global', departmentScope: 'global' },
    {
      id: 'brand-Northwind ES-cs',
      scope: 'brand',
      brandId: 'northwind_es',
      departmentScope: 'specific',
      departmentIds: ['customer_service'],
    },
    { id: 'global-hr-admin', scope: 'global', departmentScope: 'specific', departmentIds: ['human_resources', 'administration'] },
  ];

  const filterDocuments = (brandId: string, departmentId: string) =>
    docs.filter((doc) => isDocumentVisible(doc, brandId, departmentId));

  it('a fully global doc is visible under any brand/department combination', () => {
    expect(filterDocuments('northwind_de', 'it').map((d) => d.id)).toContain('global-global');
    expect(filterDocuments('northwind_es', 'customer_service').map((d) => d.id)).toContain('global-global');
  });

  it('a brand-scoped doc is only visible under its own brand', () => {
    const matching = filterDocuments('northwind_es', 'customer_service');
    expect(matching.map((d) => d.id)).toContain('brand-Northwind ES-cs');

    const nonMatching = filterDocuments('northwind_de', 'customer_service');
    expect(nonMatching.map((d) => d.id)).not.toContain('brand-Northwind ES-cs');
  });

  it('a brand-scoped doc still requires its department to match even under the right brand', () => {
    const wrongDept = filterDocuments('northwind_es', 'it');
    expect(wrongDept.map((d) => d.id)).not.toContain('brand-Northwind ES-cs');
  });

  it('a global-scope, department-specific doc is hidden from departments not in its list', () => {
    const cs = filterDocuments('any_brand', 'customer_service');
    expect(cs.map((d) => d.id)).not.toContain('global-hr-admin');

    const hr = filterDocuments('any_brand', 'human_resources');
    expect(hr.map((d) => d.id)).toContain('global-hr-admin');
  });
});

interface SourceLike {
  id: string;
  departmentScope: 'global' | 'specific';
  departmentIds?: string[];
}

describe('Source scoping — isVisibleToDepartment (KnowledgeSourcesView.tsx)', () => {
  it('a global-scope source is visible to every department', () => {
    const source: SourceLike = { id: 'shared-drive', departmentScope: 'global' };
    expect(isVisibleToDepartment(source, 'call_center')).toBe(true);
    expect(isVisibleToDepartment(source, 'legal')).toBe(true);
  });

  it('a department-specific source is hidden unless the active department is authorized', () => {
    const source: SourceLike = { id: 'it-sharepoint', departmentScope: 'specific', departmentIds: ['it'] };
    expect(isVisibleToDepartment(source, 'it')).toBe(true);
    expect(isVisibleToDepartment(source, 'customer_service')).toBe(false);
  });
});
