/**
 * The creator dashboard (client, 16 Nov 2026): period maths, where a sale
 * came from, currency, averages per video, and Paid vs Upcoming payouts.
 * See server/creatorDashboard.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  parseDashboardQuery, previousWindow, bucketUnit, bucketKeys, classifySaleSource, convertCents, perVideo,
  foldWindow, buildTotals, totalsForSet, emptyFacts, firstCategory, videosInPeriod, sortVideoRows, videoRow,
  nextApprovalRun, nextPayoutRun, expectedPayoutDate, buildPayouts, rate, topProducts, topSources, type WindowRows,
} from "../../server/creatorDashboard";
import { pctChange, formatWatchDuration } from "../../shared/creatorDashboard";

const NOW = new Date("2026-11-16T12:00:00Z"); // a Monday
const ME = "creator-1";
const empty = (): WindowRows => ({ events: [], watch: [], reposts: [], sales: [], commissions: [] });

describe("the period", () => {
  it("defaults to the last 30 days, in US dollars, every category", () => {
    const q = parseDashboardQuery({}, NOW);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.value.to.toISOString()).toBe(NOW.toISOString());
    expect(q.value.from.toISOString()).toBe("2026-10-17T12:00:00.000Z");
    expect(q.value).toMatchObject({ category: null, currency: "usd" });
  });

  it("takes a custom range, a category and a currency", () => {
    const q = parseDashboardQuery({ from: "2026-11-01T00:00:00Z", to: "2026-11-08T00:00:00Z", category: "Fashion", currency: "EUR" }, NOW);
    expect(q).toMatchObject({ ok: true, value: { category: "fashion", currency: "eur" } });
  });

  it("brings an end in the future back to now", () => {
    const q = parseDashboardQuery({ from: "2026-11-10T00:00:00Z", to: "2026-11-17T00:00:00Z" }, NOW);
    expect(q.ok && q.value.to.toISOString()).toBe(NOW.toISOString());
  });

  it("refuses a backwards range, a nonsense date, a huge range, an unknown category or currency", () => {
    expect(parseDashboardQuery({ from: "2026-11-10", to: "2026-11-01" }, NOW).ok).toBe(false);
    expect(parseDashboardQuery({ from: "yesterday" }, NOW).ok).toBe(false);
    expect(parseDashboardQuery({ from: "2024-01-01", to: "2026-01-01" }, NOW).ok).toBe(false);
    expect(parseDashboardQuery({ category: "crypto" }, NOW).ok).toBe(false);
    expect(parseDashboardQuery({ currency: "jpy" }, NOW).ok).toBe(false);
  });

  it("'all' means no category filter", () => {
    const q = parseDashboardQuery({ category: "all" }, NOW);
    expect(q.ok && q.value.category).toBeNull();
  });

  it("compares with the same length of time just before", () => {
    const p = previousWindow(new Date("2026-11-09T00:00:00Z"), new Date("2026-11-16T00:00:00Z"));
    expect(p.from.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("charts by the hour for a day, by the day otherwise", () => {
    const day = new Date(NOW.getTime() - 86_400_000);
    expect(bucketUnit(day, NOW)).toBe("hour");
    expect(bucketKeys(day, NOW, "hour")).toHaveLength(24);
    expect(bucketKeys(day, NOW, "hour")[0]).toBe("2026-11-15T12");
    const week = new Date("2026-11-09T12:00:00Z");
    expect(bucketUnit(week, NOW)).toBe("day");
    expect(bucketKeys(week, NOW, "day")).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16",
    ]);
  });
});

describe("where a sale came from", () => {
  it("no publisher, or the creator's own link, is their own audience", () => {
    expect(classifySaleSource(null, ME, null)).toBe("own");
    expect(classifySaleSource(ME, ME, "creator")).toBe("own");
  });

  it("a brand account's repost is a brand repost; anyone else is a Publisher", () => {
    expect(classifySaleSource("b1", ME, "brand")).toBe("brand");
    expect(classifySaleSource("p1", ME, "affiliate")).toBe("publisher");
    expect(classifySaleSource("c2", ME, "creator")).toBe("publisher");
    expect(classifySaleSource("gone", ME, null)).toBe("publisher");
  });
});

describe("currency", () => {
  const rates = { eur: 1.1, gbp: 1.25 };
  it("converts through US dollars", () => {
    expect(convertCents(1000, "usd", "usd", rates)).toBe(1000);
    expect(convertCents(1000, "eur", "usd", rates)).toBe(1100);
    expect(convertCents(1100, "usd", "eur", rates)).toBe(1000);
    expect(convertCents(1000, "eur", "gbp", rates)).toBe(880);
  });

  it("says so when a rate is missing rather than guessing", () => {
    expect(convertCents(1000, "chf", "usd", rates)).toBeNull();
  });
});

describe("adding up a period", () => {
  const rows: WindowRows = {
    events: [
      { video_id: "v1", t: "2026-11-15", views: 10, clicks: 2 },
      { video_id: "v2", t: "2026-11-16", views: 30, clicks: 4 },
    ],
    watch: [
      { video_id: "v1", t: "2026-11-15", sessions: 2, completed: 1, seconds: 50, video_seconds: 80 },
      { video_id: "v2", t: "2026-11-16", sessions: 2, completed: 0, seconds: 30, video_seconds: 120 },
    ],
    reposts: [
      { video_id: "v1", t: "2026-11-15", role: "brand", n: 1 },
      { video_id: "v1", t: "2026-11-15", role: "affiliate", n: 2 },
    ],
    sales: [
      { k: "a:1", video_id: "v1", t: "2026-11-15", cents: 10000, currency: "usd", publisher_id: null, role: null },
      { k: "a:2", video_id: "v1", t: "2026-11-15", cents: 5000, currency: "eur", publisher_id: "p1", role: "affiliate" },
      { k: "o:3", video_id: "v2", t: "2026-11-16", cents: 2000, currency: "usd", publisher_id: "b1", role: "brand" },
      // The same sale twice is still one sale.
      { k: "o:3", video_id: "v2", t: "2026-11-16", cents: 2000, currency: "usd", publisher_id: "b1", role: "brand" },
    ],
    commissions: [
      { video_id: "v1", t: "2026-11-15", currency: "usd", cents: 500 },
      { video_id: "elsewhere", t: "2026-11-15", currency: "usd", cents: 200 },
    ],
  };
  const folded = foldWindow(rows, ME, "usd", { eur: 1.2 });

  it("counts each sale once, by source, converted to the chosen currency", () => {
    const v1 = folded.perVideo.get("v1")!;
    expect(v1.sales).toEqual({ own: 1, publisher: 1, brand: 0, total: 2 });
    expect(v1.grossCents).toBe(10000 + 6000);
    expect(folded.perVideo.get("v2")!.sales).toEqual({ own: 0, publisher: 0, brand: 1, total: 1 });
    expect(folded.approximate).toBe(false);
  });

  it("builds the chart series per bucket", () => {
    expect(folded.series.get("2026-11-15")).toEqual({ t: "2026-11-15", views: 10, clicks: 2, sales: 2, grossCents: 16000 });
    expect(folded.series.get("2026-11-16")).toEqual({ t: "2026-11-16", views: 30, clicks: 4, sales: 1, grossCents: 2000 });
  });

  it("averages per video and per viewing", () => {
    const t = totalsForSet(folded.perVideo, new Set(["v1", "v2"]), 4);
    expect(t).toMatchObject({
      views: 40, clicks: 6, ctr: 15, watchSessions: 4, watchSeconds: 80, avgViewSeconds: 20, avgCompletionPct: 40,
      completionRate: 25, conversionRate: 50,
      reposts: 3, repostsByBrand: 1, repostsByPublisher: 2,
      sales: { own: 1, publisher: 1, brand: 1, total: 3 }, grossCents: 18000,
    });
    expect(t.avg).toEqual({
      clicksPerVideo: 1.5, repostsPerVideo: 0.8, ownSalesPerVideo: 0.3, publisherSalesPerVideo: 0.3, brandSalesPerVideo: 0.3,
      grossPerVideoCents: 4500, orderValueCents: 6000,
    });
  });

  it("counts commission earned on someone else's video, and nothing else from it", () => {
    const t = totalsForSet(folded.perVideo, new Set(["v1", "v2"]), 2);
    expect(t.commissionCents).toBe(700);
    expect(t.views).toBe(40);
  });

  it("marks the result approximate when a currency cannot be converted", () => {
    const f = foldWindow({ ...empty(), sales: [{ k: "a:9", video_id: "v1", t: "x", cents: 100, currency: "chf", publisher_id: null, role: null }] }, ME, "usd", {});
    expect(f.approximate).toBe(true);
    expect(f.perVideo.get("v1")!.grossCents).toBe(100);
  });

  it("an empty period is all zeros, never NaN", () => {
    const t = buildTotals([], 0);
    expect(t.avgViewSeconds).toBe(0);
    expect(t.ctr).toBe(0);
    expect(Object.values(t.avg).every((n) => n === 0)).toBe(true);
    expect(perVideo(5, 0)).toBe(0);
  });
});

describe("rates", () => {
  it("are percentages to one decimal place, 0 with nothing to divide by", () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(5, 0)).toBe(0);
  });

  it("conversion never reads above 100% when sales arrive without a tracked click", () => {
    const f = { ...emptyFacts(), clicks: 1, sales: { own: 3, publisher: 0, brand: 0, total: 3 } };
    expect(buildTotals([f], 1).conversionRate).toBe(100);
  });
});

describe("top products", () => {
  const same = (c: number) => c;

  it("ranks by sales, then sales value, and carries the clicks", () => {
    const list = topProducts({
      sales: [
        { key: "p1", name: "Blazer", cents: 10900, currency: "usd" },
        { key: "p1", name: "Blazer", cents: 8900, currency: "usd" },
        { key: "p2", name: "Boots", cents: 26000, currency: "usd" },
        { key: "card:9", name: null, cents: 100, currency: "usd" },
      ],
      clicks: [{ key: "p2", name: "Boots", n: 8 }, { key: "p1", name: "Blazer", n: 7 }, { key: "p3", name: "Hoops", n: 30 }],
    }, same);
    expect(list.map((p) => [p.name, p.sales, p.grossCents, p.clicks])).toEqual([
      ["Blazer", 2, 19800, 7], ["Boots", 1, 26000, 8], ["Unnamed product", 1, 100, 0], ["Hoops", 0, 0, 30],
    ]);
  });

  it("with no sales, ranks by clicks, and stops at five", () => {
    const clicks = Array.from({ length: 7 }, (_, i) => ({ key: `p${i}`, name: `P${i}`, n: i }));
    const list = topProducts({ sales: [], clicks }, same);
    expect(list.map((p) => p.name)).toEqual(["P6", "P5", "P4", "P3", "P2"]);
  });

  it("converts each sale into the chosen currency", () => {
    const list = topProducts({ sales: [{ key: "p1", name: "A", cents: 1000, currency: "eur" }], clicks: [] }, (c, cur) => (cur === "eur" ? c * 2 : c));
    expect(list[0].grossCents).toBe(2000);
  });
});

describe("where views come from", () => {
  it("top five with each one's share, direct and unknown merged into one line", () => {
    const rows = [
      { label: "styleweekly.example", n: 40 }, { label: "", n: 10 }, { label: null, n: 10 },
      { label: "a.example", n: 5 }, { label: "b.example", n: 5 }, { label: "c.example", n: 4 }, { label: "d.example", n: 1 },
    ];
    const top = topSources(rows, 75);
    expect(top).toHaveLength(5);
    expect(top[0]).toEqual({ label: "styleweekly.example", views: 40, sharePct: 53.3 });
    expect(top[1]).toEqual({ label: null, views: 20, sharePct: 26.7 });
    expect(top.map((r) => r.label)).not.toContain("d.example");
  });

  it("nothing yet is an empty list", () => {
    expect(topSources([], 0)).toEqual([]);
  });
});

describe("which videos the averages divide by", () => {
  const videos = [
    { id: "pub", title: "B", thumbnail_url: null, categories: '["travel"]', status: "published", created_at: "2026-10-01T00:00:00Z" },
    { id: "later", title: "C", thumbnail_url: null, categories: null, status: "published", created_at: "2026-12-01T00:00:00Z" },
    { id: "draft", title: "A", thumbnail_url: null, categories: "not json", status: "draft", created_at: "2026-10-01T00:00:00Z" },
  ];

  it("published by the end of the period, or active in it", () => {
    expect(videosInPeriod(videos, NOW, new Set()).map((v) => v.id)).toEqual(["pub"]);
    expect(videosInPeriod(videos, NOW, new Set(["draft"])).map((v) => v.id)).toEqual(["pub", "draft"]);
  });

  it("reads the first category and survives bad data", () => {
    expect(firstCategory('["fashion","eco"]')).toBe("fashion");
    expect(firstCategory("not json")).toBeNull();
    expect(firstCategory(null)).toBeNull();
  });

  it("lists best sellers first", () => {
    const a = videoRow(videos[0], { ...emptyFacts(), views: 100 });
    const b = videoRow(videos[2], { ...emptyFacts(), grossCents: 500, sales: { own: 1, publisher: 0, brand: 0, total: 1 } });
    expect(sortVideoRows([a, b]).map((r) => r.videoId)).toEqual(["draft", "pub"]);
  });
});

describe("payouts", () => {
  it("runs on Mondays at 09:00 UTC, after the daily 08:00 hold release", () => {
    expect(nextPayoutRun(new Date("2026-11-16T08:00:00Z")).toISOString()).toBe("2026-11-16T09:00:00.000Z");
    expect(nextPayoutRun(new Date("2026-11-16T09:30:00Z")).toISOString()).toBe("2026-11-23T09:00:00.000Z");
    expect(nextApprovalRun(new Date("2026-12-10T07:00:00Z")).toISOString()).toBe("2026-12-10T08:00:00.000Z");
    expect(nextApprovalRun(new Date("2026-12-10T08:01:00Z")).toISOString()).toBe("2026-12-11T08:00:00.000Z");
  });

  it("an approved amount is paid on the next run; a held one after its 30 days", () => {
    expect(expectedPayoutDate("approved", new Date("2026-10-01T10:00:00Z"), NOW, 30).toISOString().slice(0, 10)).toBe("2026-11-23");
    // Sold Tue 10 Nov 10:00: payable 10 Dec 10:00, released 11 Dec 08:00, paid Mon 14 Dec.
    expect(expectedPayoutDate("pending", new Date("2026-11-10T10:00:00Z"), NOW, 30).toISOString().slice(0, 10)).toBe("2026-12-14");
    // A hold that ended before the release job ran goes out with the next run after it does.
    expect(expectedPayoutDate("pending", new Date("2026-10-01T10:00:00Z"), NOW, 30).toISOString().slice(0, 10)).toBe("2026-11-23");
  });

  it("splits the period's earnings into Paid and Upcoming, and lists every upcoming amount by date", () => {
    const window = { from: new Date("2026-10-17T12:00:00Z"), to: NOW };
    const p = buildPayouts([
      { created_at: "2026-11-10T10:00:00Z", status: "pending", cents: 445, currency: "usd", bonus: false },
      { created_at: "2026-11-11T10:00:00Z", status: "pending", cents: 1000, currency: "eur", bonus: false },
      { created_at: "2026-11-01T10:00:00Z", status: "paid", cents: 295, currency: "usd", bonus: false },
      { created_at: "2026-11-02T10:00:00Z", status: "approved", cents: 1245, currency: "usd", bonus: true },
      // Earned before the period and not yet paid: upcoming, but not this period's.
      { created_at: "2026-10-01T10:00:00Z", status: "approved", cents: 245, currency: "usd", bonus: false },
      { created_at: "2026-11-03T10:00:00Z", status: "reversed", cents: 9999, currency: "usd", bonus: false },
    ], window, NOW, (c, cur) => (cur === "eur" ? Math.round(c * 1.1) : c), 30);
    expect(p).toMatchObject({ paidCents: 295, upcomingCents: 445 + 1100 + 1245, totalCents: 295 + 445 + 1100 + 1245, bonusCents: 1245, allUpcomingCents: 445 + 1100 + 1245 + 245 });
    expect(p.upcomingList).toEqual([
      { date: "2026-11-23", amountCents: 1245 + 245, items: 2 },
      { date: "2026-12-14", amountCents: 445 + 1100, items: 2 },
    ]);
  });

  it("nothing earned reads as zero with an empty list", () => {
    const p = buildPayouts([], { from: NOW, to: NOW }, NOW, (c) => c, 30);
    expect(p).toMatchObject({ totalCents: 0, paidCents: 0, upcomingCents: 0, upcomingList: [] });
  });
});

describe("shared helpers", () => {
  it("compares with the previous period, and stays quiet with nothing to compare", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(5, 0)).toBeNull();
  });

  it("formats a watch duration", () => {
    expect(formatWatchDuration(0)).toBe("0s");
    expect(formatWatchDuration(42)).toBe("42s");
    expect(formatWatchDuration(65)).toBe("1m 05s");
    expect(formatWatchDuration(3720)).toBe("1h 02m");
  });
});

describe("the route", () => {
  const routes = readFileSync(join(__dirname, "../../server/routes.ts"), "utf8");
  const start = routes.indexOf('app.get("/api/creator/dashboard"');
  const body = routes.slice(start, routes.indexOf("\n  app.", start + 10));

  it("needs a signed-in account and only ever reads that account's own videos", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/if \(!sessionUserId\) return res\.status\(401\)/);
    expect(body).toMatch(/creatorDashboard\(user\.id, q\.value\)/);
    expect(body).not.toMatch(/req\.query\.(creatorId|userId)/);
  });
});
