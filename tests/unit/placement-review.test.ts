/**
 * Placement Review, phase 1 (DETECTION_REVIEW.md).
 *
 * The guarantee: a placement nobody has accepted never reaches the carousel.
 * Detection used to import every result as a live overlay.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseReviewRequest, reviewLocked, importable, queueOrder, reviewCounts, parseBoundingBox,
} from "../../server/placementReview";
import { consolidateDetections, cleanBoundingBox } from "../../server/replit_integrations/detection/client";
import { insertVideoDetectionResultSchema } from "../../shared/schema";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function routeBody(src: string, method: string, path: string): string {
  const start = src.indexOf(`app.${method}("${path}"`);
  expect(start, `${method} ${path} exists`).toBeGreaterThan(-1);
  const next = src.indexOf("\n  app.", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

type R = { id: string; reviewStatus: "pending" | "accepted" | "rejected"; importedAt: Date | null; confidence: string };
const r = (id: string, reviewStatus: R["reviewStatus"], confidence = "0.80", importedAt: Date | null = null): R =>
  ({ id, reviewStatus, importedAt, confidence });

describe("only accepted placements can reach the carousel", () => {
  it("pending and rejected are never importable", () => {
    const all = [r("p", "pending"), r("x", "rejected"), r("a", "accepted")];
    expect(importable(all).map((x) => x.id)).toEqual(["a"]);
  });

  it("an accepted placement already imported is not imported again", () => {
    expect(importable([r("a", "accepted", "0.9", new Date())])).toEqual([]);
  });

  it("a placement on the carousel is locked for review", () => {
    expect(reviewLocked({ importedAt: new Date() })).toBe(true);
    expect(reviewLocked({ importedAt: null })).toBe(false);
  });

  it("the detector cannot create a row as already accepted or imported", () => {
    const parsed = insertVideoDetectionResultSchema.parse({
      jobId: "j", videoId: "v", productId: "p", brandId: "b", confidence: "0.9", frameTimestamp: "1",
      reviewStatus: "accepted", importedAt: new Date(),
    } as any);
    expect(parsed).not.toHaveProperty("reviewStatus");
    expect(parsed).not.toHaveProperty("importedAt");
  });
});

describe("the queue", () => {
  it("puts undecided work first, then by confidence", () => {
    const q = queueOrder([
      r("acc-hi", "accepted", "0.99"), r("pen-lo", "pending", "0.55"),
      r("rej", "rejected", "0.97"), r("pen-hi", "pending", "0.91"),
    ]);
    expect(q.map((x) => x.id)).toEqual(["pen-hi", "pen-lo", "acc-hi", "rej"]);
  });

  it("counts what is left to do", () => {
    expect(reviewCounts([r("1", "pending"), r("2", "accepted"), r("3", "accepted", "0.8", new Date()), r("4", "rejected")]))
      .toEqual({ pending: 1, accepted: 2, rejected: 1, readyToImport: 1 });
  });
});

describe("a review request", () => {
  it("takes a status, and timing only as a pair", () => {
    expect(parseReviewRequest({ status: "accepted" }, 30)).toEqual({ status: "accepted" });
    expect(parseReviewRequest({ status: "approved" }, 30)).toHaveProperty("error");
    expect(parseReviewRequest({}, 30)).toHaveProperty("error");
    expect(parseReviewRequest({ status: "accepted", startTime: 2 }, 30)).toHaveProperty("error");
  });

  it("refuses a window that ends before it starts or starts after the video", () => {
    expect(parseReviewRequest({ status: "accepted", startTime: 5, endTime: 3 }, 30)).toHaveProperty("error");
    expect(parseReviewRequest({ status: "accepted", startTime: -1, endTime: 3 }, 30)).toHaveProperty("error");
    expect(parseReviewRequest({ status: "accepted", startTime: 31, endTime: 40 }, 30)).toHaveProperty("error");
    expect(parseReviewRequest({ status: "accepted", startTime: "a", endTime: 3 }, 30)).toHaveProperty("error");
  });

  it("clamps a window that runs past the end instead of refusing it", () => {
    expect(parseReviewRequest({ status: "accepted", startTime: 25, endTime: 40 }, 30))
      .toEqual({ status: "accepted", startTime: "25.00", endTime: "30.00" });
    expect(parseReviewRequest({ status: "accepted", startTime: 1.5, endTime: 6 }, null))
      .toEqual({ status: "accepted", startTime: "1.50", endTime: "6.00" });
  });
});

describe("the inspector's evidence", () => {
  const frame = (t: number, confidence: number, box?: any) => ({
    frameTimestamp: t,
    detectedProducts: [{ productId: "p1", productName: "Hoops", brandId: "b1", confidence, boundingBox: box }],
  });

  it("keeps the box and timestamp of the most confident frame", () => {
    const [d] = consolidateDetections([
      frame(2, 0.7, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }),
      frame(6, 0.93, { x: 0.4, y: 0.3, width: 0.25, height: 0.35 }),
      frame(10, 0.8, { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }),
    ], 0.5, 1);
    expect(d.peakTimestamp).toBe(6);
    expect(d.peakBoundingBox).toEqual({ x: 0.4, y: 0.3, width: 0.25, height: 0.35 });
    expect(d.startTime).toBe(2);
    expect(d.endTime).toBe(10);
  });

  it("drops boxes that are not normalized or have no area, and clamps edges", () => {
    const edge = cleanBoundingBox({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 })!;
    expect(edge.width).toBeCloseTo(0.1);
    expect(edge.height).toBeCloseTo(0.1);
    expect(cleanBoundingBox({ x: 0.2, y: 0.2, width: 0, height: 0.3 })).toBeNull();
    expect(cleanBoundingBox(undefined)).toBeNull();
  });

  it("reads a stored box back, or nothing", () => {
    expect(parseBoundingBox('{"x":0.2,"y":0.3,"width":0.25,"height":0.4}')).toEqual({ x: 0.2, y: 0.3, width: 0.25, height: 0.4 });
    expect(parseBoundingBox("not json")).toBeNull();
    expect(parseBoundingBox('{"x":"a"}')).toBeNull();
    expect(parseBoundingBox(null)).toBeNull();
  });
});

describe("the routes", () => {
  const routes = code("server/routes.ts");

  it("import takes accepted placements only and claims each before making its overlay", () => {
    const body = routeBody(routes, "post", "/api/videos/:id/overlays/import-detections");
    expect(body).toMatch(/importable\(await storage\.getDetectionResultsByVideo\(req\.params\.id\)\)/);
    expect(body).toMatch(/if \(!\(await storage\.claimDetectionImport\(r\.id\)\)\) continue;[\s\S]*createVideoProductOverlay/);
    expect(body).toMatch(/releaseDetectionImport\(r\.id\)/);
  });

  it("reading and reviewing placements needs the video's editor", () => {
    expect(routeBody(routes, "get", "/api/videos/:id/detections")).toMatch(/await videoEditorOr403\(req, res\)/);
    expect(routeBody(routes, "patch", "/api/videos/:id/detections/:resultId")).toMatch(/await videoEditorOr403\(req, res\)/);
    expect(routeBody(routes, "post", "/api/videos/:id/overlays/import-detections")).toMatch(/await videoEditorOr403\(req, res\)/);
  });

  it("a review is refused for a placement from another video or already on the carousel", () => {
    const body = routeBody(routes, "patch", "/api/videos/:id/detections/:resultId");
    expect(body).toMatch(/result\.videoId !== req\.params\.id/);
    expect(body).toMatch(/if \(reviewLocked\(result\)\)/);
  });

  it("detection stores the clearest frame and its box", () => {
    const runner = code("server/detectionRunner.ts");
    expect(runner).toMatch(/frameTimestamp: result\.peakTimestamp\.toString\(\)/);
    expect(runner).toMatch(/boundingBox: result\.peakBoundingBox \? JSON\.stringify\(result\.peakBoundingBox\) : null/);
    // The route runs the same pipeline the script does.
    expect(routes).toMatch(/void runDetectionJob\(job, req\.params\.id, \{ brandIds, videoTitle, videoDescription \}, isBrandInventoryDiscoverable\);/);
  });

  it("a re-scanned video reports its latest job", () => {
    expect(code("server/storage.ts")).toMatch(/where\(eq\(videoDetectionJobs\.videoId, videoId\)\)\s*\.orderBy\(desc\(videoDetectionJobs\.createdAt\)\)/);
  });

  it("the claim is atomic: accepted and not yet imported, in the UPDATE itself", () => {
    const storage = code("server/storage.ts");
    expect(storage).toMatch(/eq\(videoDetectionResults\.reviewStatus, "accepted"\),\s*isNull\(videoDetectionResults\.importedAt\)/);
  });
});

describe("the review workspace (phase 2)", () => {
  it("formats times and match scores for people", async () => {
    const { formatTime, matchPercent } = await import("../../client/src/lib/placementReview");
    expect(formatTime(9.5)).toBe("0:09");
    expect(formatTime("64")).toBe("1:04");
    expect(formatTime(null)).toBe("0:00");
    expect(matchPercent("0.916")).toBe(92);
    expect(matchPercent(1.4)).toBe(100);
  });

  it("after a decision, moves on to the next placement still waiting", async () => {
    const { nextPendingId } = await import("../../client/src/lib/placementReview");
    const q = [
      { id: "a", reviewStatus: "accepted" as const }, { id: "b", reviewStatus: "pending" as const },
      { id: "c", reviewStatus: "rejected" as const }, { id: "d", reviewStatus: "pending" as const },
    ];
    expect(nextPendingId(q, "b")).toBe("d");
    expect(nextPendingId(q, "d")).toBe("b"); // wraps round
    expect(nextPendingId([{ id: "x", reviewStatus: "accepted" as const }], "x")).toBe("x"); // nothing left: stay
    expect(nextPendingId([], null)).toBeNull();
  });

  it("places segments on the video's timeline, and a zero-length one still shows", async () => {
    const { segment } = await import("../../client/src/lib/placementReview");
    expect(segment("5", "10", 20)).toEqual({ left: 25, width: 25 });
    expect(segment("0", "0", 20)?.width).toBeGreaterThan(0);
    expect(segment("30", "40", 20)).toEqual({ left: 98.8, width: 1.2 }); // past the end: pinned inside
    expect(segment("1", "2", 0)).toBeNull();
  });

  it("stacks overlapping placements into lanes", async () => {
    const { assignLanes } = await import("../../client/src/lib/placementReview");
    const { lanes, count } = assignLanes([
      { id: "a", startTime: "0", endTime: "5" },
      { id: "b", startTime: "3", endTime: "8" },
      { id: "c", startTime: "5", endTime: "9" },
    ]);
    expect(count).toBe(2);
    expect([lanes.get("a"), lanes.get("b"), lanes.get("c")]).toEqual([0, 1, 0]);
  });

  it("the upload flow reviews before the carousel when the scan found anything", () => {
    const modal = code("client/src/components/VideoUploadModal.tsx");
    expect(modal).toMatch(/const STEP_ORDER = \["upload", "details", "detecting", "review", "carousel"\] as const;/);
    expect(modal).toMatch(/setStep\(job\.status === "completed" && job\.results\.length > 0 \? "review" : "carousel"\)/);
    expect(modal).toMatch(/<PlacementReview\s+videoId=\{createdVideoId\}/);
  });

  it("the editing suite reviews instead of importing everything", () => {
    const composer = code("client/src/components/OverlayComposer.tsx");
    expect(composer).not.toMatch(/import-detections/);
    expect(composer).toMatch(/<PlacementReview videoId=\{videoId\}/);
    // The only client path to import is the workspace's own button.
    const review = code("client/src/components/PlacementReview.tsx");
    expect(review.match(/import-detections/g)).toHaveLength(1);
  });

  it("the label stays inside the frame and Accept stays near it on phones", () => {
    const review = code("client/src/components/PlacementReview.tsx");
    expect(review).toMatch(/const anchorRight = b\.x \+ b\.width \/ 2 > 0\.5;/);
    expect(review).toMatch(/maxWidth: `calc\(\$\{pct\(1 - b\.x\)\} - 8px\)`/);
    const css = read("client/src/index.css");
    expect(css).toMatch(/grid-template-areas: "stage" "insp" "seq" "queue";/);
  });
});

describe("Gemini configuration (production had no key for two months)", () => {
  it("uses Replit's proxy settings only when the proxy URL is set", async () => {
    const { geminiConfig } = await import("../../server/replit_integrations/detection/client");
    expect(geminiConfig({ AI_INTEGRATIONS_GEMINI_API_KEY: "k", AI_INTEGRATIONS_GEMINI_BASE_URL: "https://proxy" }))
      .toEqual({ apiKey: "k", httpOptions: { apiVersion: "", baseUrl: "https://proxy" } });
    // A plain Google key must go to Google's endpoint WITH its version path.
    expect(geminiConfig({ GEMINI_API_KEY: "g" })).toEqual({ apiKey: "g" });
    expect(geminiConfig({})).toEqual({ apiKey: undefined });
  });

  it("with no key, a scan says detection is not set up instead of dying on Google credentials", async () => {
    const { geminiConfigured } = await import("../../server/replit_integrations/detection/client");
    expect(geminiConfigured({})).toBe(false);
    expect(geminiConfigured({ GEMINI_API_KEY: "g" })).toBe(true);
    const runner = code("server/detectionRunner.ts");
    expect(runner).toMatch(/if \(!geminiConfigured\(\)\) \{\s*await storage\.updateDetectionJob\(job\.id, \{\s*status: "failed",[\s\S]*?error: DETECTION_NOT_CONFIGURED,/);
    expect(read("server/index.ts")).toMatch(/AI product detection is OFF: set GEMINI_API_KEY/);
  });

  it("a failed scan is not reported as completed", () => {
    const modal = code("client/src/components/VideoUploadModal.tsx");
    expect(modal).not.toMatch(/AI scan completed — manual carousel setup/);
    expect(modal).toMatch(/AI detection isn't switched on yet/);
  });
});

describe("the first real scan (29 Sep 2026, the client's key)", () => {
  it("uses a model Google still offers, and it can be changed without code", () => {
    const client = code("server/replit_integrations/detection/client.ts");
    expect(client).toMatch(/export const GEMINI_MODEL = process\.env\.GEMINI_MODEL \|\| "gemini-3\.8-flash";/);
    // gemini-2.5-flash is "no longer available to new users": nothing may name a model directly.
    for (const f of ["server/detectionRunner.ts", "server/replit_integrations/detection/client.ts",
      "server/replit_integrations/detection/aiContentDetector.ts", "server/replit_integrations/pdf_analysis/client.ts"]) {
      expect(code(f), f).not.toMatch(/model: "gemini-/);
    }
    expect(code("server/replit_integrations/pdf_analysis/client.ts")).toMatch(/new GoogleGenAI\(geminiConfig\(\)\)/);
  });

  it("samples about one frame every 4 seconds, 4 to 12", async () => {
    const { framesToSample } = await import("../../server/replit_integrations/detection/client");
    expect(framesToSample(null)).toBe(4);
    expect(framesToSample(9)).toBe(4);
    expect(framesToSample(17)).toBe(5);
    expect(framesToSample(58)).toBe(12);
    expect(framesToSample(600)).toBe(12);
  });

  it("keeps a product seen in one frame, because a person reviews it anyway", () => {
    const one = [{ frameTimestamp: 5, detectedProducts: [{ productId: "bag", productName: "Bag", brandId: "b", confidence: 0.9 }] }];
    expect(consolidateDetections(one, 0.5, 1, 2)).toHaveLength(0); // the old rule dropped it
    expect(consolidateDetections(one, 0.5, 1, 1)).toHaveLength(1);
    expect(code("server/detectionRunner.ts")).toMatch(/consolidateDetections\(frameAnalyses, 0\.5, 1, 1\)/);
    expect(code("server/detectionRunner.ts")).toMatch(/count: framesToSample\(video\.durationSeconds\)/);
  });
});

describe("the queue on the invoice: filterable by brand, each with its image and price (30 Sep 2026)", () => {
  const q = [
    { id: "1", brandId: "b2", brandName: "Zara Studio" },
    { id: "2", brandId: "b1", brandName: "Atelier" },
    { id: "3", brandId: "b2", brandName: "Zara Studio" },
    { id: "4", brandId: "b3", brandName: null },
  ];

  it("lists each brand once, with its count, in name order", async () => {
    const { brandFilterOptions } = await import("../../client/src/lib/placementReview");
    expect(brandFilterOptions(q)).toEqual([
      { id: "b1", name: "Atelier", count: 1 },
      { id: "b3", name: "Unknown brand", count: 1 },
      { id: "b2", name: "Zara Studio", count: 2 },
    ]);
  });

  it("filters to one brand, and 'all' keeps the whole queue in its order", async () => {
    const { filterByBrand } = await import("../../client/src/lib/placementReview");
    expect(filterByBrand(q, "b2").map((p) => p.id)).toEqual(["1", "3"]);
    expect(filterByBrand(q, "all")).toBe(q);
    expect(filterByBrand(q, "gone")).toEqual([]);
  });

  it("the workspace shows the filter for two or more brands and works on the filtered queue", () => {
    const ui = code("client/src/components/PlacementReview.tsx");
    expect(ui).toMatch(/\{brands\.length > 1 && \(/);
    expect(ui).toMatch(/const queue = useMemo\(\(\) => filterByBrand\(allResults, brandFilter\)/);
    // A brand that drops out of the results resets the filter instead of showing nothing.
    expect(ui).toMatch(/!brands\.some\(\(b\) => b\.id === brandFilter\)\) setBrandFilter\("all"\)/);
    // Counts and "Add to carousel" stay whole-video.
    expect(ui).toMatch(/\$\{counts\.pending\} of \$\{allResults\.length\} still to review/);
  });

  it("every row carries the catalog photo and the price", () => {
    const ui = code("client/src/components/PlacementReview.tsx");
    const rows = ui.slice(ui.indexOf('data-testid="placement-queue"'));
    expect(rows).toMatch(/<img src=\{p\.product\.imageUrl\}/);
    expect(rows).toMatch(/p\.product\?\.price && `\$\$\{p\.product\.price\}`/);
  });
});
