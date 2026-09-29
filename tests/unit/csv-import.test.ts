/**
 * CSV imports, tested with the files people actually make (29 Sep 2026).
 *
 * The client hit "error boxes" importing creators and concluded the CSV could
 * only have Name and Email with no commas in cells. The real faults: any row
 * with a field too many (an unquoted comma, Excel's trailing empty columns)
 * failed the whole file, headings had to match exactly, and the publisher
 * import wanted a column called "affiliateName".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseContactCsv, isCsvFile, nameFromEmail, normalizeHeader } from "../../client/src/lib/csvImport";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const people = (csv: string, extras?: Record<string, string[]>) => parseContactCsv(csv, { extras });

describe("files people make", () => {
  it("plain Name, Email", () => {
    const r = people("Name,Email\nJane Smith,jane@example.com\nLeo Park,leo@example.com");
    expect(r.rows.map((x) => [x.name, x.email, x.error])).toEqual([
      ["Jane Smith", "jane@example.com", undefined],
      ["Leo Park", "leo@example.com", undefined],
    ]);
  });

  it("Full Name / Email Address headings", () => {
    const r = people("Full Name,Email Address\nJane Smith,jane@example.com");
    expect(r.rows[0]).toMatchObject({ name: "Jane Smith", email: "jane@example.com" });
  });

  it("separate First Name and Last Name columns", () => {
    const r = people("First Name,Last Name,E-mail\nJane,Smith,jane@example.com");
    expect(r.rows[0]).toMatchObject({ name: "Jane Smith", email: "jane@example.com" });
  });

  it("Excel's byte-order mark and Windows line endings", () => {
    const r = people("﻿Name,Email\r\nJane Smith,jane@example.com\r\n");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].error).toBeUndefined();
  });

  it("semicolons, as European Excel saves it", () => {
    const r = people("Name;Email\nJane Smith;jane@example.com");
    expect(r.rows[0]).toMatchObject({ name: "Jane Smith", email: "jane@example.com" });
  });

  it("a comma inside a quoted cell is kept", () => {
    const r = people('Name,Email,Message\nJane Smith,jane@example.com,"Hi Jane, welcome!"', { message: ["message"] });
    expect(r.rows[0].extras.message).toBe("Hi Jane, welcome!");
  });

  it("an unquoted comma in a message no longer sinks the whole file", () => {
    const r = people("Name,Email,Message\nJane Smith,jane@example.com,Hi Jane, welcome\nLeo Park,leo@example.com,Hello", { message: ["message"] });
    expect(r.problem).toBeUndefined();
    expect(r.rows.map((x) => x.error)).toEqual([undefined, undefined]);
    // ...and the message keeps its second half.
    expect(r.rows[0].extras.message).toBe("Hi Jane, welcome");
  });

  it("trailing empty columns from Excel", () => {
    const r = people("Name,Email,,,\nJane Smith,jane@example.com,,,\nLeo Park,leo@example.com");
    expect(r.rows.filter((x) => !x.error)).toHaveLength(2);
  });

  it("a pasted list with no heading row", () => {
    const r = people("Jane Smith,jane@example.com\nLeo Park,leo@example.com");
    expect(r.headerless).toBe(true);
    expect(r.rows.map((x) => x.name)).toEqual(["Jane Smith", "Leo Park"]);
  });

  it("emails only: a readable name is made from the address", () => {
    const r = people("Email\njane.smith@example.com");
    expect(r.rows[0]).toMatchObject({ name: "Jane Smith", email: "jane.smith@example.com" });
    expect(nameFromEmail("leo_park+vip@x.com")).toBe("Leo Park Vip");
  });

  it("mailto: links and angle brackets are cleaned", () => {
    const r = people("Name,Email\nJane,mailto:jane@example.com\nLeo,<leo@example.com>");
    expect(r.rows.map((x) => x.email)).toEqual(["jane@example.com", "leo@example.com"]);
  });
});

describe("problems are specific, and on the row they belong to", () => {
  it("a bad or missing email marks that row only", () => {
    const r = people("Name,Email\nJane,jane@example\nLeo,\nMia,mia@example.com");
    expect(r.rows.map((x) => x.error)).toEqual(["Email doesn't look right", "No email", undefined]);
  });

  it("someone listed twice is flagged, whatever the capitals", () => {
    const r = people("Name,Email\nJane,jane@example.com\nJane S,JANE@example.com");
    expect(r.rows[1].error).toBe("Listed twice in this file");
  });

  it("no email column at all says what to add", () => {
    expect(people("Name,Phone\nJane,555").problem).toMatch(/Couldn't find an email column/);
  });

  it("too many people says to split the file", () => {
    const csv = "Name,Email\n" + Array.from({ length: 201 }, (_, i) => `P${i},p${i}@example.com`).join("\n");
    expect(people(csv).problem).toMatch(/201 people. Up to 200/);
  });

  it("an empty file and a header-only file", () => {
    expect(people("").problem).toBe("The file is empty.");
    expect(people("Name,Email\n").problem).toMatch(/no people/);
  });
});

describe("small things", () => {
  it("Creators.CSV is a CSV", () => {
    expect(isCsvFile({ name: "Creators.CSV" })).toBe(true);
    expect(isCsvFile({ name: "creators.xlsx" })).toBe(false);
  });

  it("headings are compared without case, spaces or punctuation", () => {
    expect(normalizeHeader("﻿Full-Name ")).toBe("fullname");
  });
});

describe("every import uses it", () => {
  it("brand creator invites, publisher invites and the voucher partner file", () => {
    expect(code("client/src/pages/brand-creators.tsx")).toMatch(/parseContactCsv\(content,/);
    expect(code("client/src/pages/affiliates.tsx")).toMatch(/parseContactCsv\(String\(reader\.result/);
    expect(code("client/src/components/VoucherManager.tsx")).toMatch(/readCsvCells\(String\(reader\.result/);
    for (const f of ["client/src/pages/brand-creators.tsx", "client/src/pages/affiliates.tsx", "client/src/components/VoucherManager.tsx"]) {
      expect(code(f), f).not.toMatch(/Papa\.parse/);
      expect(code(f), f).not.toMatch(/errors\.length > 0\)/);
    }
  });

  it("people imports show the (i) format hint", () => {
    expect(code("client/src/pages/brand-creators.tsx")).toMatch(/<CsvFormatHint/);
    expect(code("client/src/pages/affiliates.tsx")).toMatch(/<CsvFormatHint/);
  });
});
