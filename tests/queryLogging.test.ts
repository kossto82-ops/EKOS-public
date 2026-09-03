import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, authHeader } from './testApp.ts';
import { db } from '../src/db/db.ts';
import { kbQueriesAudit, kbSearchGaps } from '../src/db/schema.ts';
import { upsertKbDocuments } from '../src/server/sharepoint/ingest.ts';

/**
 * /api/search used to record nothing: kb_queries_audit sat at 0 rows on the
 * real database and kb_search_gaps held only its three seeded examples. The
 * platform therefore had no evidence of its own retrieval performance and no
 * way to build an evaluation set from real traffic — which is what forced the
 * first eval set to be entirely synthetic.
 *
 * No AI provider is configured under test, so these exercise the local-fallback
 * path. That is deliberate: logging must not depend on the LLM being reachable,
 * or the record silently skews toward queries made while the provider was up.
 */

let app: Express;
const ADMIN = authHeader('u1');

beforeAll(() => {
  app = createTestApp();
  // The test database starts with no documents, so without this EVERY query
  // matches nothing and "did match" cannot be distinguished from "did not".
  upsertKbDocuments(
    [
      {
        id: 'log_refund',
        uri: 'file:///drive/log_refund',
        name: 'Refund and Cancellation Policy.md',
        folderPath: '',
        topFolder: '',
        fileType: 'md',
        content: 'Customers may request a refund within 14 days. Cancellation is processed by finance.',
        truncated: false,
        frontmatter: {},
        lastModified: '2026-08-05T00:00:00Z',
      },
    ] as any,
    '2026-08-05T00:00:00Z'
  );
});

const audits = () => db.select().from(kbQueriesAudit).all() as any[];
const gaps = () => db.select().from(kbSearchGaps).all() as any[];

describe('search query logging', () => {
  it('records the query, the retrieval mode and the matched sources', async () => {
    const before = audits().length;
    const res = await request(app).post('/api/search').set(...ADMIN).send({ query: 'refund policy cancellation' });
    expect(res.status).toBe(200);

    const rows = audits();
    expect(rows.length).toBe(before + 1);
    const row = rows[rows.length - 1];
    expect(row.query).toBe('refund policy cancellation');

    // The mode is stored with the sources: a lexical-era row and a hybrid-era
    // row are not comparable, and without this nothing distinguishes them.
    const matched = JSON.parse(row.matchedSources);
    expect(['hybrid', 'lexical']).toContain(matched.retrievalMode);
    expect(Array.isArray(matched.sources)).toBe(true);
  });

  it('files a query that matched nothing as a search gap', async () => {
    const before = gaps().length;
    await request(app).post('/api/search').set(...ADMIN).send({ query: 'zzqqxx nonexistent topic zzqqxx' });

    const rows = gaps();
    expect(rows.length).toBe(before + 1);
    const row = rows[rows.length - 1];
    expect(row.query).toBe('zzqqxx nonexistent topic zzqqxx');
    expect(row.hasResults).toBe(false);
    expect(row.resolved).toBe(false);
  });

  it('does NOT file a gap when documents did match', async () => {
    const before = gaps().length;
    await request(app).post('/api/search').set(...ADMIN).send({ query: 'refund policy cancellation' });
    expect(gaps().length).toBe(before);
  });

  it('rejects an invalid query before writing anything', async () => {
    const beforeAudits = audits().length;
    const beforeGaps = gaps().length;
    await request(app).post('/api/search').set(...ADMIN).send({ query: '   ' });
    expect(audits().length).toBe(beforeAudits);
    expect(gaps().length).toBe(beforeGaps);
  });
});
