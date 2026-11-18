/**
 * Watch time (client, 16 Nov 2026): what the players may report and what the
 * server will believe. See server/watchTime.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  parseWatchReport, resolveVideoSeconds, clampWatchSeconds, watchViewerKey, watchTrackerJs,
  MAX_VIDEO_SECONDS, WATCH_SLACK_SECONDS,
} from "../../server/watchTime";

const req = (ip = "203.0.113.9", ua = "Mozilla/5.0") =>
  ({ headers: { "x-forwarded-for": ip, "user-agent": ua }, ip, socket: {} }) as any;

describe("what a player may send", () => {
  it("takes the beacon's text/plain body and fetch's parsed JSON alike", () => {
    const body = { videoId: "v1", sid: "abcdefgh12345678", seconds: 31, duration: 64 };
    expect(parseWatchReport(JSON.stringify(body))).toEqual(body);
    expect(parseWatchReport(body)).toEqual(body);
  });

  it("refuses garbage, negative or absurd seconds, a bad id and an oversized body", () => {
    expect(parseWatchReport("not json")).toBeNull();
    expect(parseWatchReport({ videoId: "v1", seconds: -5 })).toBeNull();
    expect(parseWatchReport({ videoId: "v1", seconds: 1e9 })).toBeNull();
    expect(parseWatchReport({ videoId: "v1", seconds: 5, sid: "<script>" })).toBeNull();
    expect(parseWatchReport("x".repeat(5000))).toBeNull();
    expect(parseWatchReport({ seconds: 5 })).toBeNull();
  });
});

describe("what the server believes", () => {
  it("the video's own length wins over the player's", () => {
    expect(resolveVideoSeconds(38, 9999)).toBe(38);
    expect(resolveVideoSeconds(null, 64.4)).toBe(64);
    expect(resolveVideoSeconds(null, 1e6)).toBe(MAX_VIDEO_SECONDS);
    expect(resolveVideoSeconds(null, null)).toBe(MAX_VIDEO_SECONDS);
  });

  it("never more than the video's length", () => {
    expect(clampWatchSeconds({ reported: 500, previous: 0, videoSeconds: 38, elapsedSeconds: 3600 })).toBe(38);
  });

  it("never more than the time since the viewing began allows", () => {
    expect(clampWatchSeconds({ reported: 3000, previous: 0, videoSeconds: 3600, elapsedSeconds: 0 })).toBe(WATCH_SLACK_SECONDS);
    expect(clampWatchSeconds({ reported: 3000, previous: 30, videoSeconds: 3600, elapsedSeconds: 60 })).toBe(150);
  });

  it("only ever goes up: a late, smaller report changes nothing", () => {
    expect(clampWatchSeconds({ reported: 10, previous: 25, videoSeconds: 60, elapsedSeconds: 100 })).toBe(25);
    expect(clampWatchSeconds({ reported: 40.9, previous: 25, videoSeconds: 60, elapsedSeconds: 100 })).toBe(40);
  });

  it("survives nonsense numbers", () => {
    expect(clampWatchSeconds({ reported: NaN, previous: 0, videoSeconds: 60, elapsedSeconds: 10 })).toBe(0);
  });
});

describe("one viewing", () => {
  it("is a salted digest of the page's id and the day, never the id itself", () => {
    process.env.SESSION_SECRET ||= "test-secret";
    const day = new Date("2026-11-16T10:00:00Z");
    const a = watchViewerKey("abcdefgh12345678", req(), day)!;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("abcdefgh");
    // Same page, different IP on the next report (the proxy does not keep it): same viewing.
    expect(watchViewerKey("abcdefgh12345678", req("198.51.100.1"), day)).toBe(a);
    // Next day: a new key.
    expect(watchViewerKey("abcdefgh12345678", req(), new Date("2026-11-17T10:00:00Z"))).not.toBe(a);
    expect(watchViewerKey("zzzzzzzz12345678", req(), day)).not.toBe(a);
  });

  it("an old player that sends no id falls back to the view-dedup hash", () => {
    process.env.SESSION_SECRET ||= "test-secret";
    expect(watchViewerKey(undefined, req())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the players", () => {
  const js = watchTrackerJs();

  it("is plain ES5 that can sit inside a template literal", () => {
    expect(js).not.toMatch(/`|\$\{|=>|\blet\b|\bconst\b/);
    expect(() => new Function(js + "\nreturn matWatch;")).not.toThrow();
  });

  it("reports by beacon as text/plain when the page goes away, and every 15s while playing", () => {
    expect(js).toMatch(/sendBeacon\(u,new Blob\(\[body\],\{type:"text\/plain"\}\)\)/);
    expect(js).toMatch(/visibilitychange/);
    expect(js).toMatch(/pagehide/);
    expect(js).toMatch(/setInterval\(function\(\)\{flush\(false\);\},15000\)/);
    expect(js).toMatch(/\/api\/analytics\/watch/);
  });

  it("is wired into the embed page, the script widget and the playlist player", () => {
    const routes = readFileSync(join(__dirname, "../../server/routes.ts"), "utf8");
    const playlist = readFileSync(join(__dirname, "../../server/playlistEmbed.ts"), "utf8");
    expect(routes).toMatch(/matWatch\(vid,apiBase,videoId,utm\);/);
    expect(routes).toMatch(/matWatch\(v,apiBase,videoId,utm\);/);
    expect(playlist).toMatch(/var watch=matWatch\(vid,D\.apiBase,null\);/);
    expect(playlist).toMatch(/watch\.setVideo\(item\.videoId,item\.utm\);/);
  });

  it("the ingest route caps on the server and records nothing it cannot attribute", () => {
    const routes = readFileSync(join(__dirname, "../../server/routes.ts"), "utf8");
    const start = routes.indexOf('app.post("/api/analytics/watch"');
    const body = routes.slice(start, routes.indexOf("\n  app.", start + 10));
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/express\.text\(\{ type: "text\/plain", limit: "4kb" \}\)/);
    expect(body).toMatch(/resolveVideoSeconds\(video\.durationSeconds, report\.duration\)/);
    expect(body).toMatch(/if \(!key\) return res\.status\(204\)/);
  });
});

describe("clicks name their product", () => {
  it("the embed page and the widget send the card's product with a click", () => {
    const routes = readFileSync(join(__dirname, "../../server/routes.ts"), "utf8");
    expect(routes.match(/track\("click",p\.productId\?\{productId:p\.productId\}:null\)/g)?.length).toBe(3);
    expect(routes.match(/productId: o\.productId \?\? null,/g)?.length).toBe(2);
  });
});

describe("the playlist script still runs", () => {
  it("renders to valid JavaScript with the tracker inside", async () => {
    const { playlistRenderScript, playlistFrameStyles, playlistPlaybackFlags, resolvePlaylistStyle } = await import("../../server/playlistEmbed");
    const style = resolvePlaylistStyle(null);
    const src = playlistRenderScript({
      playlistId: 1, apiBase: "https://x.test", styles: playlistFrameStyles(style), flags: playlistPlaybackFlags(style),
      items: [], logoUrl: null,
    });
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain("function matWatch(");
  });
});
