/**
 * Bunny Stream: the upload authorisation, the delivery URLs, and the webhook
 * that turns "uploaded" into "playable".
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOST = "vz-test-000.b-cdn.net";
const GUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

beforeEach(() => {
  process.env.BUNNY_LIBRARY_ID = "123456";
  process.env.BUNNY_STREAM_API_KEY = "test-stream-key";
  process.env.BUNNY_STREAM_HOST = HOST;
});

describe("the TUS authorisation", () => {
  it("signs exactly libraryId + key + expire + guid — the order Bunny verifies", async () => {
    const { bunnyTusAuth } = await import("../../server/bunnyService");
    // Vector computed OUTSIDE this codebase (python hashlib), so the test
    // proves the concatenation order rather than mirroring the implementation.
    const auth = bunnyTusAuth(GUID, { now: () => new Date(1758600000_000 - 6 * 60 * 60 * 1000) });
    expect(auth.headers.AuthorizationExpire).toBe("1758600000");
    expect(auth.headers.AuthorizationSignature).toBe(
      "6c991a98eb678efec3c61782701afd2fffa1cbb63f6bee250dd3ae750259e552",
    );
    expect(auth.headers.VideoId).toBe(GUID);
    expect(auth.headers.LibraryId).toBe("123456");
    expect(auth.endpoint).toBe("https://video.bunnycdn.com/tusupload");
  });
});

describe("choosing what to serve", () => {
  it("takes the best MP4 that actually exists, never one it hopes exists", async () => {
    const { bestBunnyMp4Url } = await import("../../server/bunnyService");
    expect(bestBunnyMp4Url({ guid: GUID, availableResolutions: "240p,360p,720p" }))
      .toBe(`https://${HOST}/${GUID}/play_720p.mp4`);
    // A 480p-max source must NOT be pointed at a 720p file that is not there.
    expect(bestBunnyMp4Url({ guid: GUID, availableResolutions: "240p,360p,480p" }))
      .toBe(`https://${HOST}/${GUID}/play_480p.mp4`);
    expect(bestBunnyMp4Url({ guid: GUID, availableResolutions: "" })).toBeNull();
    expect(bestBunnyMp4Url({ guid: GUID, availableResolutions: null })).toBeNull();
  });

  it("extracts the guid only from our own delivery URLs", async () => {
    const { bunnyGuidFromUrl } = await import("../../server/bunnyService");
    expect(bunnyGuidFromUrl(`https://${HOST}/${GUID}/play_720p.mp4`)).toBe(GUID);
    expect(bunnyGuidFromUrl("https://res.cloudinary.com/x/video/upload/v1/a.mp4")).toBeNull();
    expect(bunnyGuidFromUrl(null)).toBeNull();
  });
});

describe("delivery contexts for Bunny URLs", () => {
  const stored = `https://${HOST}/${GUID}/play_720p.mp4`;

  it("player and embed serve the stored (best) rendition untouched", async () => {
    const { videoDeliveryUrl } = await import("../../shared/videoDelivery");
    expect(videoDeliveryUrl(stored, "player")).toBe(stored);
    expect(videoDeliveryUrl(stored, "embed")).toBe(stored);
  });

  it("preview steps DOWN the ladder, and only down", async () => {
    const { videoDeliveryUrl } = await import("../../shared/videoDelivery");
    expect(videoDeliveryUrl(stored, "preview")).toBe(`https://${HOST}/${GUID}/play_480p.mp4`);
    // A 480p stored rendition must not be downshifted further — 480 is the floor.
    const low = `https://${HOST}/${GUID}/play_480p.mp4`;
    expect(videoDeliveryUrl(low, "preview")).toBe(low);
  });

  it("thumbnail and poster map to the generated still", async () => {
    const { videoDeliveryUrl, videoPosterUrl } = await import("../../shared/videoDelivery");
    expect(videoDeliveryUrl(stored, "thumbnail")).toBe(`https://${HOST}/${GUID}/thumbnail.jpg`);
    expect(videoPosterUrl(stored)).toBe(`https://${HOST}/${GUID}/thumbnail.jpg`);
  });

  it("Cloudinary URLs still get the transformation profiles — the legacy path lives", async () => {
    const { videoDeliveryUrl } = await import("../../shared/videoDelivery");
    const cld = "https://res.cloudinary.com/demo/video/upload/v1/materialized/videos/a.mp4";
    expect(videoDeliveryUrl(cld, "player")).toContain("f_auto,q_auto:good,w_1080");
  });
});

function webhookHarness(opts: {
  row?: { id: string; status: string | null } | undefined;
  video?: Partial<{ status: number; availableResolutions: string | null; thumbnailFileName: string | null }>;
} = {}) {
  const updates: Array<[string, any]> = [];
  const store = {
    findVideoByBunnyGuid: async () => "row" in opts ? opts.row : { id: "v1", status: "processing" },
    updateVideo: async (id: string, data: any) => { updates.push([id, data]); },
  };
  const api = {
    getVideo: async () => ({
      guid: GUID, status: 4, availableResolutions: "360p,720p",
      thumbnailFileName: "thumbnail_x.jpg", length: 30,
      ...opts.video,
    }),
  };
  return { store, api, updates };
}

describe("the transcode webhook", () => {
  it("finalises: real best rendition, real thumbnail, processing → published", async () => {
    const { handleBunnyTranscodeEvent } = await import("../../server/bunnyWebhook");
    const h = webhookHarness();
    const r = await handleBunnyTranscodeEvent(h.store as any, h.api as any, { VideoGuid: GUID });
    expect(h.updates).toHaveLength(1);
    const [, patch] = h.updates[0];
    expect(patch.videoUrl).toBe(`https://${HOST}/${GUID}/play_720p.mp4`);
    expect(patch.thumbnailUrl).toBe(`https://${HOST}/${GUID}/thumbnail_x.jpg`);
    expect(patch.status).toBe("published");
    expect(r.action).toContain("finalised");
  });

  it("a draft stays a draft — the creator is still editing", async () => {
    const { handleBunnyTranscodeEvent } = await import("../../server/bunnyWebhook");
    const h = webhookHarness({ row: { id: "v1", status: "draft" } });
    await handleBunnyTranscodeEvent(h.store as any, h.api as any, { VideoGuid: GUID });
    const [, patch] = h.updates[0];
    expect(patch.videoUrl).toBeTruthy();
    expect(patch.status).toBeUndefined();
  });

  it("acts on Bunny's actual state, not the payload's claim", async () => {
    const { handleBunnyTranscodeEvent } = await import("../../server/bunnyWebhook");
    // Payload screams success; the API says still transcoding. Nothing changes.
    const h = webhookHarness({ video: { status: 3 } });
    const r = await handleBunnyTranscodeEvent(h.store as any, h.api as any,
      { VideoGuid: GUID, Status: 3 } as any);
    expect(h.updates).toHaveLength(0);
    expect(r.action).toContain("not finished");
  });

  it("a failed transcode archives the row rather than leaving a dead player", async () => {
    const { handleBunnyTranscodeEvent } = await import("../../server/bunnyWebhook");
    const h = webhookHarness({ video: { status: 5 } });
    await handleBunnyTranscodeEvent(h.store as any, h.api as any, { VideoGuid: GUID });
    expect(h.updates).toEqual([["v1", { status: "archived" }]]);
  });

  it("finished with no MP4 rendition is a failure, not a published 404", async () => {
    const { handleBunnyTranscodeEvent } = await import("../../server/bunnyWebhook");
    const h = webhookHarness({ video: { availableResolutions: "" } });
    await handleBunnyTranscodeEvent(h.store as any, h.api as any, { VideoGuid: GUID });
    expect(h.updates).toEqual([["v1", { status: "archived" }]]);
  });

  it("an unknown guid and a junk payload are ignored without touching storage", async () => {
    const { handleBunnyTranscodeEvent } = await import("../../server/bunnyWebhook");
    const h1 = webhookHarness({ row: undefined });
    expect((await handleBunnyTranscodeEvent(h1.store as any, h1.api as any, { VideoGuid: GUID })).action)
      .toContain("ignored");
    const h2 = webhookHarness();
    expect((await handleBunnyTranscodeEvent(h2.store as any, h2.api as any, { VideoGuid: "../../etc" } as any)).action)
      .toContain("ignored");
    expect(h1.updates).toHaveLength(0);
    expect(h2.updates).toHaveLength(0);
  });
});

describe("the routes, read at the source", () => {
  const SRC = readFileSync(join(__dirname, "../../server/routes.ts"), "utf8");
  function handler(route: string): string {
    const start = SRC.indexOf(`app.post("${route}"`);
    expect(start).toBeGreaterThan(-1);
    return SRC.slice(start, start + 2200);
  }

  it("minting an upload requires a session and enforces the size limit server-side", () => {
    const body = handler("/api/upload/bunny-video");
    expect(body).toContain("Authentication required");
    expect(body).toContain("MAX_VIDEO_UPLOAD_BYTES");
    expect(body).toMatch(/status\(413\)/);
  });

  it("the webhook route refuses without the shared token", () => {
    const body = handler("/api/webhooks/bunny");
    expect(body).toContain("BUNNY_WEBHOOK_TOKEN");
    expect(body).toMatch(/status\(401\)/);
    // An UNSET token must refuse everything, not accept everything.
    expect(body).toMatch(/!expected\s*\|\|/);
  });

  it("the publish transition consults the transcode gate", () => {
    expect(SRC).toContain("bunnyPublishGate(existing.videoUrl)");
  });

  it("EVERY publish write goes through the gate — nothing force-publishes on a timer", () => {
    // The QA click-through of 25 Sep caught a legacy setTimeout that
    // force-published every video 3s after creation: Save Draft produced a
    // published row, and the publish bypassed the transcode gate entirely.
    expect(SRC).not.toMatch(/setTimeout[\s\S]{0,200}?status:\s*"published"/);
    // Both explicit publish sites name the gate.
    expect(SRC.match(/bunnyPublishGate\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("creating a video reconciles against Bunny AFTER the insert — the webhook race", () => {
    // Transcode can finish while the creator is still typing the title; the
    // webhook then finds no row and never retries. The create route must run
    // the same reconciliation after the row exists.
    const start = SRC.indexOf("const video = await storage.createVideo(data);");
    expect(start).toBeGreaterThan(-1);
    const after = SRC.slice(start, start + 3000);
    expect(after).toContain("handleBunnyTranscodeEvent");
  });
});
