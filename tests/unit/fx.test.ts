/**
 * In-video checkout charges in US dollars (client, 25 Oct 2026), at the day's
 * rate, and falls back to the product's own currency if no rate can be had.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chargeLabel, clearFxCache, money, toChargeAmount, usdRate } from "../../server/fx";

const ok = (rate: unknown) => (async () => new Response(JSON.stringify({ date: "2026-10-23", rates: { USD: rate } }))) as unknown as typeof fetch;
const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;

beforeEach(() => clearFxCache());

describe("the rate", () => {
  it("is 1 for dollars, without asking anyone", async () => {
    expect(await usdRate("usd", down)).toEqual({ rate: 1, date: null });
  });

  it("comes from the daily reference rates", async () => {
    expect(await usdRate("eur", ok(1.1193))).toEqual({ rate: 1.1193, date: "2026-10-23" });
  });

  it("is kept for a few hours, and a stale one beats none when the service is down", async () => {
    await usdRate("gbp", ok(1.3));
    expect(await usdRate("gbp", down)).toEqual({ rate: 1.3, date: "2026-10-23" });
  });

  it("is null for nonsense, so the sale goes ahead in the product's own currency", async () => {
    expect(await usdRate("eur", down)).toBeNull();
    expect(await usdRate("eur", ok("abc"))).toBeNull();
    expect(await usdRate("eur", ok(-2))).toBeNull();
    expect(await usdRate("euros", ok(1.1))).toBeNull();
  });
});

describe("the amount charged", () => {
  it("converts a euro price to dollars and keeps the original", () => {
    const c = toChargeAmount(4900, "eur", { rate: 1.1193, date: "2026-10-23" });
    expect(c).toEqual({ amountCents: 5485, currency: "usd", original: { amountCents: 4900, currency: "eur", rate: 1.1193, date: "2026-10-23" } });
    expect(chargeLabel(c)).toBe("$54.85 (€49.00)");
  });

  it("leaves a dollar price alone", () => {
    const c = toChargeAmount(4900, "USD", { rate: 1, date: null });
    expect(c).toEqual({ amountCents: 4900, currency: "usd", original: null });
    expect(chargeLabel(c)).toBe("$49.00");
  });

  it("charges as priced when there's no rate", () => {
    expect(toChargeAmount(4900, "gbp", null)).toEqual({ amountCents: 4900, currency: "gbp", original: null });
  });

  it("writes currencies without a symbol by code", () => {
    expect(money(4900, "chf")).toBe("CHF 49.00");
  });
});

describe("the checkout route", () => {
  const routes = readFileSync(join(__dirname, "../../server/routes.ts"), "utf8");
  it("quotes the converted amount, still read from the database", () => {
    expect(routes).toMatch(/toChargeAmount\(overlay\.priceCents, pricedIn, await usdRate\(pricedIn\)\)/);
    expect(routes).toMatch(/priceCents: charge \? charge\.amountCents : \(overlay\.priceCents \?\? null\)/);
  });
  it("records the brand's own price on the order", () => {
    expect(routes).toMatch(/pricedCurrency: charge\.original\.currency/);
  });
});
