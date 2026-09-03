/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The PDF/DOCX/XLSX parsers (pdfjs-dist, mammoth, xlsx) are large — together
// ~1.4MB of JS. They are only ever needed when a user actually uploads a file
// of the matching type, so each is loaded on demand via dynamic import() to
// keep them out of the initial KnowledgeBaseTab chunk.

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  const { default: pdfjsWorker } = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str).join(' '));
  }
  return pages.join('\n\n');
}

async function extractDocxText(file: File): Promise<string> {
  const { default: mammoth } = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  return value;
}

async function extractXlsxText(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    return `# ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`;
  }).join('\n\n');
}

/**
 * Extracts plain text from an uploaded knowledge-base file so it can be
 * stored and searched/chunked. Throws if the file's bytes don't match its
 * extension (e.g. a renamed/corrupted file) so callers can surface a clear
 * error instead of silently uploading an empty document.
 */
export async function extractFileText(file: File, extension: string): Promise<string> {
  let text: string;
  switch (extension) {
    case 'pdf':
      text = await extractPdfText(file);
      break;
    case 'docx':
      text = await extractDocxText(file);
      break;
    case 'xlsx':
      text = await extractXlsxText(file);
      break;
    case 'csv':
    case 'txt':
    case 'md':
      text = await file.text();
      break;
    default:
      throw new Error(`Unsupported file type ".${extension}"`);
  }

  if (!text.trim()) {
    throw new Error('No readable text content was found in this file.');
  }
  return text;
}
