import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp } from './testApp.ts';
import { db } from '../src/db/db.ts';
import { kbDocuments } from '../src/db/schema.ts';
import { upsertKbDocuments } from '../src/server/sharepoint/ingest.ts';
import type { RawSharePointDoc } from '../src/constants/kbMapping.ts';

/**
 * The SharePoint index can return one file twice — once under its real name and
 * once under the Windows 8.3 short name (the shipped snapshot held
 * TOTP_C~1.MD alongside TOTP_Configuration_Audelia.md, byte-identical apart
 * from a trailing newline). Each carries its own item id, so both became
 * independent kb_documents rows: search ranked both, and deleting one left the
 * other answering identically — indistinguishable, to the user, from a delete
 * that did not stick.
 *
 * These tests pin the two halves of the fix: the twin is not ingested, AND an
 * already-ingested twin is tombstoned by the next complete crawl. The negative
 * cases matter just as much — dedup must never merge two documents that differ.
 */
beforeAll(() => {
  createTestApp(); // initializes the in-memory test DB schema
});

function rawDoc(id: string, name: string, content: string): RawSharePointDoc {
  return {
    id,
    uri: `file:///drive/${id}`,
    name,
    folderPath: '',
    topFolder: '',
    fileType: 'md',
    content,
    truncated: false,
    frontmatter: {},
    lastModified: '2026-08-07T00:00:00Z',
  } as RawSharePointDoc;
}

const row = (id: string) => db.select().from(kbDocuments).where(eq(kbDocuments.id, id)).all()[0] as any;

const BODY = '# TOTP Configuration\n\n## Purpose\nDefine how to configure TOTP.\n';

describe('upsertKbDocuments — duplicate content', () => {
  it('ingests one row when the same file is crawled under an 8.3 short name and its real name', () => {
    const result = upsertKbDocuments([
      rawDoc('dup_short', 'TOTP_C~1.MD', BODY),
      rawDoc('dup_long', 'TOTP_Configuration_Audelia.md', `${BODY}\n`),
    ], '2026-08-07T00:00:00Z');

    expect(result.skippedDuplicate).toBe(1);
    expect(result.total).toBe(1);
    // The real name wins; the 8.3-mangled twin is never written.
    expect(row('sp_dup_long')).toBeTruthy();
    expect(row('sp_dup_short')).toBeUndefined();
  });

  it('picks the same winner regardless of crawl order', () => {
    upsertKbDocuments([
      rawDoc('dup_order_long', 'Password_Reset_Procedure.md', BODY),
      rawDoc('dup_order_short', 'PASSWO~1.MD', BODY),
    ], '2026-08-07T00:00:00Z');
    expect(row('sp_dup_order_long')).toBeTruthy();
    expect(row('sp_dup_order_short')).toBeUndefined();

    // Reversed input, same outcome — the winner comes from the name, not from
    // whichever entry the index happened to return first.
    upsertKbDocuments([
      rawDoc('dup_order2_short', 'BILLIN~1.MD', 'Billing escalation body.'),
      rawDoc('dup_order2_long', 'Billing_Escalation.md', 'Billing escalation body.'),
    ], '2026-08-07T00:00:00Z');
    expect(row('sp_dup_order2_long')).toBeTruthy();
    expect(row('sp_dup_order2_short')).toBeUndefined();
  });

  it('prefers the more descriptive name when neither is 8.3-mangled', () => {
    upsertKbDocuments([
      rawDoc('dup_desc_a', 'Tool.md', 'Shared tool description.'),
      rawDoc('dup_desc_b', 'Tool_Directory_Transformer.md', 'Shared tool description.'),
    ], '2026-08-07T00:00:00Z');
    expect(row('sp_dup_desc_b')).toBeTruthy();
    expect(row('sp_dup_desc_a')).toBeUndefined();
  });

  it('tombstones a twin already in the KB on the next complete crawl', () => {
    // Ingested before dedup existed: both rows live.
    upsertKbDocuments([rawDoc('legacy_short', 'LEGACY~1.MD', 'Legacy body.')], '2026-08-06T00:00:00Z');
    upsertKbDocuments([rawDoc('legacy_long', 'Legacy_Procedure.md', 'Legacy body 2.')], '2026-08-06T00:00:00Z');
    expect(row('sp_legacy_short').deletedAt).toBeFalsy();

    // A later complete crawl returns them with identical content: the twin is
    // skipped, so reconciliation soft-deletes it out of the live KB.
    upsertKbDocuments([
      rawDoc('legacy_short', 'LEGACY~1.MD', 'Legacy body.'),
      rawDoc('legacy_long', 'Legacy_Procedure.md', 'Legacy body.'),
    ], '2026-08-07T00:00:00Z', { tombstoneMissing: true });

    expect(row('sp_legacy_short').deletedAt).toBeTruthy();
    expect(row('sp_legacy_long').deletedAt).toBeFalsy();
  });

  it('never merges two documents whose content differs', () => {
    // Same title and topic, different text (two real SOP revisions by different
    // authors) — both must survive. Dedup is exact, not fuzzy, precisely so
    // that it cannot destroy content.
    const result = upsertKbDocuments([
      rawDoc('near_a', 'Tool_Employee.md', '# Employee Directory Transformer\n\nVersion 1.0 text.'),
      rawDoc('near_b', 'Tool_Employee_Directory_Transformer.md', '# Employee Directory Transformer\n\nVersion 3.1 text.'),
    ], '2026-08-07T00:00:00Z');

    expect(result.skippedDuplicate).toBe(0);
    expect(row('sp_near_a')).toBeTruthy();
    expect(row('sp_near_b')).toBeTruthy();
  });

  it('reports zero duplicates for an ordinary crawl', () => {
    const result = upsertKbDocuments([
      rawDoc('plain_a', 'A.md', 'Body A.'),
      rawDoc('plain_b', 'B.md', 'Body B.'),
    ], '2026-08-07T00:00:00Z');
    expect(result.skippedDuplicate).toBe(0);
    expect(result.total).toBe(2);
  });
});
