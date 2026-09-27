/**
 * The "This month" panels (round 7).
 *
 * Both dashboards were headed "This month" while the brand's numbers were
 * every analytics event on the platform (no brand filter, no date filter) and
 * the creator's were lifetime counters. Money came from a column the ingest
 * route never writes. These tests pin the replacement: scoped, month to date,
 * money from real orders, and a trend line only when there is a trend.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { monthStartUtc, daysInPeriod, fillDaily, pickCurrency, ctrOf } from "../../server/dashboardStats";
import { hasTrend, sparkPaths, cumulative } from "../../client/src/lib/sparkline";
import { formatStatMoney } from "../../client/src/lib/currency";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The body of one route handler, from its app.get line to the next app.* */
function routeBody(src: string, path: string): string {
  const start = src.indexOf(`app.get("${path}"`);
  expect(start, `route ${path} exists`).toBeGreaterThan(-1);
  const next = src.indexOf("\n  app.", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("period helpers", () => {
  it("the month starts at 00:00 UTC on the 1st", () => {
    expect(monthStartUtc(new Date("2026-09-27T13:05:00Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(monthStartUtc(new Date("2026-10-01T00:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("covers every day from the 1st through today, inclusive", () => {
    const days = daysInPeriod(new Date("2026-09-01T00:00:00Z"), new Date("2026-09-27T23:59:00Z"));
    expect(days).toHaveLength(27);
    expect(days[0]).toBe("2026-09-01");
    expect(days[26]).toBe("2026-09-27");
    expect(daysInPeriod(new Date("2026-09-01T00:00:00Z"), new Date("2026-09-01T08:00:00Z"))).toEqual(["2026-09-01"]);
  });

  it("zero-fills days with no sales and keeps the ones with sales in place", () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
    expect(fillDaily([{ day: "2026-09-03", value: 1200 }], days)).toEqual([0, 0, 1200]);
    expect(fillDaily([], days)).toEqual([0, 0, 0]);
  });

  it("never sums currencies together: the largest one headlines, all orders count", () => {
    const picked = pickCurrency([
      { currency: "eur", cents: 5000, orders: 1 },
      { currency: "usd", cents: 20000, orders: 2 },
    ]);
    expect(picked).toEqual({ currency: "USD", cents: 20000, orders: 3 });
    expect(pickCurrency([])).toEqual({ currency: "USD", cents: 0, orders: 0 });
  });

  it("click-through is 0, not NaN, with no views", () => {
    expect(ctrOf(0, 0)).toBe(0);
    expect(ctrOf(5, 2)).toBe(40);
  });
});

describe("the queries are scoped", () => {
  const src = code("server/dashboardStats.ts");

  it("brand events are limited to the brand's own products and videos", () => {
    expect(src).toMatch(/b\.owner_id = \$\{brandUserId\}/);
    expect(src).toMatch(/e\.product_id IN \(SELECT id FROM bp\)/);
    expect(src).toMatch(/e\.product_id IS NULL AND e\.video_id IN \(SELECT id FROM sv\)/);
  });

  it("creator events are limited to the creator", () => {
    expect(src).toMatch(/WHERE creator_id = \$\{creatorId\}/);
  });

  it("every query is bounded to the period", () => {
    expect(src.match(/created_at >= \$\{from\} AND [a-z.]*created_at < \$\{now\}/g)).toHaveLength(2);
    expect(src.match(/occurred_at >= \$\{from\} AND a\.occurred_at < \$\{to\}/g)).toHaveLength(2);
  });

  it("money comes from real orders: attributed, not voided", () => {
    expect(src).toMatch(/FROM platform_fee_accruals a/);
    expect(src.match(/a\.attribution_state = 'attributed'/g)).toHaveLength(2);
    expect(src.match(/a\.status <> 'void'/g)).toHaveLength(2);
    // analytics_events.revenue is never written by ingest; reading it is the old bug.
    expect(src).not.toMatch(/analytics_events[\s\S]{0,200}revenue/);
  });

  it("the brand route no longer aggregates the whole analytics table", () => {
    const body = routeBody(code("server/routes.ts"), "/api/brands/stats");
    expect(body).toMatch(/brandMonthStats\(sessionUserId\)/);
    expect(body).not.toMatch(/\.from\(analyticsEvents\)/);
  });

  it("the creator panel reads the month endpoint, not the lifetime one", () => {
    expect(routeBody(code("server/routes.ts"), "/api/analytics/month")).toMatch(/creatorMonthStats\(sessionUserId\)/);
    const page = code("client/src/pages/dashboard.tsx");
    expect(page).toMatch(/useQuery<MonthStats>\(\{\s*queryKey: \["\/api\/analytics\/month"\]/);
  });
});

describe("trend line", () => {
  it("needs at least two days with sales", () => {
    expect(hasTrend(undefined)).toBe(false);
    expect(hasTrend([0, 0, 0, 0])).toBe(false);
    expect(hasTrend([0, 120, 0, 0])).toBe(false);
    expect(hasTrend([0, 120, 0, 80])).toBe(true);
    expect(hasTrend([5, 5])).toBe(false); // too few days to call it a line
  });

  it("is drawn as the running total", () => {
    expect(cumulative([0, 120, 0, 80])).toEqual([0, 120, 120, 200]);
  });

  it("fits its box with the peak at the top and zero on the baseline", () => {
    const { line, area } = sparkPaths([0, 10], 100, 40, 2);
    expect(line).toBe("M0.00,38.00 L100.00,2.00");
    expect(area.endsWith("L100.00,40 L0.00,40 Z")).toBe(true);
  });
});

describe("headline money", () => {
  it("drops cents on whole amounts and keeps them otherwise", () => {
    expect(formatStatMoney(1240, "usd")).toBe("$1,240");
    expect(formatStatMoney(18.5, "USD")).toBe("$18.50");
    expect(formatStatMoney(300, "EUR")).toBe("€300");
    expect(formatStatMoney(0)).toBe("$0");
    expect(formatStatMoney(42, "JPY")).toBe("42 JPY");
  });
});
