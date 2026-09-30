/**
 * The admin-granted inventory window.
 *
 * The gate has exactly two independent grants:
 *   (a) an unexpired admin window  — the "$29 paid, no subscription" case
 *   (b) an active subscription     — pre-existing behavior, must not regress
 *
 * These tests pin the decision itself. The rule is small enough that the risk is
 * not complexity, it is someone later reordering the clauses and quietly making
 * (a) depend on an owner — which would defeat the whole point, because the brands
 * this exists for have accepted and paid but have no subscription and often no
 * owner account yet.
 */
import { describe, it, expect } from "vitest";

import { inventoryDiscoverable } from "../../server/inventoryAccess";

/** The real rule, for a brand whose owner has no free window. */
function discoverable(
  brand: { ownerId?: string | null; inventoryAccessUntil?: Date | null } | null,
  subscriptionStatus: string | null,
  now: Date = new Date(),
): boolean {
  return inventoryDiscoverable(brand, null, subscriptionStatus, now);
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

describe("the owner's free window opens the catalog (voucher and trial brands, 30 Sep 2026)", () => {
  const brand = { ownerId: "u1", inventoryAccessUntil: null };
  const until = (ms: number) => ({ role: "brand", freeAccess: true, freeAccessUntil: future(ms) });

  it("a Brooklyn voucher brand with no subscription is discoverable until its date", () => {
    expect(inventoryDiscoverable(brand, until(30 * DAY), null, NOW)).toBe(true);
  });

  it("and stops being discoverable the moment the window lapses", () => {
    expect(inventoryDiscoverable(brand, until(-1), null, NOW)).toBe(false);
  });

  it("a brand on the 14-day trial is discoverable (the trial is the same window)", () => {
    expect(inventoryDiscoverable(brand, until(14 * DAY), "canceled", NOW)).toBe(true);
  });

  it("an open-ended admin comp (no end date) counts, as it does for access", () => {
    expect(inventoryDiscoverable(brand, { role: "brand", freeAccess: true, freeAccessUntil: null }, null, NOW)).toBe(true);
  });

  it("the platform's own admin-owned brand counts", () => {
    expect(inventoryDiscoverable(brand, { isAdmin: true }, null, NOW)).toBe(true);
  });

  it("an owner with no window, no subscription and no admin role does not", () => {
    expect(inventoryDiscoverable(brand, { freeAccess: false }, null, NOW)).toBe(false);
    expect(inventoryDiscoverable(brand, undefined, null, NOW)).toBe(false);
  });

  it("the live check reads the owner as well as the subscription", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(require.resolve("../../server/inventoryAccess.ts"), "utf8");
    expect(src).toMatch(/storage\.getUser\(brand\.ownerId\)/);
    expect(src).toMatch(/return inventoryDiscoverable\(brand, owner, sub\?\.status\);/);
  });

  it("a creator's trial window does not make a brand they created discoverable", () => {
    expect(inventoryDiscoverable(brand, { role: "creator", freeAccess: true, freeAccessUntil: future(14 * DAY) }, null, NOW)).toBe(false);
  });

  it("from 2027 a voucher brand that owes a card loses its catalog with its access", () => {
    const jan2027 = new Date("2027-01-02T12:00:00Z");
    const owner = { role: "brand", freeAccess: true, freeAccessUntil: new Date("2027-03-01T05:00:00Z"), overageCardRequired: true, cardOnFile: false };
    expect(inventoryDiscoverable(brand, owner, null, jan2027)).toBe(false);
    expect(inventoryDiscoverable(brand, { ...owner, cardOnFile: true }, null, jan2027)).toBe(true);
    // Before the rule wakes, the missing card does not matter.
    expect(inventoryDiscoverable(brand, owner, null, NOW)).toBe(true);
  });
});
