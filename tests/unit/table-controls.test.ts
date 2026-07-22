import { describe, it, expect } from "vitest";
import { compareValues, processRows } from "../../client/src/hooks/useTableControls";
import { buildCsv, rowsToCsvRecords } from "../../client/src/lib/exportCsv";

type Row = {
  name: string;
  email: string;
  // money as decimal strings, like Drizzle numeric columns
  amount: string;
  createdAt: string | null;
};

const rows: Row[] = [
  { name: "Charlie", email: "c@x.com", amount: "9.00", createdAt: "2026-01-03" },
  { name: "alice", email: "a@x.com", amount: "12.50", createdAt: null },
  { name: "Bob", email: "b@x.com", amount: "100.00", createdAt: "2026-01-01" },
];

describe("compareValues", () => {
  it("compares numeric strings as numbers, not lexicographically", () => {
    // "9.00" > "12.50" lexicographically, but 9 < 12.5 numerically
    expect(compareValues("9.00", "12.50")).toBeLessThan(0);
    expect(compareValues("100.00", "9.00")).toBeGreaterThan(0);
  });

  it("compares plain strings case-insensitively / locale-aware", () => {
    expect(compareValues("alice", "Bob")).toBeLessThan(0);
    expect(compareValues("Bob", "alice")).toBeGreaterThan(0);
    expect(compareValues("same", "same")).toBe(0);
  });

  it("sorts nullish and empty values last regardless of the other side", () => {
    expect(compareValues(null, "a")).toBeGreaterThan(0);
    expect(compareValues("a", null)).toBeLessThan(0);
    expect(compareValues("", "a")).toBeGreaterThan(0);
    expect(compareValues(null, "")).toBe(0);
  });
});

describe("processRows — search", () => {
  const searchFields = (r: Row) => [r.name, r.email];

  it("filters case-insensitively across the given fields", () => {
    const out = processRows(rows, {
      query: "ALICE",
      searchFields,
      sortKey: null,
      sortDir: "asc",
    });
    expect(out.map((r) => r.name)).toEqual(["alice"]);
  });

  it("matches on any provided field (email as well as name)", () => {
    const out = processRows(rows, {
      query: "b@x.com",
      searchFields,
      sortKey: null,
      sortDir: "asc",
    });
    expect(out.map((r) => r.name)).toEqual(["Bob"]);
  });

  it("returns all rows for an empty/whitespace query", () => {
    expect(
      processRows(rows, { query: "   ", searchFields, sortKey: null, sortDir: "asc" }),
    ).toHaveLength(3);
  });
});

describe("processRows — sort", () => {
  const sortAccessors = {
    name: (r: Row) => r.name,
    amount: (r: Row) => r.amount,
    createdAt: (r: Row) => r.createdAt,
  };

  it("sorts numeric decimal strings ascending by value", () => {
    const out = processRows(rows, {
      query: "",
      sortKey: "amount",
      sortDir: "asc",
      sortAccessors,
    });
    expect(out.map((r) => r.amount)).toEqual(["9.00", "12.50", "100.00"]);
  });

  it("sorts descending", () => {
    const out = processRows(rows, {
      query: "",
      sortKey: "amount",
      sortDir: "desc",
      sortAccessors,
    });
    expect(out.map((r) => r.amount)).toEqual(["100.00", "12.50", "9.00"]);
  });

  it("puts null createdAt last on both directions", () => {
    const asc = processRows(rows, {
      query: "",
      sortKey: "createdAt",
      sortDir: "asc",
      sortAccessors,
    });
    expect(asc[asc.length - 1].createdAt).toBeNull();
    const desc = processRows(rows, {
      query: "",
      sortKey: "createdAt",
      sortDir: "desc",
      sortAccessors,
    });
    expect(desc[desc.length - 1].createdAt).toBeNull();
  });

  it("does not mutate the input array", () => {
    const original = [...rows];
    processRows(rows, { query: "", sortKey: "amount", sortDir: "asc", sortAccessors });
    expect(rows).toEqual(original);
  });

  it("applies search then sort together", () => {
    const out = processRows(rows, {
      query: "@x.com",
      searchFields: (r: Row) => [r.email],
      sortKey: "name",
      sortDir: "asc",
      sortAccessors,
    });
    expect(out.map((r) => r.name)).toEqual(["alice", "Bob", "Charlie"]);
  });
});

describe("CSV export", () => {
  const columns = [
    { header: "Name", value: (r: Row) => r.name },
    { header: "Amount", value: (r: Row) => r.amount },
    { header: "Created", value: (r: Row) => r.createdAt },
  ];

  it("maps rows to header-keyed records with nullish -> empty string", () => {
    const records = rowsToCsvRecords(rows, columns);
    expect(records[1]).toEqual({ Name: "alice", Amount: "12.50", Created: "" });
  });

  it("builds a CSV with the header row and column order preserved", () => {
    const csv = buildCsv([rows[0]], columns);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe("Name,Amount,Created");
    expect(lines[1]).toBe("Charlie,9.00,2026-01-03");
  });

  it("exports the raw numeric string, not a formatted money value", () => {
    const csv = buildCsv([{ ...rows[2] }], columns);
    // amount stays "100.00", no currency symbol injected
    expect(csv).toContain("100.00");
    expect(csv).not.toContain("$");
  });

  it("quotes values containing commas", () => {
    const csv = buildCsv(
      [{ name: "Doe, John", email: "", amount: "1.00", createdAt: null }],
      columns,
    );
    expect(csv).toContain('"Doe, John"');
  });

  it("neutralizes CSV formula-injection payloads (leading = + - @ tab CR)", () => {
    const payloads = [
      "=1+1",
      "+cmd|'/c calc'!A0",
      "-2+3",
      "@SUM(A1)",
      '=HYPERLINK("http://evil","Refund")',
      "\t=danger",
      "\r=danger",
    ];
    for (const p of payloads) {
      const records = rowsToCsvRecords(
        [{ name: p, email: "", amount: "1.00", createdAt: null }],
        columns,
      );
      // Sanitized cell is prefixed with a single quote so a spreadsheet treats
      // it as literal text, not a formula.
      expect(records[0].Name).toBe(`'${p}`);
    }
    // A benign leading-dash-free numeric string is untouched.
    expect(
      rowsToCsvRecords([{ name: "Alice", email: "", amount: "1.00", createdAt: null }], columns)[0]
        .Name,
    ).toBe("Alice");
  });
});
