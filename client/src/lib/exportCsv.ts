import Papa from "papaparse";

/**
 * A single CSV column: a header label plus a pure accessor that pulls the raw
 * value out of a row. Keep the accessor returning *raw* data (numbers, ISO
 * strings) rather than display-formatted strings — e.g. export the numeric
 * `commissionAmount` string, not the `formatMoney(...)`-formatted cell.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * Neutralize CSV formula (a.k.a. "CSV injection") payloads. A spreadsheet
 * evaluates any cell whose text begins with =, +, -, @, TAB, or CR as a
 * formula — so attacker-controllable free text (a video title, brand name,
 * user display name…) like `=HYPERLINK("http://evil","Refund")` would run in
 * whoever opens the export. Prefix such strings with a single quote so the
 * spreadsheet treats them as literal text. Non-strings pass through unchanged.
 */
export function sanitizeCsvCell(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Turn rows + column definitions into a papaparse-ready array of objects,
 * keyed by header. Nullish values become "" so the CSV has stable columns.
 * Exported separately from the download so it can be unit-tested without a DOM.
 */
export function rowsToCsvRecords<T>(
  rows: T[],
  columns: CsvColumn<T>[],
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      columns.map((col) => {
        const v = col.value(row);
        return [col.header, v == null ? "" : sanitizeCsvCell(v)];
      }),
    ),
  );
}

/**
 * Build the CSV *string* (no download). Pure — unit-testable. Uses the column
 * order from `columns` so the output is deterministic regardless of key order.
 */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const records = rowsToCsvRecords(rows, columns);
  return Papa.unparse(records, { columns: columns.map((c) => c.header) });
}

/**
 * Export the given rows to a CSV file and trigger a browser download.
 *
 * - Prepends a UTF-8 BOM so Excel opens accented characters correctly.
 * - Appends the current date to the filename (e.g. `commissions-2026-07-22.csv`).
 *
 * The Blob-download idiom matches the existing template download in
 * brand-creators.tsx.
 */
export function exportToCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
): void {
  const csv = buildCsv(rows, columns);
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
