/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure, dependency-free mapping from a SharePoint crawl record to the app's
 * KBDocument shape. Kept free of server-only imports so it can be used from
 * BOTH the client bundle (src/constants/kb.ts, which seeds the demo data) and
 * the server-side live Graph sync (src/server/sharepoint/*). The two paths must
 * produce identical rows, so all of that logic lives here in one place.
 */

import { KBDocument } from '../types';

/** One file as captured by the SharePoint crawler (see src/data/sharepoint-kb-snapshot.json). */
export interface RawSharePointDoc {
  id: string;
  uri?: string;
  name: string;
  folderPath?: string;
  topFolder?: string;
  fileType?: string;
  content?: string;
  truncated?: boolean;
  frontmatter?: Record<string, string>;
  lastModified?: string;
}

export interface KbSnapshot {
  source?: {
    driveId?: string;
    rootFolderId?: string;
    libraryPath?: string;
    crawledAt?: string;
  };
  documents: RawSharePointDoc[];
}

/** Nicer display names for the numbered SharePoint top-level folders. */
const CATEGORY_BY_FOLDER: Record<string, string> = {
  '00 - Governance': 'Governance & Compliance',
  '01 - Group Information': 'Group Information',
  '02 - Brands': 'Brand Information',
  '03 - Products & Services': 'Products & Services',
  '04 - Operations': 'Operations',
  '05 - Customer Service': 'Customer Service',
  '06 - Sugar & CMT': 'Systems & Tools',
  '07 - Telephony': 'Telephony',
  '08 - Billing & Finance': 'Billing & Finance',
  '09 - HR & Training': 'HR & Training',
  '10 - Legal & Compliance': 'Legal & Compliance',
  '11 - FAQs': 'FAQs',
  '12 - CORPORATE': 'Corporate SOPs',
};

const KB_TYPES: KBDocument['type'][] = ['pdf', 'xlsx', 'docx', 'csv', 'txt'];

/** Values SharePoint frontmatter uses to mean "no value yet". */
function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  const t = v.trim();
  return (
    t === '' ||
    t.startsWith('[') || // e.g. "[INFORMATION REQUIRED]", "[UNCONFIRMED ...]"
    /^(unknown|n\/?a|tbd|pending)$/i.test(t)
  );
}

function cleanFrontmatterValue(v: string | undefined): string | undefined {
  return isPlaceholder(v) ? undefined : v!.trim();
}

export function folderToCategory(topFolder: string | undefined): string {
  const f = (topFolder || '').trim();
  if (!f) return 'General';
  if (CATEGORY_BY_FOLDER[f]) return CATEGORY_BY_FOLDER[f];
  // Fall back to stripping a leading "NN - " numeric prefix.
  const stripped = f.replace(/^\d+\s*-\s*/, '').trim();
  return stripped || 'General';
}

/** Map a file extension to the KBDocument.type union (markdown collapses to txt). */
export function fileTypeToDocType(fileType: string | undefined): KBDocument['type'] {
  const t = (fileType || '').toLowerCase().replace(/^\./, '');
  if (t === 'md' || t === 'markdown' || t === 'txt') return 'txt';
  if ((KB_TYPES as string[]).includes(t)) return t as KBDocument['type'];
  return 'txt';
}

/** Strip a leading YAML frontmatter block (--- ... ---) so grounding text is clean. */
export function stripFrontmatter(content: string | undefined): string {
  if (!content) return '';
  const m = content.match(/^﻿?\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length).trimStart() : content;
}

/** Derive a department display label from the frontmatter business_area, else the category. */
function deriveDepartment(businessArea: string | undefined, category: string): string {
  const ba = cleanFrontmatterValue(businessArea);
  if (!ba) return category;
  // business_area is often "Telephony / Customer Setup" — take the leading segment.
  return ba.split('/')[0].trim() || category;
}

function looksLikeDate(v: string | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}/.test(v.trim());
}

/**
 * Convert one crawled SharePoint file into a KBDocument row.
 *
 * Design decisions (documented in docs/SHAREPOINT_SYNC.md):
 *  - Everything is ingested as scope:'global' + departmentScope:'global' so the
 *    real content is visible under any brand/department without wiring the
 *    SharePoint taxonomy into the brand/department roster (14 real brands in
 *    kb_brands; the taxonomy wiring is still pending, not the roster).
 *  - The SharePoint item id is prefixed with "sp_" to form a stable, collision-
 *    free primary key, so re-syncing upserts the same rows.
 */
export function mapRawDocToKbDocument(raw: RawSharePointDoc, crawledAt?: string, idPrefix: string = 'sp_'): KBDocument {
  const fm = raw.frontmatter || {};
  const category = folderToCategory(raw.topFolder);
  const stampDate = (crawledAt || new Date().toISOString().split('T')[0]).split('T')[0];
  const reviewDate = looksLikeDate(fm.review_date) ? fm.review_date.trim() : stampDate;
  const statusRaw = (cleanFrontmatterValue(fm.status) || '').toLowerCase();
  const approvalStatus: KBDocument['approvalStatus'] =
    statusRaw.includes('approv') ? 'Approved'
    : statusRaw.includes('review') ? 'Under Review'
    : statusRaw.includes('draft') ? 'Draft'
    : 'Approved';

  const isImportant =
    (raw.topFolder || '').includes('CORPORATE') ||
    /\bSOP\b/i.test(raw.name) ||
    /governance/i.test(raw.topFolder || '');

  return {
    id: `${idPrefix}${raw.id}`,
    name: raw.name,
    type: fileTypeToDocType(raw.fileType),
    status: 'trained',
    scope: 'global',
    departmentScope: 'global',
    category,
    content: stripFrontmatter(raw.content),
    uploadedAt: crawledAt || stampDate,
    uploadedBy: 'sharepoint-sync',
    owner: cleanFrontmatterValue(fm.owner) || 'Customer Service Operations',
    // `owner` is a display string and always has a value, real or defaulted; it
    // grants nothing. `ownerId` is a PortalUser id and is what
    // PATCH /api/db/documents/:id checks to let the responsible person edit their
    // own document (routes/documents.ts's isOwner), so it stays undefined unless
    // the frontmatter names an actual account. Crawled documents overwhelmingly
    // do not — their `owner` is the "[INFORMATION REQUIRED]" placeholder — and
    // inventing an id here would hand out write access.
    ownerId: cleanFrontmatterValue(fm.owner_id),
    department: deriveDepartment(fm.business_area, category),
    reviewFrequency: 'Every 90 days',
    // No expiry is fabricated: SharePoint frontmatter carries no expiration field,
    // and stamping a uniform hardcoded date silently made the ENTIRE synced KB
    // non-groundable past that date (isGroundableDoc excludes expired docs). Leave
    // undefined until a real expiry policy exists.
    expirationDate: undefined,
    approvalStatus,
    version: '1.0',
    lastReviewDate: reviewDate,
    viewsCount: 0,
    ratingUp: 0,
    ratingDown: 0,
    isImportant,
  };
}

/** One document added to EKOS by a person (see src/data/manual-uploads.json). */
export interface RawUploadedDoc {
  id: string;
  name: string;
  fileType?: string;
  category?: string;
  department?: string;
  content?: string;
}

export interface UploadBatch {
  uploadedAt?: string;
  documents: RawUploadedDoc[];
}

/** Who uploaded a batch, and who is answerable for it afterwards. */
export interface Uploader {
  /** PortalUser id recorded in kb_documents.uploaded_by. */
  id: string;
  /** Display name recorded in kb_documents.owner. */
  name: string;
}

/**
 * Convert manually uploaded documents into KBDocument rows.
 *
 * Deliberately NOT mapRawDocToKbDocument: these are not crawl output, and the
 * two differ in the fields that matter for governance. A crawled file is stamped
 * `uploadedBy: 'sharepoint-sync'` with no `ownerId`, because nobody in the user
 * roster is answerable for it — its owner is whatever the SharePoint frontmatter
 * claimed, often the `[INFORMATION REQUIRED]` placeholder. An upload has a real
 * person on both: `uploadedBy` records who added it, and `ownerId` is what
 * PATCH /api/db/documents/:id checks to let that person edit their own document
 * without blanket KB-manage permission (see routes/documents.ts's isOwner).
 *
 * There is also no kb_sources row for these on purpose. A source means something
 * crawls it on a schedule and the Sync board tracks its jobs; an uploaded
 * document has no upstream to re-crawl, so registering one would put a
 * permanently idle connector on that board.
 *
 * `approvalStatus: 'Approved'` is honest here for the same reason: unlike the
 * synced corpus (~65% "Under Review" because the frontmatter said so), a named
 * owner is vouching for this content at upload time.
 */
export function mapUploadToKbDocuments(batch: UploadBatch, uploader: Uploader): KBDocument[] {
  const uploadedAt = batch.uploadedAt || new Date().toISOString().split('T')[0];
  return (batch.documents || [])
    .filter((d) => (d.content || '').trim().length > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      type: fileTypeToDocType(d.fileType),
      status: 'trained' as const,
      scope: 'global' as const,
      departmentScope: 'global' as const,
      category: d.category || 'General',
      content: stripFrontmatter(d.content),
      uploadedAt,
      uploadedBy: uploader.id,
      owner: uploader.name,
      ownerId: uploader.id,
      department: d.department || d.category || 'General',
      reviewFrequency: 'Every 90 days',
      // Same reasoning as the synced corpus: no expiry is fabricated, because a
      // uniform stamped date silently makes the whole batch non-groundable.
      expirationDate: undefined,
      approvalStatus: 'Approved' as const,
      version: '1.0',
      lastReviewDate: uploadedAt,
      viewsCount: 0,
      ratingUp: 0,
      ratingDown: 0,
      isImportant: false,
    }));
}

export function mapSnapshotToKbDocuments(snapshot: KbSnapshot, idPrefix: string = 'sp_'): KBDocument[] {
  const crawledAt = snapshot.source?.crawledAt;
  return (snapshot.documents || [])
    // Drop anything with no usable text — an empty doc only dilutes grounding.
    .filter((d) => stripFrontmatter(d.content).trim().length > 0)
    .map((d) => mapRawDocToKbDocument(d, crawledAt, idPrefix));
}
