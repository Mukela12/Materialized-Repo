/**
 * "Download for socials" (30 Sep 2026): the video as an MP4 with its carousel
 * drawn on. These pin the timing (the player's rule), where the carousel sits,
 * the fetch safety, and who may use it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  carouselSegments, carouselSvg, endListSvg, fitText, isAllowedVideoUrl, isPrivateAddress, loadFonts,
  outputSize, referenceStage, svgPaint, svgToPng, fetchImageDataUrl, type ClipProduct,
} from "../../server/shareClip";
import { CAROUSEL_DEFAULTS, type CarouselSettings } from "../../shared/carousel";

const code = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const prod = (o: Partial<ClipProduct>): ClipProduct => ({
  name: "Gold Crinkle Mini Bag", brandName: "Atelier Noir", price: "245.00", imageUrl: null,
  startTime: 0, endTime: null, buyable: true, buttonLabel: null, ...o,
});

describe("when each product is on screen", () => {
  it("cuts the timeline where products come and go, like the player (start <= t < end)", () => {
    const segs = carouselSegments([prod({ startTime: 1, endTime: 15 }), prod({ startTime: 5, endTime: 12 }), prod({ startTime: 8, endTime: null })], 17);
    expect(segs).toEqual([
      { start: 1, end: 5, items: [0] },
      { start: 5, end: 8, items: [0, 1] },
      { start: 8, end: 12, items: [0, 1, 2] },
      { start: 12, end: 15, items: [0, 2] },
      { start: 15, end: 17, items: [2] },
    ]);
  });

  it("leaves out stretches with nothing on screen and clips to the video", () => {
    expect(carouselSegments([prod({ startTime: 20, endTime: 30 })], 17)).toEqual([]);
    expect(carouselSegments([prod({ startTime: 3, endTime: 99 })], 10)).toEqual([{ start: 3, end: 10, items: [0] }]);
    expect(carouselSegments([], 10)).toEqual([]);
  });
});

describe("drawing the carousel", () => {
  const fonts = loadFonts();
  const W = 720, H = 1280, frame = { W, H, ref: referenceStage(W, H) };
  const items = [prod({}), prod({ name: "Noir Rectangle Sunglasses" }), prod({ name: "Pearl Layered Choker", buyable: false })];

  it("keeps the panel inside the video in all eight positions", () => {
    for (const position of ["bottom", "top", "left", "right", "bottom-left", "bottom-right", "top-left", "top-right"] as const) {
      const s: CarouselSettings = { ...CAROUSEL_DEFAULTS, position };
      const svg = carouselSvg(items, s, frame, fonts, new Map(), "$");
      const k = Number(svg.match(/scale\(([\d.]+)\)/)![1]);
      const [x, y, w, h] = svg.match(/<clipPath id="panel"><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/)!.slice(1).map(Number);
      expect(x * k, position).toBeGreaterThanOrEqual(0);
      expect(y * k, position).toBeGreaterThanOrEqual(0);
      expect((x + w) * k, position).toBeLessThanOrEqual(W + 0.5);
      expect((y + h) * k, position).toBeLessThanOrEqual(H + 0.5);
      if (position.startsWith("top")) expect(y * k).toBeLessThan(H / 2);
      if (position.startsWith("bottom")) expect(y * k).toBeGreaterThan(H / 2);
    }
  });

  it("honours the show/hide switches and the button rule", () => {
    const on = carouselSvg(items, CAROUSEL_DEFAULTS, frame, fonts, new Map(), "$");
    expect(on).toContain("$245.00");
    // Two buyable products, two buttons; the one with no price has none.
    expect((on.match(new RegExp(`>${CAROUSEL_DEFAULTS.buttonLabel}<`, "g")) ?? []).length).toBe(2);
    const off = carouselSvg(items, { ...CAROUSEL_DEFAULTS, showPrice: false, showButton: false, showTitle: false }, frame, fonts, new Map(), "$");
    expect(off).not.toContain("$245.00");
    expect(off).not.toContain(CAROUSEL_DEFAULTS.buttonLabel);
    expect(off).not.toContain("Gold Crinkle");
  });

  it("escapes product text and renders to a PNG", () => {
    const svg = carouselSvg([prod({ name: `Bag <script>&"` })], CAROUSEL_DEFAULTS, frame, fonts, new Map(), "$");
    expect(svg).not.toContain("<script>");
    const png = svgToPng(svg);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(svgToPng(endListSvg(items, { ...CAROUSEL_DEFAULTS, commerceEnabled: false }, frame, fonts, new Map(), "$")).length).toBeGreaterThan(1000);
  });

  it("truncates long names with an ellipsis instead of overflowing", () => {
    const t = fitText(fonts.semibold, "An extraordinarily long product name here", 11, 80);
    expect(t.endsWith("…")).toBe(true);
    expect(fonts.semibold.getAdvanceWidth(t, 11)).toBeLessThanOrEqual(80);
    expect(fitText(fonts.semibold, "Bag", 11, 80)).toBe("Bag");
  });

  it("turns the player's rgba colours into fill and opacity", () => {
    expect(svgPaint("rgba(0, 0, 0, 0.5)")).toEqual({ fill: "#000000", opacity: 0.5 });
    expect(svgPaint("#1351aa")).toEqual({ fill: "#1351aa", opacity: 1 });
    expect(svgPaint("url(javascript:x)")).toEqual({ fill: "#000000", opacity: 1 });
  });

  it("keeps the source size, long side at most 1280, even numbers", () => {
    expect(outputSize(720, 1280)).toEqual({ W: 720, H: 1280 });
    expect(outputSize(1080, 1920)).toEqual({ W: 720, H: 1280 });
    expect(outputSize(1279, 719)).toEqual({ W: 1280, H: 720 });
  });
});

describe("what the server will fetch", () => {
  it("never a private, loopback or link-local address", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("product images: https only, public only, data URLs only when images", async () => {
    expect(await fetchImageDataUrl("http://example.com/a.jpg")).toBeNull();
    expect(await fetchImageDataUrl("https://127.0.0.1/a.jpg")).toBeNull();
    expect(await fetchImageDataUrl("https://169.254.169.254/latest/meta-data")).toBeNull();
    expect(await fetchImageDataUrl("file:///etc/passwd")).toBeNull();
    expect(await fetchImageDataUrl("data:text/html;base64,PGgxPg==")).toBeNull();
    expect(await fetchImageDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("the video only from the platform's own hosts, over https", () => {
    expect(isAllowedVideoUrl("https://vz-97d498f7-34a.b-cdn.net/x/play_720p.mp4", {})).toBe(true);
    expect(isAllowedVideoUrl("https://res.cloudinary.com/demo/video/upload/a.mp4", {})).toBe(true);
    expect(isAllowedVideoUrl("http://vz-1.b-cdn.net/a.mp4", {})).toBe(false);
    expect(isAllowedVideoUrl("file:///etc/passwd", {})).toBe(false);
    expect(isAllowedVideoUrl("https://evil.example/a.mp4", {})).toBe(false);
    expect(isAllowedVideoUrl("https://b-cdn.net.evil.example/a.mp4", {})).toBe(false);
  });

  it("ffmpeg is told to use https and nothing else", () => {
    const src = code("server/shareClip.ts");
    expect(src).toMatch(/const HTTPS_ONLY = \["-protocol_whitelist", "https,tls,tcp"\];/);
    expect(src).toMatch(/"-y", \.\.\.HTTPS_ONLY, "-t"/);
    expect(src).toMatch(/if \(!isAllowedVideoUrl\(input\.videoUrl\)\) throw/);
  });
});

describe("who can use it", () => {
  const routes = code("server/routes.ts");
  for (const path of ['app.post("/api/videos/:id/share-clip"', 'app.get("/api/videos/:id/share-clip/:jobId"', 'app.get("/api/videos/:id/share-clip/:jobId/file"']) {
    it(`${path} needs the video's editor, and a job belongs to its video`, () => {
      const at = routes.indexOf(path);
      expect(at).toBeGreaterThan(-1);
      const body = routes.slice(at, routes.indexOf("\n  app.", at + 10));
      expect(body).toMatch(/await videoEditorOr403\(req, res\)/);
      if (!path.startsWith("app.post")) expect(body).toMatch(/job\.videoId !== ok\.video\.id/);
    });
  }

  it("the clip shows what the player shows: same rows, same settings, same name cap", () => {
    const helper = routes.slice(routes.indexOf("async function shareClipInput"), routes.indexOf("const clipView"));
    expect(helper).toMatch(/storage\.getVideoProductOverlays\(video\.id\)/);
    expect(helper).toMatch(/resolveEmbedSettings\(brandKit \?\? null, override \?\? null\)/);
    expect(helper).toMatch(/buyable: o\.priceCents != null && o\.priceCents > 0/);
    expect(helper).toMatch(/const NAME_LIMIT = 25;/);
  });

  it("the Preview screen offers it before the embed code", () => {
    const modal = code("client/src/components/EmbedCodeModal.tsx");
    expect(modal.indexOf("<ShareClipPanel")).toBeGreaterThan(-1);
    expect(modal.indexOf("<ShareClipPanel")).toBeLessThan(modal.indexOf('data-testid="button-toggle-embed-code"'));
  });
});

describe("the clip cache", () => {
  it("a new renderer version never hands out a clip drawn by the old one", async () => {
    const { clipKey, RENDER_VERSION } = await import("../../server/shareClip");
    const input = { videoUrl: "https://vz-1.b-cdn.net/a/play_720p.mp4", products: [], settings: CAROUSEL_DEFAULTS, currency: "$" };
    expect(RENDER_VERSION).toBeGreaterThanOrEqual(2);
    expect(clipKey("v1", input)).toBe(clipKey("v1", input));
    expect(clipKey("v1", input)).not.toBe(clipKey("v2", input));
    expect(clipKey("v1", input)).not.toBe(clipKey("v1", { ...input, settings: { ...CAROUSEL_DEFAULTS, position: "top" } }));
    expect(code("server/shareClip.ts")).toMatch(/v: RENDER_VERSION, \.\.\.input/);
  });
});
