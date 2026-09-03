/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI: regenerate the offline SharePoint snapshot from Microsoft Graph.
 *
 *   npm run ingest:sharepoint
 *
 * Requires the SP_* env vars (see .env.example / docs/SHAREPOINT_SYNC.md).
 * Crawls the configured Knowledge Base library and writes
 * src/data/sharepoint-kb-snapshot.json — the file the seed loads on first boot.
 * This is the credentialed equivalent of the connector-based crawl that
 * bootstrapped the committed snapshot.
 */

import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getGraphConfig, crawlKnowledgeBase } from '../src/server/sharepoint/graphClient.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'src', 'data', 'sharepoint-kb-snapshot.json');

async function main() {
  const cfg = getGraphConfig();
  if (!cfg) {
    console.error(
      'SharePoint sync is not configured. Set SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET, ' +
      'SP_DRIVE_ID and SP_ROOT_FOLDER_ID (see docs/SHAREPOINT_SYNC.md), then re-run.'
    );
    process.exit(1);
  }

  console.log(`Crawling SharePoint drive ${cfg.driveId} from folder ${cfg.rootFolderId}...`);
  const crawl = await crawlKnowledgeBase(cfg);
  const documents = crawl.docs;
  const crawledAt = new Date().toISOString().split('T')[0];

  // Report what the crawl could NOT ingest, so a snapshot is never mistaken for
  // a complete library dump.
  console.log(
    `Crawl summary: ${crawl.filesSeen} file(s) seen, ${documents.length} ingested, ` +
    `${crawl.skippedEmpty} skipped (unsupported/empty), ${crawl.failed} failed to extract, ` +
    `${crawl.truncated} truncated${crawl.capped ? ' — SP_MAX_FILES CAP HIT: library not fully traversed' : ''}`
  );

  const snapshot = {
    source: {
      driveId: cfg.driveId,
      rootFolderId: cfg.rootFolderId,
      libraryPath: process.env.SP_LIBRARY_PATH || 'SharePoint Knowledge Base',
      crawledAt,
    },
    documents,
  };

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`Wrote ${documents.length} documents to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
