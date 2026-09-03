// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  downloadFilenameFor,
  downloadMimeTypeFor,
  downloadKbDocument,
} from '../src/utils/documentDownload.ts';

/**
 * The Download button in the document library and the assistant's source modal
 * used to fire `toast.success('Preparing secure download buffer for …')` and do
 * nothing else — reported success, produced no file.
 *
 * These cases pin down the two things the fix has to get right:
 *   - the saved file is named for what the bytes ACTUALLY are (EKOS stores
 *     extracted text, never the original PDF/DOCX), and
 *   - a document with no stored text reports failure instead of success.
 */
describe('downloadFilenameFor', () => {
  it('keeps the name for formats whose stored content IS the file', () => {
    expect(downloadFilenameFor('telenord.md')).toBe('telenord.md');
    expect(downloadFilenameFor('notes.txt')).toBe('notes.txt');
    expect(downloadFilenameFor('export.csv')).toBe('export.csv');
    // Extension casing must not change the decision.
    expect(downloadFilenameFor('README.MD')).toBe('README.MD');
  });

  it('rewrites a binary format to .txt, because only the text was ever stored', () => {
    // Handing extracted text back as .pdf produces a file no reader will open,
    // which reads as a corrupt download rather than an absent original.
    expect(downloadFilenameFor('Factura.pdf')).toBe('Factura.txt');
    expect(downloadFilenameFor('Master Training.docx')).toBe('Master Training.txt');
    expect(downloadFilenameFor('rates.xlsx')).toBe('rates.txt');
  });

  it('handles names with dots, no extension, and edge punctuation', () => {
    expect(downloadFilenameFor('SOP v1.2 Billing.pdf')).toBe('SOP v1.2 Billing.txt');
    expect(downloadFilenameFor('Escalation Rules')).toBe('Escalation Rules.txt');
    expect(downloadFilenameFor('report.')).toBe('report.txt');
    expect(downloadFilenameFor('.gitignore')).toBe('.gitignore.txt');
    expect(downloadFilenameFor('   ')).toBe('document.txt');
    expect(downloadFilenameFor('')).toBe('document.txt');
  });
});

describe('downloadMimeTypeFor', () => {
  it('matches the type to the extension the filename ended up with', () => {
    expect(downloadMimeTypeFor('a.md')).toContain('text/markdown');
    expect(downloadMimeTypeFor('a.csv')).toContain('text/csv');
    expect(downloadMimeTypeFor('a.json')).toContain('application/json');
    expect(downloadMimeTypeFor('a.txt')).toContain('text/plain');
    // Whatever we could not classify is still text, not a lie about being binary.
    expect(downloadMimeTypeFor('a.pdf')).toContain('text/plain');
  });
});

describe('downloadKbDocument', () => {
  let clicked: string[];
  let createdUrls: number;
  let revokedUrls: number;

  beforeEach(() => {
    clicked = [];
    createdUrls = 0;
    revokedUrls = 0;
    vi.useFakeTimers();
    // jsdom implements neither of these.
    (URL as any).createObjectURL = () => {
      createdUrls++;
      return `blob:mock-${createdUrls}`;
    };
    (URL as any).revokeObjectURL = () => {
      revokedUrls++;
    };
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes a file and returns the filename it used', () => {
    const filename = downloadKbDocument({ name: 'Factura.pdf', content: '# Factura\nIVA 21%' });
    expect(filename).toBe('Factura.txt');
    expect(clicked).toEqual(['Factura.txt']);
    expect(createdUrls).toBe(1);
  });

  it('releases the object URL, but only after the click', () => {
    downloadKbDocument({ name: 'a.md', content: 'x' });
    // Revoking synchronously can cancel the download before the blob is read.
    expect(revokedUrls).toBe(0);
    vi.runAllTimers();
    expect(revokedUrls).toBe(1);
  });

  it('leaves no anchor behind in the document', () => {
    downloadKbDocument({ name: 'a.md', content: 'x' });
    expect(document.querySelectorAll('a[download]').length).toBe(0);
  });

  it('returns null instead of a phantom success when there is no text', () => {
    expect(downloadKbDocument({ name: 'Empty.pdf', content: '' })).toBeNull();
    expect(downloadKbDocument({ name: 'Empty.pdf', content: '   \n ' })).toBeNull();
    expect(downloadKbDocument({ name: 'Empty.pdf', content: null })).toBeNull();
    expect(downloadKbDocument({ name: 'Empty.pdf' })).toBeNull();
    expect(downloadKbDocument(null)).toBeNull();
    expect(downloadKbDocument(undefined)).toBeNull();
    // Nothing was handed to the browser in any of those cases.
    expect(clicked).toEqual([]);
    expect(createdUrls).toBe(0);
  });
});
