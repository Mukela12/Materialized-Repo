/**
 * The admin-granted inventory window.
 *
 * The gate has exactly two independent grants:
 *   (a) an unexpired admin window  — the "$29 paid, no subscription" case
 *   (b) an active subscription     — pre-existing behaviour, must not regress
 *
 * These tests pin the decision itself. The rule is small enough that the risk is
 * not complexity, it is someone later reordering the clauses and quietly making
 * (a) depend on an owner — which would defeat the whole point, because the brands
 * this exists for have accepted and paid but have no subscription and often no
 * owner account yet.
 */
import { describe, it, expect } from "vitest";

/** Mirrors isBrandInventoryDiscoverable in server/routes.ts. */
function discoverable(
  brand: { ownerId?: string | null; inventoryAccessUntil?: Date | null } | null,
  subscriptionStatus: string | null,
  now: Date = new Date(),
): boolean {
  if (!brand) return false;
  if (brand.inventoryAccessUntil && brand.inventoryAccessUntil.getTime() > now.getTime()) return true;
  if (!brand.ownerId) return false;
  return subscriptionStatus === "active";
}

const NOW = new Date("2026-07-29T12:00:00Z");
const future = (ms: number) => new Date(NOW.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

describe("admin-granted inventory window", () => {
  it("grants access with NO owner and NO subscription — the case it exists for", () => {
    expect(discoverable({ ownerId: null, inventoryAccessUntil: future(30 * DAY) }, null, NOW)).toBe(true);
  });

  it("expires at read time with no scheduler", () => {
    expect(discoverable({ ownerId: null, inventoryAccessUntil: future(-1) }, null, NOW)).toBe(false);
  });

  it("is exclusive at the boundary — equal to now is NOT live", () => {
    expect(discoverable({ ownerId: null, inventoryAccessUntil: NOW }, null, NOW)).toBe(false);
    expect(discoverable({ ownerId: null, inventoryAccessUntil: future(1) }, null, NOW)).toBe(true);
  });

  it("revocation (a past timestamp) removes access immediately", () => {
    expect(discoverable({ ownerId: "u1", inventoryAccessUntil: future(-1000) }, null, NOW)).toBe(false);
  });
});

describe("subscription grant is independent and must not regress", () => {
  it("an active subscription grants access with no admin window", () => {
    expect(discoverable({ ownerId: "u1", inventoryAccessUntil: null }, "active", NOW)).toBe(true);
  });

  it("an EXPIRED admin window does not veto an active subscription", () => {
    expect(discoverable({ ownerId: "u1", inventoryAccessUntil: future(-DAY) }, "active", NOW)).toBe(true);
  });

  it("a non-active subscription alone does not grant access", () => {
    for (const s of ["cancelled", "past_due", null]) {
      expect(discoverable({ ownerId: "u1", inventoryAccessUntil: null }, s, NOW)).toBe(false);
    }
  });

  it("an unowned brand with no window is not discoverable", () => {
    expect(discoverable({ ownerId: null, inventoryAccessUntil: null }, "active", NOW)).toBe(false);
  });

  it("a missing brand is never discoverable", () => {
    expect(discoverable(null, "active", NOW)).toBe(false);
  });
});
