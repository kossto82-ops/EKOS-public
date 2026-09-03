/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Merge the per-document crawl files in src/data/raw-routingmgr/*.json into a
 * single snapshot (src/data/routingmgr-kb-snapshot.json) in the same shape as
 * the SharePoint snapshot, so it feeds the identical mapping in
 * src/constants/kbMapping.ts.
 *
 *   node scripts/merge-routingmgr.js
 */

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'src', 'data', 'raw-routingmgr');
const OUT = path.join(__dirname, '..', 'src', 'data', 'routingmgr-kb-snapshot.json');
const MANIFEST = path.join(__dirname, '..', 'src', 'data', 'routingmgr-manifest.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
const expected = manifest.documents.length;

const docs = [];
const seen = new Set();
for (const fn of fs.readdirSync(RAW_DIR)) {
  if (!fn.endsWith('.json')) continue;
  const d = JSON.parse(fs.readFileSync(path.join(RAW_DIR, fn), 'utf-8'));
  if (seen.has(d.id)) continue;
  seen.add(d.id);
  docs.push(d);
}
docs.sort((a, b) => ((a.topFolder || '') + a.name).localeCompare((b.topFolder || '') + b.name));

const snapshot = {
  source: {
    driveId: 'routingmgr',
    rootFolderId: 'kb-knowledge',
    libraryPath: 'Routing Manager KB (routingmgr.northwind.internal)',
    crawledAt: '2026-07-20',
  },
  documents: docs,
};

fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2), 'utf-8');
const empty = docs.filter((d) => !(d.content || '').trim()).length;
console.log(`Merged ${docs.length}/${expected} routingmgr docs → ${OUT}`);
console.log(`  empty-content: ${empty} | truncated: ${docs.filter((d) => d.truncated).length}`);
const missing = manifest.documents.filter((m) => !seen.has('rm_' + m.slug)).map((m) => m.slug);
if (missing.length) console.log(`  MISSING (${missing.length}): ${missing.join(', ')}`);
