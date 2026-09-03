/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared grounding/retrieval predicates used by EVERY path that can surface a
 * document to the model or the user (/api/search, /api/kb-chat,
 * /api/copilot-draft). Kept in one pure module so the three paths cannot drift
 * apart — previously each inlined a slightly different `status` check, so the
 * same document was searchable on one route and invisible on another.
 */

/**
 * A document may be GROUNDED ON only if it is not soft-deleted, not banned, not
 * an unpublished draft, and not expired. This is a denylist (Approved + Under
 * Review both allowed) rather than an Approved-only allowlist, because the
 * seeded corpus is ~65% "Under Review" and an allowlist would empty retrieval.
 */
export function isGroundableDoc(doc: any): boolean {
  const status = doc?.approvalStatus;
  if (doc?.deletedAt) return false;
  if (status === 'Banned' || status === 'Draft') return false;
  if (doc?.expirationDate && new Date(doc.expirationDate) < new Date()) return false;
  return true;
}

/**
 * A document is RETRIEVABLE (a valid search/grounding candidate) when it carries
 * usable content AND passes the groundability gate. "Usable content" means the
 * ingestion finished (`status === 'trained'`) OR the row simply has non-empty
 * `content` — a doc left in `status: 'pending'` that nonetheless has real text
 * is still answerable, and must not be silently excluded from /api/search while
 * remaining visible to /api/kb-chat. `status` is the ingestion state, not the
 * governance state (that's `approvalStatus`, handled by isGroundableDoc).
 */
export function isRetrievableDoc(doc: any): boolean {
  const hasContent = doc?.status === 'trained' || (typeof doc?.content === 'string' && doc.content.trim() !== '');
  return hasContent && isGroundableDoc(doc);
}

/**
 * Is this document within the CALLER's own brand/department scope, and within
 * any narrowing the request asked for? Mirrors GET /api/db/documents: a caller
 * sees global-scope docs plus brand/department-specific docs intersecting their
 * own brandIds/departmentIds ('*' = unrestricted). The requested
 * brandId/departmentId can only NARROW the allowed set, never widen it.
 *
 * Pure so the grounding routes and the tests share one implementation.
 */
export function isDocVisibleToCaller(
  doc: any,
  user: { brandIds?: string[]; departmentIds?: string[] } | undefined,
  opts: { brandId?: string; departmentId?: string } = {}
): boolean {
  const userBrands = user?.brandIds || [];
  const userDepts = user?.departmentIds || [];
  const brandUnrestricted = userBrands.includes('*');
  const deptUnrestricted = userDepts.includes('*');

  const brandAllowed = brandUnrestricted || doc?.scope === 'global' || (!!doc?.brandId && userBrands.includes(doc.brandId));
  const deptAllowed = deptUnrestricted || doc?.departmentScope === 'global' ||
    (doc?.departmentIds || []).some((id: string) => userDepts.includes(id));
  if (!brandAllowed || !deptAllowed) return false;

  if (opts.brandId && !(doc?.scope === 'global' || doc?.brandId === opts.brandId)) return false;
  if (opts.departmentId && !(doc?.departmentScope === 'global' || (doc?.departmentIds || []).includes(opts.departmentId))) return false;

  return true;
}
