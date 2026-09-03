/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

function escapeCsvValue(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportToCsv<T extends Record<string, any>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
  filename: string
): void {
  const headerRow = columns.map(c => escapeCsvValue(c.header)).join(',');
  const dataRows = rows.map(row =>
    columns.map(c => escapeCsvValue(row[c.key])).join(',')
  );
  const csvContent = [headerRow, ...dataRows].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
