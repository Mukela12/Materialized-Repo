/**
 * A scan says what actually happened (QA before the client's test, 30 Sep 2026).
 *  - A failed model call is not "found nothing"; a scan where every call
 *    failed is a failed scan, and rate limits are retried, not dropped.
 *  - Tagged brands with nothing to look for say so, without paying for a scan.
 *  - A scan cut off by a deploy stops "processing" instead of spinning forever.
 *  - Metadata-only placements show for the whole video, not for 0 seconds.
 *  - Import adds the latest scan's accepted placements, never a product twice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const generate = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class { models = { generateContent: (...a: any[]) => generate(...a) }; },
}));

import { analyzeFrameForProducts } from "../../server/replit_integrations/detection/client";
import { isStalledScan, SCAN_STALL_MS } from "../../shared/detectionNotes";

const code = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const catalog = [{ id: "p1", name: "Bag", description: null, category: null, brandId: "b1", brandName: "B" }];

beforeEach(() => { generate.mockReset(); });

describe("a model call that fails", () => {
  it("is marked as an error, not as 'nothing in this frame'", async () => {
    generate.mockImplementation(async () => { throw new Error("API key not valid"); });
    const fa = await analyzeFrameForProducts("x", "image/jpeg", catalog, 3);
    expect(fa.detectedProducts).toEqual([]);
    expect(fa.error).toMatch(/API key not valid/);
  });

  it("a rate limit is thrown back so the batch retries it", async () => {
    generate.mockImplementation(async () => { throw new Error("429 RESOURCE_EXHAUSTED quota exceeded"); });
    await expect(analyzeFrameForProducts("x", "image/jpeg", catalog, 3)).rejects.toThrow(/429/);
  });

  it("a frame that was looked at and had nothing has no error", async () => {
    generate.mockResolvedValue({ text: JSON.stringify({ products: [] }) });
    const fa = await analyzeFrameForProducts("x", "image/jpeg", catalog, 3);
    expect(fa.error).toBeUndefined();
  });
});

describe("the runner", () => {
  const runner = code("server/detectionRunner.ts");

  it("fails the job, with the reason, when every frame failed", () => {
    expect(runner).toMatch(/if \(failedFrames\.length === frameAnalyses\.length\) \{[\s\S]*?status: "failed"[\s\S]*?SCAN_FAILED_NOTE/);
  });

  it("stops before sampling or calling the model when there is no catalog", () => {
    const noCatalog = runner.indexOf("if (allProducts.length === 0)");
    expect(noCatalog).toBeGreaterThan(-1);
    expect(noCatalog).toBeLessThan(runner.indexOf("sampleVideoFrames("));
    expect(runner.slice(noCatalog, noCatalog + 300)).toMatch(/error: NO_CATALOG_NOTE/);
  });

  it("an unexpected error still ends the job with a reason and an end time", () => {
    const c = runner.slice(runner.lastIndexOf("} catch (err) {"));
    expect(c).toMatch(/status: "failed",\s*completedAt: new Date\(\),\s*error: `\$\{SCAN_FAILED_NOTE\}/);
  });

  it("metadata-only placements have no end, so they show for the whole video", () => {
    expect(runner).toMatch(/startTime: "0",\s*endTime: null,/);
    expect(runner).not.toMatch(/det\.confidence\.toString\(\)/);
  });
});

describe("a scan cut off mid-way", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("counts as stalled only while running and past the limit", () => {
    expect(isStalledScan({ status: "processing", startedAt: ago(SCAN_STALL_MS + 1) }, now)).toBe(true);
    expect(isStalledScan({ status: "queued", createdAt: ago(SCAN_STALL_MS + 1) }, now)).toBe(true);
    expect(isStalledScan({ status: "processing", startedAt: ago(60_000) }, now)).toBe(false);
    expect(isStalledScan({ status: "completed", startedAt: ago(SCAN_STALL_MS * 3) }, now)).toBe(false);
  });

  it("is marked failed when someone next looks at it", () => {
    const routes = code("server/routes.ts");
    const get = routes.slice(routes.indexOf('app.get("/api/videos/:id/detections"'));
    expect(get.slice(0, 1500)).toMatch(/if \(isStalledScan\(job\)\) \{[\s\S]*?status: "failed"/);
  });

  it("the uploader can skip a slow scan, and a refused poll stops polling", () => {
    const modal = code("client/src/components/VideoUploadModal.tsx");
    expect(modal).toMatch(/scanElapsed > 120_000/);
    expect(modal).toMatch(/data-testid="button-skip-scan"/);
    expect(modal).toMatch(/res\.status === 401 \|\| res\.status === 403 \|\| res\.status === 404/);
  });
});

describe("adding accepted placements to the carousel", () => {
  const routes = code("server/routes.ts");
  const imp = routes.slice(routes.indexOf('app.post("/api/videos/:id/overlays/import-detections"'), routes.indexOf("VIDEO PUBLISH ROUTES"));

  it("reads the latest scan only", () => {
    expect(imp).toMatch(/const job = await storage\.getDetectionJobByVideoId\(req\.params\.id\);/);
    expect(imp).toMatch(/importable\(await storage\.getDetectionResults\(job\.id\)\)/);
    expect(imp).not.toMatch(/getDetectionResultsByVideo/);
  });

  it("never puts the same product on the carousel twice", () => {
    expect(imp).toMatch(/if \(r\.productId && onCarousel\.has\(r\.productId\)\) continue;/);
  });

  it("an end at or before the start becomes the whole video", () => {
    expect(imp).toMatch(/endTime: r\.endTime != null && Number\(r\.endTime\) > Number\(r\.startTime \?\? 0\) \? r\.endTime : null/);
  });
});
