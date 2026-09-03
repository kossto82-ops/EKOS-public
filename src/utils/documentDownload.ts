/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Downloading a knowledge-base document.
 *
 * The Download button in the document library and in the assistant's source
 * modal used to call `toast.success('Preparing secure download buffer for …')`
 * and stop there — a success message for an action that never happened.
 *
 * There is no file to stream: EKOS stores the **extracted text** of every
 * document in `kb_documents.content`, never the original bytes. A PDF ingested
 * from SharePoint exists here as its text, and the original stays in SharePoint.
 * So the download is built in the browser from the content the API already
 * returns with every document, and no new endpoint is needed.
 *
 * That is also why the extension gets rewritten — see `downloadFilenameFor`.
 */

/**
 * Extensions whose stored content IS the file: what we hand back is byte-for-byte
 * what the format expects, so the name can be kept as-is.
 */
const TEXT_FAITHFUL_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'xml', 'yml', 'yaml', 'html', 'log',
]);

/**
 * The filename to save a document under.
 *
 * For a text format the document's own name is correct. For anything else the
 * extension MUST be replaced: writing extracted text into `Factura.pdf` produces
 * a file that every PDF reader refuses to open, and the user would reasonably
 * read that as "EKOS gave me a corrupt download" rather than "EKOS never had the
 * PDF". `Master Training.docx` becomes `Master Training.txt`, which is exactly
 * what the bytes are.
 */
export function downloadFilenameFor(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'document.txt';

  const dot = trimmed.lastIndexOf('.');
  // No extension, a leading dot ('.gitignore'), or a trailing dot ('report.'):
  // nothing safe to preserve, so state the format we are actually producing.
  if (dot <= 0 || dot === trimmed.length - 1) return `${trimmed.replace(/\.$/, '')}.txt`;

  const ext = trimmed.slice(dot + 1).toLowerCase();
  if (TEXT_FAITHFUL_EXTENSIONS.has(ext)) return trimmed;
  return `${trimmed.slice(0, dot)}.txt`;
}

/** MIME type matching what `downloadFilenameFor` decided to produce. */
export function downloadMimeTypeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'md' || ext === 'markdown') return 'text/markdown;charset=utf-8';
  if (ext === 'csv') return 'text/csv;charset=utf-8';
  if (ext === 'tsv') return 'text/tab-separated-values;charset=utf-8';
  if (ext === 'json') return 'application/json;charset=utf-8';
  if (ext === 'xml') return 'application/xml;charset=utf-8';
  if (ext === 'html') return 'text/html;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

/**
 * Hand a text file to the browser. Separated from the decisions above so the
 * naming rules stay unit-testable without a DOM.
 */
export function triggerTextDownload(filename: string, text: string): void {
  const blob = new Blob([text], { type: downloadMimeTypeFor(filename) });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  // Firefox needs the element in the document for a programmatic click to count.
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoked on the next tick: revoking synchronously can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface DownloadableDocument {
  name: string;
  content?: string | null;
}

/**
 * Download a document's stored text. Returns the filename written, or null when
 * the document carries no content — a document whose ingestion produced no text
 * has nothing to hand over, and the caller must say so rather than report a
 * success the user cannot find on disk.
 */
export function downloadKbDocument(doc: DownloadableDocument | null | undefined): string | null {
  const content = doc?.content;
  if (!doc || typeof content !== 'string' || content.trim() === '') return null;
  const filename = downloadFilenameFor(doc.name);
  triggerTextDownload(filename, content);
  return filename;
}
