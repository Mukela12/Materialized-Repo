import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

export interface TableControlsOptions<T> {
  /**
   * Values concatenated and matched (case-insensitive `includes`) against the
   * search query. Return every field a user might search by for a row.
   */
  searchFields?: (row: T) => (string | number | null | undefined)[];
  /**
   * Maps a sort key to the raw comparable value for a row. Return numbers or
   * numeric strings for numeric sort, otherwise strings. Nullish sorts last.
   */
  sortAccessors?: Record<string, (row: T) => unknown>;
  initialSort?: { key: string; dir: SortDir };
}

export interface TableControls<T> {
  query: string;
  setQuery: (q: string) => void;
  sortKey: string | null;
  sortDir: SortDir;
  /** Cycle a column: same key flips asc↔desc; new key starts descending. */
  toggleSort: (key: string) => void;
  /** The current query's rows, filtered by search then sorted. */
  rows: T[];
  /** How many rows the search matched (before/equal to `rows.length`). */
  matchedCount: number;
}

/**
 * Compare two arbitrary cell values. Numeric-aware: when both sides parse as
 * finite numbers, compare numerically (so "12.50" sorts after "9.00"), else
 * fall back to a locale-aware string compare. Nullish/empty values sort last
 * regardless of direction.
 */
export function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // nulls last
  if (bEmpty) return -1;

  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) {
    return an - bn;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Pure filter+sort applied to a row array. Exported for unit testing; the hook
 * wraps it in `useMemo`.
 */
export function processRows<T>(
  rows: T[],
  opts: {
    query: string;
    searchFields?: (row: T) => (string | number | null | undefined)[];
    sortKey: string | null;
    sortDir: SortDir;
    sortAccessors?: Record<string, (row: T) => unknown>;
  },
): T[] {
  let out = rows;

  const q = opts.query.trim().toLowerCase();
  if (q && opts.searchFields) {
    out = out.filter((row) =>
      opts
        .searchFields!(row)
        .some((f) => f != null && String(f).toLowerCase().includes(q)),
    );
  }

  if (opts.sortKey && opts.sortAccessors?.[opts.sortKey]) {
    const accessor = opts.sortAccessors[opts.sortKey];
    const dir = opts.sortDir === "asc" ? 1 : -1;
    // Copy before sorting so we never mutate the query cache array in place.
    out = [...out].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      // Keep empty/nullish values last regardless of sort direction, so the
      // direction toggle never floats blanks to the top.
      const aEmpty = av == null || av === "";
      const bEmpty = bv == null || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      return compareValues(av, bv) * dir;
    });
  }

  return out;
}

/**
 * Reusable client-side table controls: search across columns + click-to-sort
 * (asc/desc). Pure `useMemo` over the passed rows — no server round-trip, works
 * identically for `<table>` rows and card grids.
 */
export function useTableControls<T>(
  data: T[],
  options: TableControlsOptions<T> = {},
): TableControls<T> {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(
    options.initialSort?.key ?? null,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    options.initialSort?.dir ?? "desc",
  );

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !options.searchFields) return data;
    return data.filter((row) =>
      options
        .searchFields!(row)
        .some((f) => f != null && String(f).toLowerCase().includes(q)),
    );
  }, [data, query, options.searchFields]);

  const rows = useMemo(
    () =>
      processRows(data, {
        query,
        searchFields: options.searchFields,
        sortKey,
        sortDir,
        sortAccessors: options.sortAccessors,
      }),
    [data, query, sortKey, sortDir, options.searchFields, options.sortAccessors],
  );

  return {
    query,
    setQuery,
    sortKey,
    sortDir,
    toggleSort,
    rows,
    matchedCount: matched.length,
  };
}
