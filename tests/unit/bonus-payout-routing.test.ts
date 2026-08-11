/**
 * Subscription bonuses are paid by the SAME engine as sale commissions.
 *
 * ── Why they share an engine ─────────────────────────────────────────────────
 * A creator owed $8 of commission and $12.45 of bonus should get one $20.45
 * transfer, not two: Stripe charges per transfer, and two payouts for one period
 * is a support question every month. It also means the minimum-payout threshold
 * applies to what the creator is actually owed rather than to each source
 * separately — otherwise someone owed $0.30 from each source is paid nothing,
 * twice, forever.
 *
 * ── The risk that comes with it ──────────────────────────────────────────────
 * Two tables behind one list of ids. Both use uuids, so nothing distinguishes
 * them except the prefix, and a mis-route means marking the WRONG table paid —
 * leaving real rows still "approved" to be paid a second time on the next run.
 * That is the failure these tests exist for.
 */
import { describe, it, expect } from "vitest";
import { planPayouts, BONUS_ID_PREFIX } from "../../server/payouts";

/** The split the runner performs before marking each table. */
function route(ids: string[]) {
  return {
    bonusIds: ids.filter((i) => i.startsWith(BONUS_ID_PREFIX)).map((i) => i.slice(BONUS_ID_PREFIX.length)),
    commissionIds: ids.filter((i) => !i.startsWith(BONUS_ID_PREFIX)),
  };
}

describe("routing ids back to their table", () => {
  it("separates bonus ids from commission ids", () => {
    const out = route(["c1", `${BONUS_ID_PREFIX}b1`, "c2", `${BONUS_ID_PREFIX}b2`]);
    expect(out.commissionIds).toEqual(["c1", "c2"]);
    expect(out.bonusIds).toEqual(["b1", "b2"]);
  });

  it("strips the prefix, so the id matches the row it came from", () => {
    // Marking "bonus:abc" would match nothing and leave the row approved — paid
    // again on the next run.
    const id = "9f8e7d6c-1234-4321-abcd-000000000001";
    expect(route([`${BONUS_ID_PREFIX}${id}`]).bonusIds).toEqual([id]);
  });

  it("loses nothing — every id lands in exactly one bucket", () => {
    const ids = ["c1", `${BONUS_ID_PREFIX}b1`, "c2", `${BONUS_ID_PREFIX}b2`, "c3"];
    const out = route(ids);
    expect(out.commissionIds.length + out.bonusIds.length).toBe(ids.length);
  });

  it("uses a prefix a uuid cannot start with", () => {
    // If a raw commission uuid could begin with the prefix, it would be routed
    // to the bonus table and never marked paid.
    expect(BONUS_ID_PREFIX).toMatch(/[^0-9a-f-]/);
    expect(/^[0-9a-f-]+$/i.test(BONUS_ID_PREFIX)).toBe(false);
  });
});

describe("batching a creator's two sources into one transfer", () => {
  it("sums commission and bonus into a single payout group", () => {
    const plan = planPayouts([
      { id: "c1", affiliateId: "creator-1", commissionAmount: "8.00", status: "approved" },
      { id: `${BONUS_ID_PREFIX}b1`, affiliateId: "creator-1", commissionAmount: "12.45", status: "approved" },
    ]);
    expect(plan.payable).toHaveLength(1);
    expect(plan.payable[0].amountCents).toBe(2045);
    expect(plan.payable[0].commissionIds.sort()).toEqual(["bonus:b1", "c1"]);
  });

  it("clears the minimum on the combined total, not each source", () => {
    // 30c + 30c is above the 50c minimum; separately neither would ever pay.
    const plan = planPayouts([
      { id: "c1", affiliateId: "creator-1", commissionAmount: "0.30", status: "approved" },
      { id: `${BONUS_ID_PREFIX}b1`, affiliateId: "creator-1", commissionAmount: "0.30", status: "approved" },
    ], 50);
    expect(plan.payable).toHaveLength(1);
    expect(plan.payable[0].amountCents).toBe(60);
  });

  it("keeps different creators apart", () => {
    const plan = planPayouts([
      { id: "c1", affiliateId: "creator-1", commissionAmount: "8.00", status: "approved" },
      { id: `${BONUS_ID_PREFIX}b1`, affiliateId: "creator-2", commissionAmount: "12.45", status: "approved" },
    ]);
    expect(plan.payable.map((g) => g.affiliateId).sort()).toEqual(["creator-1", "creator-2"]);
  });

  it("ignores a reversed bonus, so a refunded one is never transferred", () => {
    const plan = planPayouts([
      { id: `${BONUS_ID_PREFIX}b1`, affiliateId: "creator-1", commissionAmount: "12.45", status: "reversed" },
    ]);
    expect(plan.payable).toHaveLength(0);
    expect(plan.heldBelowThreshold).toHaveLength(0);
  });
});
