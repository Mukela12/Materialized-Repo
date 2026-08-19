/**
 * A free period has to end.
 *
 * ── The problem this exists for ──────────────────────────────────────────────
 * `freeAccess` was a permanent boolean. A voucher set it true and the only code
 * that ever set it false was a rollback for two people racing the last seat. The
 * expiry dates on the vouchers govern when a code may be REDEEMED — they say
 * nothing about how long the access lasts.
 *
 * The client is handing 216 free-access codes to four events. Every one of them
 * would have produced an account that was never billed, and the failure is
 * silent in the worst direction: nobody writes in to complain that they are not
 * being charged. It would have surfaced as a revenue hole months later.
 *
 * Her intent: free until a fixed date per batch, then convert to the monthly
 * fee. Brooklyn and Liverpool on 31 Oct, Mozambique on 31 Dec.
 */
import { describe, it, expect } from "vitest";
import { hasFreeAccess, isEntitled } from "../../server/entitlement";

const AUG = new Date("2026-08-19T12:00:00Z");
const NOV = new Date("2026-11-15T12:00:00Z");
const OCT31 = new Date("2026-11-01T05:00:00Z"); // as applied to the Brooklyn batch

describe("free access lapses on its date", () => {
  it("is granted before the date", () => {
    expect(hasFreeAccess({ freeAccess: true, freeAccessUntil: OCT31 }, AUG)).toBe(true);
  });

  it("is gone after the date — the whole point", () => {
    expect(hasFreeAccess({ freeAccess: true, freeAccessUntil: OCT31 }, NOV)).toBe(false);
  });

  it("no end date still means open-ended, for a manual comp", () => {
    expect(hasFreeAccess({ freeAccess: true, freeAccessUntil: null }, NOV)).toBe(true);
  });

  it("means nothing without the flag", () => {
    expect(hasFreeAccess({ freeAccess: false, freeAccessUntil: null }, AUG)).toBe(false);
    expect(hasFreeAccess({ freeAccess: false, freeAccessUntil: OCT31 }, AUG)).toBe(false);
  });

  it("accepts the string form the database layer can hand back", () => {
    expect(hasFreeAccess({ freeAccess: true, freeAccessUntil: "2026-11-01T05:00:00Z" }, AUG)).toBe(true);
    expect(hasFreeAccess({ freeAccess: true, freeAccessUntil: "2026-11-01T05:00:00Z" }, NOV)).toBe(false);
  });

  /** Never lock out an account because a date failed to parse. */
  it("fails open on an unreadable date", () => {
    expect(hasFreeAccess({ freeAccess: true, freeAccessUntil: "not a date" }, NOV)).toBe(true);
  });
});

describe("the entitlement rule as a whole", () => {
  const active = { status: "active" };
  const cancelled = { status: "canceled" };

  it("a lapsed festival account must subscribe like anyone else", () => {
    const user = { freeAccess: true, freeAccessUntil: OCT31 };
    expect(isEntitled(user, null, AUG)).toBe(true);
    expect(isEntitled(user, null, NOV)).toBe(false);
  });

  it("but a lapsed account that has since subscribed keeps access", () => {
    expect(isEntitled({ freeAccess: true, freeAccessUntil: OCT31 }, active, NOV)).toBe(true);
  });

  it("admins are never locked out", () => {
    expect(isEntitled({ isAdmin: true, freeAccess: true, freeAccessUntil: OCT31 }, null, NOV)).toBe(true);
  });

  it("a cancelled subscription and a lapsed free period is no access", () => {
    expect(isEntitled({ freeAccess: true, freeAccessUntil: OCT31 }, cancelled, NOV)).toBe(false);
  });

  it("trialing counts", () => {
    expect(isEntitled({}, { status: "trialing" }, NOV)).toBe(true);
  });
});

describe("the gates actually call it", () => {
  const SRC = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../server/routes.ts"), "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /** The inline form is what allowed "free forever" to exist in two places. */
  it("no gate still ORs the raw freeAccess flag", () => {
    expect(SRC).not.toMatch(/hasActiveSubscription\s*=\s*user\.isAdmin\s*\|\|\s*!!user\.freeAccess/);
  });

  /**
   * Counts the CALLS, not an exact number of them. This asserted exactly two
   * and broke the moment isEntitled was legitimately reused by the
   * subscription prompt — a test that fails when the rule spreads to another
   * caller is punishing the thing it wants to encourage. The load-bearing
   * assertion is the one above: no gate reconstructs the rule inline.
   */
  it("the entitlement rule is called, never re-implemented", () => {
    const uses = SRC.match(/isEntitled\(user, sub\)/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });
});
