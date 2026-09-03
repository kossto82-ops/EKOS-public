/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Microsoft Graph client for the live SharePoint Knowledge Base sync.
 *
 * This is the "enterprise" path: the server authenticates to Microsoft Graph
 * with its own app-registration credentials (OAuth2 client-credentials flow)
 * and crawls the SharePoint document library directly — no interactive user
 * session required. It stays DORMANT until the SP_* env vars are set, so the
 * app runs today on the ingested snapshot (see src/data/sharepoint-kb-snapshot.json)
 * and can be flipped to live sync later by pasting Azure AD credentials.
 *
 * Required env vars (see .env.example):
 *   SP_TENANT_ID       Azure AD tenant id (GUID or domain)
 *   SP_CLIENT_ID       App registration (client) id
 *   SP_CLIENT_SECRET   App registration client secret
 *   SP_DRIVE_ID        Target SharePoint drive id
 *   SP_ROOT_FOLDER_ID  Item id of the "Knowledge Base" root folder to crawl
 * Optional:
 *   SP_EXCLUDE_FOLDERS Comma-separated folder names to skip (default "99 - Archive")
 *
 * The app registration needs the application permission Sites.Read.All (or
 * Files.Read.All), admin-consented.
 *
 * No new npm dependency is required: token acquisition and Graph calls use the
 * global fetch, and .docx text extraction reuses the already-present `mammoth`.
 */

import mammoth from 'mammoth';
import type { RawSharePointDoc } from '../../constants/kbMapping.ts';
import { logger } from '../logger.ts';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MAX_CONTENT_CHARS = 60_000;
// Every outbound Graph/Azure call is bounded so a hung/throttled endpoint can't
// stall the sync request indefinitely (matches the withTimeout invariant the AI
// provider client enforces in src/server/aiClient.ts).
const GRAPH_TIMEOUT_MS = 30_000;
/**
 * Hard ceiling on files ingested in one crawl. An unbounded walk over a library
 * that grew (or a mis-pointed root folder) would download every file in it in a
 * single request — unbounded time, memory and Graph quota. Override with
 * SP_MAX_FILES. When the cap is hit the crawl stops and reports `capped: true`,
 * which callers MUST treat as "this is not a complete view of the library"
 * (notably: never tombstone missing documents from a capped crawl).
 */
const MAX_FILES = Math.max(1, parseInt(process.env.SP_MAX_FILES || '2000', 10) || 2000);

/** Outcome of a crawl: the documents plus an honest account of what was skipped. */
export interface CrawlResult {
  docs: RawSharePointDoc[];
  /** Files encountered (folders excluded), including those skipped or failed. */
  filesSeen: number;
  /** Files whose extracted body was empty — unsupported binary (pdf/xlsx) or an empty file. */
  skippedEmpty: number;
  /** Files whose download/extraction threw. Previously these killed the whole crawl. */
  failed: number;
  /** Files whose content exceeded MAX_CONTENT_CHARS and was truncated. */
  truncated: number;
  /** True when MAX_FILES stopped the walk before the library was fully traversed. */
  capped: boolean;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = GRAPH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  driveId: string;
  rootFolderId: string;
  excludeFolders: string[];
}

/** Read + validate the SP_* env vars. Returns null when the feature is not configured. */
export function getGraphConfig(): GraphConfig | null {
  const {
    SP_TENANT_ID,
    SP_CLIENT_ID,
    SP_CLIENT_SECRET,
    SP_DRIVE_ID,
    SP_ROOT_FOLDER_ID,
    SP_EXCLUDE_FOLDERS,
  } = process.env;

  if (!SP_TENANT_ID || !SP_CLIENT_ID || !SP_CLIENT_SECRET || !SP_DRIVE_ID || !SP_ROOT_FOLDER_ID) {
    return null;
  }

  return {
    tenantId: SP_TENANT_ID,
    clientId: SP_CLIENT_ID,
    clientSecret: SP_CLIENT_SECRET,
    driveId: SP_DRIVE_ID,
    rootFolderId: SP_ROOT_FOLDER_ID,
    excludeFolders: (SP_EXCLUDE_FOLDERS ?? '99 - Archive')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function isGraphConfigured(): boolean {
  return getGraphConfig() !== null;
}

async function getAccessToken(cfg: GraphConfig): Promise<string> {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    // Log the raw upstream body server-side, but never relay it to the caller —
    // Azure AD error bodies carry tenant/correlation/trace ids (AADSTS codes).
    const errText = await res.text();
    logger.error({ status: res.status, upstreamBody: errText }, 'Azure AD token request failed');
    throw new Error('SharePoint token acquisition failed.');
  }
  const data: any = await res.json();
  if (!data.access_token) throw new Error('Azure AD token response had no access_token');
  return data.access_token as string;
}

interface GraphDriveItem {
  id: string;
  name: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount: number };
  file?: { mimeType?: string };
  '@microsoft.graph.downloadUrl'?: string;
}

async function listChildren(cfg: GraphConfig, token: string, itemId: string): Promise<GraphDriveItem[]> {
  const items: GraphDriveItem[] = [];
  let next: string | null =
    `${GRAPH_BASE}/drives/${encodeURIComponent(cfg.driveId)}/items/${encodeURIComponent(itemId)}/children?$top=200`;

  while (next) {
    const res = await fetchWithTimeout(next, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const errText = await res.text();
      logger.error({ status: res.status, upstreamBody: errText }, 'Graph listChildren failed');
      throw new Error('SharePoint listing failed.');
    }
    const data: any = await res.json();
    items.push(...(data.value || []));
    next = data['@odata.nextLink'] || null;
  }
  return items;
}

/** Extract plain text from a drive file item, per file type. Returns '' if unsupported. */
async function extractFileText(item: GraphDriveItem, token: string): Promise<string> {
  const downloadUrl = item['@microsoft.graph.downloadUrl'];
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  if (!downloadUrl) return '';

  if (ext === 'md' || ext === 'markdown' || ext === 'txt' || ext === 'csv' || ext === 'json') {
    const res = await fetchWithTimeout(downloadUrl);
    return res.ok ? await res.text() : '';
  }

  if (ext === 'docx') {
    const res = await fetchWithTimeout(downloadUrl);
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value || '';
  }

  // pdf/xlsx and other binaries are intentionally not parsed here to avoid a
  // heavy server-side dependency chain; they are skipped with an empty body.
  return '';
}

function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^﻿?\s*---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/**
 * Recursively crawl the configured Knowledge Base folder and return one
 * RawSharePointDoc per file — the SAME shape the offline snapshot uses, so both
 * ingestion paths feed the identical mapping in src/constants/kbMapping.ts.
 */
export async function crawlKnowledgeBase(cfg: GraphConfig): Promise<CrawlResult> {
  const token = await getAccessToken(cfg);
  const docs: RawSharePointDoc[] = [];
  let filesSeen = 0;
  let skippedEmpty = 0;
  let failed = 0;
  let truncatedCount = 0;
  let capped = false;

  async function walk(itemId: string, topFolder: string, folderPath: string): Promise<void> {
    if (capped) return;
    const children = await listChildren(cfg, token, itemId);
    for (const child of children) {
      if (capped) return;
      if (child.folder) {
        if (cfg.excludeFolders.includes(child.name)) continue;
        const nextTop = topFolder || child.name;
        const nextPath = folderPath ? `${folderPath}/${child.name}` : child.name;
        await walk(child.id, nextTop, nextPath);
      } else if (child.file) {
        if (docs.length >= MAX_FILES) {
          capped = true;
          logger.warn({ maxFiles: MAX_FILES }, 'SharePoint crawl hit the SP_MAX_FILES cap; the library was not fully traversed');
          return;
        }
        filesSeen++;
        let content = '';
        try {
          content = await extractFileText(child, token);
        } catch (err: any) {
          // A single unreadable file (throttled download, corrupt .docx, mammoth
          // error) used to reject out of walk() and abort the ENTIRE crawl.
          // Count it and carry on; the count is surfaced to the caller instead
          // of the failure being silent OR fatal.
          failed++;
          logger.error({ err, fileName: child.name, fileId: child.id }, 'SharePoint crawl: failed to extract file');
          continue;
        }
        if (content.trim().length === 0) {
          // Unsupported binary (pdf/xlsx are deliberately not parsed here) or a
          // genuinely empty file. Not an error, but it must not look like a
          // successful ingest of that file.
          skippedEmpty++;
          continue;
        }
        const truncated = content.length > MAX_CONTENT_CHARS;
        if (truncated) truncatedCount++;
        docs.push({
          id: child.id,
          uri: `file:///${cfg.driveId}/${child.id}`,
          name: child.name,
          folderPath,
          topFolder,
          fileType: (child.name.split('.').pop() || '').toLowerCase(),
          content: truncated ? content.slice(0, MAX_CONTENT_CHARS) : content,
          truncated,
          frontmatter: parseFrontmatter(content),
          lastModified: child.lastModifiedDateTime,
        });
      }
    }
  }

  await walk(cfg.rootFolderId, '', '');
  return { docs, filesSeen, skippedEmpty, failed, truncated: truncatedCount, capped };
}
