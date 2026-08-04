/**
 * What the platform is owed, and when it is owed nothing.
 *
 * The 15% marketplace fee was computed on every verified store order and then
 * discarded — returned from computeSaleSplit(), echoed in the webhook response,
 * written nowhere. There was no row in any table to invoice a brand from.
 *
 * These tests pin the three properties that make the new ledger trustworthy
 * enough to bill from:
 *
 *   1. An unattributed sale is charged NOTHING. Billing a brand 15% of an order
 *      Materialized had no part in would be indefensible, and billing for one
 *      whose attribution broke would be charging for something we cannot
 *      evidence. The row is still written, so the breakage is visible.
 *   2. A retried webhook does not bill twice. Stores retry; the pre-existing
 *      order guard reads commission_transactions, which has no row at all for an
 *      unattributed order and so cannot protect this table.
 *   3. A refund voids the fee, and says so when the bill already went out.
 */
import { describe, it, expect } from "vitest";
import {
  buildAccrualRow,
  recordFeeAccrual,
  voidFeeAccrual,
  splitForAccrual,
  type FeeAccrualStore,
  type AccrualRow,
} from "../../server/feeAccruals";

const BASE = {
  storeConnectionId: "conn_1",
  brandUserId: "brand_1",
  externalOrderId: "order_1",
  currency: "USD",
};

/** In-memory store mirroring the real unique index and void semantics. */
function fakeStore() {
  const rows = new Map<string, any>();
  const store: FeeAccrualStore & { rows: Map<string, any> } = {
    rows,
    async createPlatformFeeAccrual(row: AccrualRow) {
      const key = `${row.storeConnectionId}::${row.externalOrderId}`;
      if (rows.has(key)) {
        const err: any = new Error("duplicate key");
        err.code = "23505";
        throw err;
      }
      rows.set(key, { id: `acc_${rows.size + 1}`, ...row, status: "accrued" });
      return { id: `acc_${rows.size}` };
    },
    async voidPlatformFeeAccrual(connId: string, orderId: string) {
      const row = rows.get(`${connId}::${orderId}`);
      if (!row) return { voided: false, alreadyVoided: false, wasInvoiced: false };
      if (row.status === "void") return { voided: false, alreadyVoided: true, wasInvoiced: false };
      const wasInvoiced = row.status === "invoiced" || row.status === "paid";
      row.status = "void";
      return { voided: true, alreadyVoided: false, wasInvoiced };
    },
  };
  return store;
}

const NOW = new Date("2026-08-04T12:00:00Z");

describe("the fee on an attributed sale", () => {
  it("records 15% of the sale, and the platform's share after commissions", () => {
    const split = splitForAccrual("100.00", { hasPublisher: true, marketplaceFeePct: 15, creatorPct: 0, publisherPct: 2 });
    const row = buildAccrualRow({ ...BASE, saleAmount: "100.00", attributionState: "attributed", split, videoId: "vid_1" }, NOW);

    expect(row.saleCents).toBe(10000);
    expect(row.marketplaceFeeCents).toBe(1500);   // 15% of the sale
    expect(row.publisherCents).toBe(200);         // 2%, paid out of the fee
    expect(row.creatorCents).toBe(0);             // 0 by design — brands pay creators directly
    expect(row.platformCents).toBe(1300);         // what's actually kept
    expect(row.marketplaceFeePct).toBe("15.00");
    expect(row.attributionState).toBe("attributed");
  });

  it("keeps no publisher share when no publisher is attributed", () => {
    const split = splitForAccrual("100.00", { hasPublisher: false, marketplaceFeePct: 15, creatorPct: 0, publisherPct: 2 });
    const row = buildAccrualRow({ ...BASE, saleAmount: "100.00", attributionState: "attributed", split }, NOW);

    expect(row.marketplaceFeeCents).toBe(1500);
    expect(row.publisherCents).toBe(0);
    expect(row.platformCents).toBe(1500); // the whole fee is margin
  });

  it("captures the rate on the row, so changing the default cannot rewrite a bill", () => {
    const split = splitForAccrual("100.00", { hasPublisher: false, marketplaceFeePct: 12.5 });
    const row = buildAccrualRow({ ...BASE, saleAmount: "100.00", attributionState: "attributed", split }, NOW);
    expect(row.marketplaceFeePct).toBe("12.50");
    expect(row.marketplaceFeeCents).toBe(1250);
  });
});

describe("the fee on a sale we cannot attribute", () => {
  // The whole point: these are recorded so the breakage is visible, but they are
  // never billed.
  for (const state of ["no_ref", "ref_unresolved", "video_missing"] as const) {
    it(`is zero for ${state}, but the sale is still recorded`, () => {
      const row = buildAccrualRow({ ...BASE, saleAmount: "250.00", attributionState: state }, NOW);

      expect(row.marketplaceFeeCents).toBe(0);
      expect(row.platformCents).toBe(0);
      expect(row.publisherCents).toBe(0);
      expect(row.marketplaceFeePct).toBe("0.00");
      // The sale itself is not lost — that is what makes the leak findable.
      expect(row.saleCents).toBe(25000);
      expect(row.attributionState).toBe(state);
    });
  }

  it("charges nothing even if a split is passed alongside a non-attributed state", () => {
    // Defends the rule at the boundary rather than trusting every caller.
    const split = splitForAccrual("100.00", { hasPublisher: true });
    const row = buildAccrualRow({ ...BASE, saleAmount: "100.00", attributionState: "no_ref", split }, NOW);
    expect(row.marketplaceFeeCents).toBe(0);
    expect(row.platformCents).toBe(0);
  });
});

describe("a retried webhook", () => {
  it("does not bill the same order twice", async () => {
    const store = fakeStore();
    const input = { ...BASE, saleAmount: "100.00", attributionState: "attributed" as const, split: splitForAccrual("100.00", { hasPublisher: true }) };

    const first = await recordFeeAccrual(store, input, NOW);
    const second = await recordFeeAccrual(store, input, NOW);

    expect(first.deduped).toBeUndefined();
    expect(second.deduped).toBe(true);
    expect(store.rows.size).toBe(1);
  });

  it("dedups unattributed orders too — the commission guard cannot see them", async () => {
    const store = fakeStore();
    const input = { ...BASE, saleAmount: "100.00", attributionState: "no_ref" as const };

    await recordFeeAccrual(store, input, NOW);
    const second = await recordFeeAccrual(store, input, NOW);

    expect(second.deduped).toBe(true);
    expect(store.rows.size).toBe(1);
  });

  it("scopes dedup per store — the same order id in two stores is two sales", async () => {
    const store = fakeStore();
    const split = splitForAccrual("100.00", { hasPublisher: false });
    await recordFeeAccrual(store, { ...BASE, storeConnectionId: "conn_a", saleAmount: "100.00", attributionState: "attributed", split }, NOW);
    const other = await recordFeeAccrual(store, { ...BASE, storeConnectionId: "conn_b", saleAmount: "100.00", attributionState: "attributed", split }, NOW);

    expect(other.deduped).toBeUndefined();
    expect(store.rows.size).toBe(2);
  });

  it("lets a real database error through instead of swallowing it as a dedup", async () => {
    const store: FeeAccrualStore = {
      async createPlatformFeeAccrual() { throw new Error("connection terminated"); },
      async voidPlatformFeeAccrual() { return { voided: false, alreadyVoided: false, wasInvoiced: false }; },
    };
    await expect(
      recordFeeAccrual(store, { ...BASE, saleAmount: "1.00", attributionState: "no_ref" }),
    ).rejects.toThrow("connection terminated");
  });
});

describe("a refund", () => {
  it("voids the fee so the brand is not invoiced for it", async () => {
    const store = fakeStore();
    const split = splitForAccrual("100.00", { hasPublisher: true });
    await recordFeeAccrual(store, { ...BASE, saleAmount: "100.00", attributionState: "attributed", split }, NOW);

    const result = await voidFeeAccrual(store, BASE.storeConnectionId, BASE.externalOrderId);

    expect(result.voided).toBe(true);
    expect(result.wasInvoiced).toBe(false);
    expect(store.rows.get("conn_1::order_1").status).toBe("void");
  });

  it("flags that a credit is owed when the fee was already invoiced", async () => {
    const store = fakeStore();
    const split = splitForAccrual("100.00", { hasPublisher: true });
    await recordFeeAccrual(store, { ...BASE, saleAmount: "100.00", attributionState: "attributed", split }, NOW);
    store.rows.get("conn_1::order_1").status = "invoiced";

    const result = await voidFeeAccrual(store, BASE.storeConnectionId, BASE.externalOrderId);

    expect(result.voided).toBe(true);
    expect(result.wasInvoiced).toBe(true); // the caller must surface this
  });

  it("is a no-op when replayed, and when the order was never accrued", async () => {
    const store = fakeStore();
    await recordFeeAccrual(store, { ...BASE, saleAmount: "10.00", attributionState: "no_ref" }, NOW);

    const first = await voidFeeAccrual(store, BASE.storeConnectionId, BASE.externalOrderId);
    const replay = await voidFeeAccrual(store, BASE.storeConnectionId, BASE.externalOrderId);
    const unknown = await voidFeeAccrual(store, BASE.storeConnectionId, "never_seen");

    expect(first.voided).toBe(true);
    expect(replay.alreadyVoided).toBe(true);
    expect(replay.voided).toBe(false);
    expect(unknown.voided).toBe(false);
    expect(unknown.alreadyVoided).toBe(false);
  });
});
