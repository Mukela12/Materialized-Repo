/**
 * Every field createVoucher accepts must actually be written to the row.
 *
 * ── The bug this exists for ──────────────────────────────────────────────────
 * `batchId` and `assignedTo` were added to the schema, the migration, the API
 * and the UI. The route passed them. Eighty vouchers were minted and every one
 * of them stored NULL for both, because DatabaseStorage.createVoucher builds
 * its insert by naming columns one at a time and the two new names were never
 * added to that list.
 *
 * Nothing caught it:
 *   - the compiler could not, because the call site had `as any` on it and the
 *     method's parameter is `any`;
 *   - Drizzle could not, because both columns are nullable, so omitting them is
 *     a legal insert;
 *   - the unit tests could not, because MemStorage spreads the whole object and
 *     therefore stores fields DatabaseStorage silently drops. The fake was MORE
 *     capable than the real thing, which is the worst way for a fake to differ.
 *
 * It surfaced only by minting a real batch and looking at the table. This test
 * makes the next one fail in CI instead: it reads the source, takes the field
 * names from the IStorage signature — the declared contract — and requires each
 * to appear as a key in the real insert.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "../../server/storage.ts"), "utf8");

/** The `createVoucher(v: { ... })` parameter shape declared on IStorage. */
function declaredFields(): string[] {
  const sig = SRC.slice(SRC.indexOf("createVoucher(v: {"));
  const body = sig.slice(sig.indexOf("{"), sig.indexOf("}): Promise<Voucher>;"));
  return [...body.matchAll(/(?:^|[;{\n])\s*([a-zA-Z]\w*)\s*:/g)].map((m) => m[1]);
}

/** The keys of the object handed to db.insert(vouchers).values({ ... }). */
function insertedKeys(): string[] {
  const at = SRC.indexOf("db.insert(vouchers).values({");
  const body = SRC.slice(at, SRC.indexOf("}).returning();", at));
  return [...body.matchAll(/^\s{6}([a-zA-Z]\w*):/gm)].map((m) => m[1]);
}

describe("createVoucher writes every field it accepts", () => {
  it("finds both the declaration and the insert, so the test cannot pass vacuously", () => {
    expect(declaredFields().length).toBeGreaterThan(5);
    expect(insertedKeys().length).toBeGreaterThan(5);
  });

  it("inserts every field the interface declares", () => {
    const inserted = new Set(insertedKeys());
    const missing = declaredFields().filter((f) => !inserted.has(f));
    expect(missing, `declared on IStorage but never written: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("names the two that were actually lost, so a rewrite cannot quietly drop them", () => {
    const inserted = insertedKeys();
    expect(inserted).toContain("batchId");
    expect(inserted).toContain("assignedTo");
  });
});
