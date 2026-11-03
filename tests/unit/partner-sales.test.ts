/**
 * The partner Sales view (server/partnerSales.ts): how one sale is shown to
 * the partner, when a referral stops earning, and what the totals count.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { shapeSale, shapeReferral, totalsOf, type PartnerSale } from "../../server/partnerSales";

const row = (over: Partial<Parameters<typeof shapeSale>[0]> = {}) => ({
  id: "c1", created_at: "2026-11-12T14:05:00Z", sale_amount: "100.00", commission_rate: "2.00", commission_amount: "2.00",
  status: "pending", video_title: "Spring look", product_name: "Silk dress", brand_name: "Pilot Brand", creator_name: "Ana",
  creator_amount: "5.00", publisher_amount: "0", other_partners: "0", via_creator: true, via_brand: false, ...over,
});

describe("shapeSale", () => {
  it("shows the $100 bonus sale the way the engine split it", () => {
    const s = shapeSale(row(), 15);
    expect(s).toMatchObject({ saleCents: 10000, brandCents: 8500, creatorCents: 500, publisherCents: 0, youCents: 200, youPct: 2, mtrlzdCents: 800, through: "creator" });
  });

  it("with a publisher, the partner's trimmed 1% and MTRLZD's $7", () => {
    const s = shapeSale(row({ commission_rate: "1.00", commission_amount: "1.00", publisher_amount: "2.00", via_brand: true }), 15);
    expect(s).toMatchObject({ brandCents: 8500, creatorCents: 500, publisherCents: 200, youCents: 100, mtrlzdCents: 700, through: "both" });
  });

  it("counts other partners on the sale out of MTRLZD's part, not the brand's", () => {
    const s = shapeSale(row({ creator_amount: "0", other_partners: "2.00", via_creator: false, via_brand: true }), 15);
    expect(s).toMatchObject({ brandCents: 8500, otherPartnersCents: 200, youCents: 200, mtrlzdCents: 1100, through: "brand" });
  });

  it("a held share is payable 30 days after the sale; others carry no date", () => {
    expect(shapeSale(row(), 15).payableAt).toBe("2026-12-12T14:05:00.000Z");
    expect(shapeSale(row({ status: "approved" }), 15).payableAt).toBeNull();
    expect(shapeSale(row({ status: "paid" }), 15).payableAt).toBeNull();
  });

  it("every share adds back up to the sale", () => {
    const s = shapeSale(row({ sale_amount: "49.99", commission_amount: "1.00", creator_amount: "2.50", publisher_amount: "1.00" }), 15);
    expect(s.brandCents + s.creatorCents + s.publisherCents + s.otherPartnersCents + s.youCents + s.mtrlzdCents).toBe(s.saleCents);
  });
});

describe("shapeReferral", () => {
  const now = new Date("2027-02-08T10:30:00Z");

  it("earns for 90 days from when it joined, then ends", () => {
    const r = shapeReferral({ user_id: "u", name: "Clipper A", role: "creator", joined_at: "2026-11-10T10:00:00Z", counts_from: "2026-11-10T10:00:00Z", via_brand: null }, now, 90);
    expect(r.earnsUntil).toBe("2027-02-08T10:00:00.000Z");
    expect(r.earning).toBe(false);
    expect(shapeReferral({ user_id: "u", name: "A", role: "creator", joined_at: "2026-11-10T10:00:00Z", counts_from: "2026-11-10T10:00:00Z", via_brand: null }, new Date("2027-02-08T09:59:00Z"), 90).earning).toBe(true);
  });

  it("a creator on a brand's invite counts from the brand", () => {
    const r = shapeReferral({ user_id: "b", name: "Clipper B", role: "creator", joined_at: "2026-12-01T10:00:00Z", counts_from: "2026-11-09T10:00:00Z", via_brand: "Pilot Brand" }, now, 90);
    expect(r.earnsUntil).toBe("2027-02-07T10:00:00.000Z");
    expect(r.earning).toBe(false);
    expect(r.viaBrand).toBe("Pilot Brand");
  });

  it("names roles the way partners know them", () => {
    const base = { user_id: "x", name: null, joined_at: now, counts_from: now, via_brand: null };
    expect(shapeReferral({ ...base, role: "affiliate" }, now).role).toBe("publisher");
    expect(shapeReferral({ ...base, role: "brand" }, now).role).toBe("brand");
    expect(shapeReferral({ ...base, role: "brand" }, now).name).toBe("Unnamed account");
  });
});

describe("totalsOf", () => {
  const s = (status: string, you: number): PartnerSale => ({
    id: status, at: "", video: "", product: null, brand: null, creator: null, through: null,
    saleCents: 10000, brandCents: 8500, creatorCents: 0, publisherCents: 0, otherPartnersCents: 0,
    youCents: you, youPct: 2, mtrlzdCents: 0, status, payableAt: null,
  });

  it("leaves refunded and rejected sales out", () => {
    expect(totalsOf([s("pending", 200), s("approved", 200), s("paid", 200), s("reversed", 200), s("rejected", 200)]))
      .toEqual({ sales: 3, saleCents: 30000, youCents: 600, pendingCents: 400, paidCents: 200, nextPayableAt: null });
  });

  it("gives the earliest day a held share becomes payable", () => {
    const held = (at: string | null) => ({ ...s("pending", 200), payableAt: at });
    expect(totalsOf([held("2026-12-20T10:00:00.000Z"), held("2026-12-12T14:05:00.000Z"), s("approved", 200)]).nextPayableAt).toBe("2026-12-12T14:05:00.000Z");
  });
});
