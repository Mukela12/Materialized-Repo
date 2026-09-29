/**
 * Reading people-lists from CSV, for every import in the app.
 *
 * The imports used to fail on files real people make (client, 29 Sep 2026:
 * "I noticed the error boxes... I think due to the CSV only commands a Name,
 * Email and no commas in cells"):
 *
 *  - Any parser warning on any row aborted the whole file. A message with an
 *    unquoted comma, or the trailing empty columns Excel often writes, gives
 *    that row one field too many, and the entire import failed.
 *  - Headings had to be exactly `name` and `email` (or, for publishers, the
 *    camelCase `affiliateName`, which nobody types), so "Full Name", "Email
 *    Address" or separate First/Last columns found nothing.
 *  - "Creators.CSV" was refused for its capital letters.
 *
 * Now a bad row is marked on its own row, headings are matched loosely, a
 * file with no heading row still works when one column is clearly emails,
 * and a person listed twice is flagged instead of invited twice.
 */
import Papa from "papaparse";

export const MAX_IMPORT_ROWS = 200;

/** "Full Name" / "full_name" / "﻿Full-Name" all become "fullname". */
export function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const NAME_HEADERS = [
  "name", "fullname", "creatorname", "creator", "influencername", "influencer", "contactname",
  "displayname", "publishername", "publisher", "affiliatename", "affiliate", "partnername",
];
export const FIRST_NAME_HEADERS = ["firstname", "first", "givenname", "forename"];
export const LAST_NAME_HEADERS = ["lastname", "last", "surname", "familyname"];
export const EMAIL_HEADERS = [
  "email", "emailaddress", "mail", "creatoremail", "contactemail", "publisheremail", "affiliateemail", "emailid",
];

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function cleanEmail(raw: string): string {
  return raw.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim();
}

export function isEmail(raw: string): boolean {
  return EMAIL.test(cleanEmail(raw));
}

/** "jane.doe@x.com" -> "Jane Doe", for a file that has emails but no names. */
export function nameFromEmail(email: string): string {
  return cleanEmail(email).split("@")[0]
    .split(/[._\-+]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Every row as cells, tolerating rows with too few or too many fields. */
export function readCsvCells(content: string): string[][] {
  const parsed = Papa.parse<string[]>(content, { header: false, skipEmptyLines: "greedy" });
  // Field-count and delimiter warnings are per row and survivable; the rows
  // are still in parsed.data. Only an empty result is a failure.
  return parsed.data.map((r) => r.map((c) => (c ?? "").toString().trim()));
}

export function findColumn(headers: string[], aliases: string[]): number {
  for (const a of aliases) {
    const i = headers.indexOf(a);
    if (i !== -1) return i;
  }
  return -1;
}

export interface ContactRow {
  name: string;
  email: string;
  /** Optional columns the caller asked for, by the caller's key. */
  extras: Record<string, string>;
  error?: string;
}

export interface ContactImport {
  rows: ContactRow[];
  /** Why nothing could be read at all; shown instead of a table. */
  problem?: string;
  /** True when the file had no heading row and emails were found by shape. */
  headerless?: boolean;
}

/**
 * A list of people (name + email, plus any optional columns) from a CSV.
 * `extras` maps the caller's key to the headings that mean it, e.g.
 * { message: ["message", "personalmessage", "note"] }.
 */
export function parseContactCsv(
  content: string,
  opts: { extras?: Record<string, string[]>; maxRows?: number } = {},
): ContactImport {
  const maxRows = opts.maxRows ?? MAX_IMPORT_ROWS;
  const cells = readCsvCells(content);
  if (cells.length === 0) return { rows: [], problem: "The file is empty." };

  const headers = cells[0].map(normalizeHeader);
  let emailCol = findColumn(headers, EMAIL_HEADERS);
  let nameCol = findColumn(headers, NAME_HEADERS);
  const firstCol = findColumn(headers, FIRST_NAME_HEADERS);
  const lastCol = findColumn(headers, LAST_NAME_HEADERS);
  let body = cells.slice(1);
  let headerless = false;

  if (emailCol === -1) {
    // No email heading. If the first row is itself data (a pasted list with no
    // headings), find the email column by what is in it.
    const firstEmail = cells[0].findIndex(isEmail);
    if (firstEmail === -1) {
      return {
        rows: [],
        problem: "Couldn't find an email column. Add a first row with column names, like: Name, Email",
      };
    }
    headerless = true;
    emailCol = firstEmail;
    nameCol = cells[0].findIndex((c, i) => i !== firstEmail && c !== "" && !isEmail(c));
    body = cells;
  }

  if (body.length === 0) return { rows: [], problem: "The file has column names but no people in it." };
  if (body.length > maxRows) {
    return { rows: [], problem: `That's ${body.length} people. Up to ${maxRows} fit in one file, so split it into smaller files.` };
  }

  const extraCols = Object.fromEntries(
    Object.entries(opts.extras ?? {}).map(([key, aliases]) => [key, headerless ? -1 : findColumn(headers, aliases)]),
  );

  // A row with more cells than there are headings almost always means an
  // unquoted comma in the last column ("Hi Ava, loved your reel"). Put the
  // overflow back into that column instead of losing it.
  const finalCol = headers.length - 1;
  const mendRow = (r: string[]): string[] =>
    !headerless && finalCol > 0 && headers[finalCol] !== "" && r.length > headers.length
      ? [...r.slice(0, finalCol), r.slice(finalCol).join(", ").replace(/(,\s*)+$/, "")]
      : r;

  const seen = new Set<string>();
  const rows = body.map(mendRow).map((r): ContactRow => {
    const email = cleanEmail(r[emailCol] ?? "");
    const joined = [firstCol, lastCol].filter((i) => i !== -1).map((i) => r[i] ?? "").join(" ").trim();
    let name = (nameCol !== -1 ? r[nameCol] ?? "" : "").trim() || joined;
    if (!name && email && isEmail(email)) name = nameFromEmail(email);
    const extras: Record<string, string> = {};
    for (const [key, col] of Object.entries(extraCols)) {
      if (col !== -1 && (r[col] ?? "").trim()) extras[key] = (r[col] ?? "").trim();
    }

    let error: string | undefined;
    if (!email) error = "No email";
    else if (!isEmail(email)) error = "Email doesn't look right";
    else if (seen.has(email.toLowerCase())) error = "Listed twice in this file";
    else if (!name) error = "No name";
    if (!error) seen.add(email.toLowerCase());
    return { name, email, extras, ...(error ? { error } : {}) };
  });

  return { rows, headerless };
}

/** Case-insensitive, so "Creators.CSV" is a CSV too. */
export function isCsvFile(file: { name: string; type?: string }): boolean {
  return file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
}
