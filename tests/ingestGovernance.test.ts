import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp } from './testApp.ts';
import { db } from '../src/db/db.ts';
import { kbDocuments, kbDocumentChunks } from '../src/db/schema.ts';
import { upsertKbDocuments } from '../src/server/sharepoint/ingest.ts';
import type { RawSharePointDoc } from '../src/constants/kbMapping.ts';

/**
 * S4 regression: a SharePoint re-sync must NEVER reset in-app governance state.
 * The old upsert overwrote the whole row every 6 hours, silently un-banning
 * banned docs and wiping approvalStatus / departmentIds / brandId / version /
 * ratings. These tests lock in that governance decisions survive a re-sync.
 */
beforeAll(() => {
  createTestApp(); // initializes the in-memory test DB schema
});

function rawDoc(id: string, content: string): RawSharePointDoc {
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

describe('upsertKbDocuments — governance preservation on re-sync', () => {
  it('keeps a banned document banned across a re-sync (never silently re-approves)', () => {
    const raw = rawDoc('gov_ban_1', 'Original body.');
    const docId = 'sp_gov_ban_1';

    // Initial sync: inserted as Approved.
    upsertKbDocuments([raw], '2026-07-17T00:00:00Z');
    let row = db.select().from(kbDocuments).where(eq(kbDocuments.id, docId)).all()[0] as any;
    expect(row.approvalStatus).toBe('Approved');

    // Governance bans it and assigns departments + a new version.
    db.update(kbDocuments).set({
      approvalStatus: 'Banned',
      departmentIds: JSON.stringify(['it', 'legal']),
      version: '2.3',
      ratingUp: 5,
    }).where(eq(kbDocuments.id, docId)).run();

    // Re-sync with the SAME content — governance state must be preserved.
    upsertKbDocuments([raw], '2026-07-18T00:00:00Z');
    row = db.select().from(kbDocuments).where(eq(kbDocuments.id, docId)).all()[0] as any;
    expect(row.approvalStatus).toBe('Banned');            // NOT reset to Approved
    expect(JSON.parse(row.departmentIds)).toEqual(['it', 'legal']); // NOT wiped to []
    expect(row.version).toBe('2.3');                       // NOT reset to 1.0
    expect(row.ratingUp).toBe(5);                          // NOT zeroed
  });

  it('drops an approved doc back to Under Review only when the crawled content actually changes', () => {
    const docId = 'sp_gov_change_1';

    upsertKbDocuments([rawDoc('gov_change_1', 'First version.')], '2026-07-17T00:00:00Z');
    // Mark it Approved (as a governance reviewer would).
    db.update(kbDocuments).set({ approvalStatus: 'Approved' }).where(eq(kbDocuments.id, docId)).run();

    // Re-sync unchanged content: status stays Approved.
    upsertKbDocuments([rawDoc('gov_change_1', 'First version.')], '2026-07-18T00:00:00Z');
    let row = db.select().from(kbDocuments).where(eq(kbDocuments.id, docId)).all()[0] as any;
    expect(row.approvalStatus).toBe('Approved');

    // Re-sync with CHANGED content: dropped to Under Review for re-approval.
    upsertKbDocuments([rawDoc('gov_change_1', 'Second, edited version.')], '2026-07-19T00:00:00Z');
    row = db.select().from(kbDocuments).where(eq(kbDocuments.id, docId)).all()[0] as any;
    expect(row.approvalStatus).toBe('Under Review');
    expect(row.content).toContain('Second, edited');
  });

  it('re-syncing changed content does NOT collide with a seed-style chunk that has a NULL documentId', () => {
    const docId = 'sp_collide_1';
    // Initial ingest builds the doc + its chunk/version with all NOT NULL columns.
    upsertKbDocuments([rawDoc('collide_1', 'Original body.')], '2026-07-17T00:00:00Z');
    // Simulate the OLD seed state: chunk/version rows sharing the deterministic
    // ids but with a NULL documentId (which is why a documentId-keyed delete
    // used to miss them and the re-insert collided on the PK).
    // Only the CHUNK table left documentId NULL in the old seed (the version
    // table's document_id is NOT NULL), so that is the collision case.
    const firstChunkId = `ver_${docId}_1_0_c0`;
    db.update(kbDocumentChunks).set({ documentId: null }).where(eq(kbDocumentChunks.id, firstChunkId)).run();

    // Content changed at source -> ingest rebuilds the chunks. Must NOT throw a
    // UNIQUE constraint failure on the surviving NULL-documentId chunk.
    expect(() => upsertKbDocuments([rawDoc('collide_1', 'Edited body v2.')], '2026-07-18T00:00:00Z')).not.toThrow();
    const chunks = db.select().from(kbDocumentChunks).where(eq(kbDocumentChunks.documentId, docId)).all() as any[];
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((c) => c.content).join(' ')).toContain('Edited body');
    // Every rebuilt chunk is re-linked to its document (no NULL stragglers).
    expect(chunks.every((c) => c.documentId === docId)).toBe(true);
  });
});
