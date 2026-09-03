import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp } from './testApp.ts';
import { db } from '../src/db/db.ts';
import { kbDocuments } from '../src/db/schema.ts';
import { upsertKbDocuments } from '../src/server/sharepoint/ingest.ts';
import type { RawSharePointDoc } from '../src/constants/kbMapping.ts';

/**
 * Tier-3 backlog: reconciliation of documents deleted/archived in SharePoint.
 * A crawl only ever adds or updates what it finds, so a removed file used to
 * linger in the KB and keep grounding answers forever. upsertKbDocuments can now
 * tombstone (soft-delete) sync-owned documents the crawl no longer returns.
 *
 * These tests exist mainly as a SAFETY net: tombstoning deletes data, so the
 * opt-in guard, the id-prefix scoping and the "leave everything else alone"
 * behaviour all have to hold.
 */
beforeAll(() => {
  createTestApp(); // initializes the in-memory test DB schema
});

// Default body is id-derived on purpose: two crawled files with byte-identical
// content are now treated as one document (see ingestDedupe.test.ts), so shared
// fixture text would silently drop half of these fixtures.
function rawDoc(id: string, content = `Body text for ${id}.`): RawSharePointDoc {
  return {
    id,
    uri: `file:///drive/${id}`,
    name: `${id}.md`,
    folderPath: '',
    topFolder: '',
    fileType: 'md',
    content,
    truncated: false,
    frontmatter: {},
    lastModified: '2026-07-17T00:00:00Z',
  } as RawSharePointDoc;
}

const row = (id: string) => db.select().from(kbDocuments).where(eq(kbDocuments.id, id)).all()[0] as any;

describe('upsertKbDocuments — tombstoneMissing', () => {
  it('is OFF by default: a document missing from the crawl survives', () => {
    upsertKbDocuments([rawDoc('tomb_default_a'), rawDoc('tomb_default_b')], '2026-07-17T00:00:00Z');
    expect(row('sp_tomb_default_a').deletedAt).toBeFalsy();

    // Re-sync WITHOUT the first document and without opting in.
    upsertKbDocuments([rawDoc('tomb_default_b')], '2026-07-18T00:00:00Z');
    expect(row('sp_tomb_default_a').deletedAt).toBeFalsy();
  });

  it('tombstones a sync-owned document the crawl no longer returns', () => {
    upsertKbDocuments([rawDoc('tomb_gone'), rawDoc('tomb_stays')], '2026-07-17T00:00:00Z');
    expect(row('sp_tomb_gone').deletedAt).toBeFalsy();

    const result = upsertKbDocuments([rawDoc('tomb_stays')], '2026-07-18T00:00:00Z', { tombstoneMissing: true });

    expect(result.tombstoned).toBeGreaterThanOrEqual(1);
    // Removed in SharePoint -> soft-deleted here (row retained, not hard-deleted).
    const gone = row('sp_tomb_gone');
    expect(gone).toBeTruthy();
    expect(gone.deletedAt).toBeTruthy();
    // Still present in the crawl -> untouched.
    expect(row('sp_tomb_stays').deletedAt).toBeFalsy();
  });

  it('never tombstones documents that are not sync-owned (in-app uploads, other snapshots)', () => {
    const now = new Date().toISOString();
    // An in-app upload (kb_ prefix) and the Routing Manager snapshot (rm_ prefix).
    for (const id of ['kb_manual_upload_x', 'rm_other_snapshot_x']) {
      db.insert(kbDocuments).values({
        id, name: `${id}.md`, type: 'md', status: 'trained', scope: 'global',
        content: 'Not from the SharePoint crawl.', uploadedAt: now, uploadedBy: 'tester',
        departmentScope: 'global', departmentIds: '[]', approvalStatus: 'Approved',
        tenantId: 'tenant_default', createdAt: now, updatedAt: now,
      } as any).run();
    }

    // A crawl that returns nothing at all, with tombstoning ON.
    upsertKbDocuments([], '2026-07-19T00:00:00Z', { tombstoneMissing: true });

    expect(row('kb_manual_upload_x').deletedAt).toBeFalsy();
    expect(row('rm_other_snapshot_x').deletedAt).toBeFalsy();
  });

  it('does not re-tombstone an already soft-deleted document (idempotent count)', () => {
    upsertKbDocuments([rawDoc('tomb_twice')], '2026-07-17T00:00:00Z');
    const first = upsertKbDocuments([], '2026-07-18T00:00:00Z', { tombstoneMissing: true });
    expect(first.tombstoned).toBeGreaterThanOrEqual(1);
    const firstDeletedAt = row('sp_tomb_twice').deletedAt;

    const second = upsertKbDocuments([], '2026-07-19T00:00:00Z', { tombstoneMissing: true });
    // Nothing left to tombstone, and the original timestamp is not rewritten.
    expect(second.tombstoned).toBe(0);
    expect(row('sp_tomb_twice').deletedAt).toBe(firstDeletedAt);
  });

  it('reports documents skipped for having an empty body', () => {
    const result = upsertKbDocuments([rawDoc('tomb_empty', '   '), rawDoc('tomb_real', 'Real content.')], '2026-07-20T00:00:00Z');
    expect(result.skippedEmpty).toBe(1);
    expect(result.total).toBe(1);
  });
});
