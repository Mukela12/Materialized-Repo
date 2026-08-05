/**
 * Video delivery URLs.
 *
 * These are the bytes the business runs on. Measured on the live CDN, one demo
 * video is 23.74 MB delivered raw and 6.15 MB through the player profile. At
 * $0.005 a view the raw version costs more to serve than we charge; the
 * transformed one costs about a fifth of it. So the properties below are not
 * cosmetic — "the transform is actually present" is the margin.
 *
 * The failure mode most worth pinning is DOUBLE application. Stored URLs,
 * hand-written marketing URLs and already-optimised embed URLs all flow through
 * the same call sites, and `w_1080/w_720/<file>` is not a URL Cloudinary serves
 * — it is a broken player with no error in the console.
 */
import { describe, it, expect } from "vitest";
import { videoDeliveryUrl, videoPosterUrl } from "../../shared/videoDelivery";

const RAW =
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609780/materialized/public/croissant-demo.mp4";

describe("adding the transformation", () => {
  it("inserts one, right after /video/upload/", () => {
    const out = videoDeliveryUrl(RAW);
    expect(out).toContain("/video/upload/f_auto,q_auto:good,w_1080,c_limit/");
  });

  it("keeps the version and the path intact", () => {
    expect(videoDeliveryUrl(RAW)).toContain("/v1775609780/materialized/public/croissant-demo.mp4");
  });

  it("only ever shrinks — c_limit, so a 720 source is not upscaled to 1080", () => {
    // Upscaling would make the delivered file BIGGER than the original, which
    // is the opposite of the point.
    for (const ctx of ["player", "embed", "preview", "thumbnail"] as const) {
      expect(videoDeliveryUrl(RAW, ctx)).toContain("c_limit");
    }
  });

  it("gives each surface its own width", () => {
    expect(videoDeliveryUrl(RAW, "player")).toContain("w_1080");
    expect(videoDeliveryUrl(RAW, "embed")).toContain("w_720");
    expect(videoDeliveryUrl(RAW, "preview")).toContain("w_720");
  });

  it("always asks for automatic format and quality", () => {
    for (const ctx of ["player", "embed", "preview", "thumbnail"] as const) {
      const out = videoDeliveryUrl(RAW, ctx);
      expect(out).toContain("f_auto");
      expect(out).toMatch(/q_auto/);
    }
  });
});

describe("not applying it twice", () => {
  it("leaves an already-transformed URL alone", () => {
    const once = videoDeliveryUrl(RAW);
    expect(videoDeliveryUrl(once)).toBe(once);
  });

  it("is stable however many times it is called", () => {
    let u = RAW;
    for (let i = 0; i < 5; i++) u = videoDeliveryUrl(u);
    expect(u.match(/w_1080/g)).toHaveLength(1);
  });

  it("respects a width somebody wrote by hand, rather than overriding it", () => {
    const hand = "https://res.cloudinary.com/dvj7ayoot/video/upload/w_400/v1/a/b.mp4";
    expect(videoDeliveryUrl(hand)).toBe(hand);
  });

  it("does not mistake a folder for a transformation", () => {
    // "materialized" starts with no transform key; "so/" would. The regex
    // requires an underscore, so ordinary folder names must pass through.
    const noVersion = "https://res.cloudinary.com/dvj7ayoot/video/upload/materialized/x.mp4";
    expect(videoDeliveryUrl(noVersion)).toContain("/upload/f_auto,q_auto:good,w_1080,c_limit/materialized/x.mp4");
  });
});

describe("leaving alone what it does not own", () => {
  it("passes a blob preview through untouched", () => {
    const blob = "blob:http://localhost:5173/9f1c-4a";
    expect(videoDeliveryUrl(blob)).toBe(blob);
  });

  it("passes another host through untouched", () => {
    const other = "https://cdn.example.com/video/upload/x.mp4";
    expect(videoDeliveryUrl(other)).toBe(other);
  });

  it("does not touch Cloudinary IMAGE urls", () => {
    const img = "https://res.cloudinary.com/dvj7ayoot/image/upload/v1/a/b.jpg";
    expect(videoDeliveryUrl(img)).toBe(img);
  });

  it("returns a string for null and undefined, never undefined", () => {
    // It sits in src={...}. Returning undefined there blanks the player.
    expect(videoDeliveryUrl(null)).toBe("");
    expect(videoDeliveryUrl(undefined)).toBe("");
    expect(videoDeliveryUrl("")).toBe("");
  });
});

describe("poster frames", () => {
  it("takes the frame a second in, not the black first frame", () => {
    expect(videoPosterUrl(RAW)).toContain("so_1");
  });

  it("asks for a jpg, not an mp4", () => {
    const out = videoPosterUrl(RAW);
    expect(out.endsWith(".jpg")).toBe(true);
    expect(out).not.toContain(".mp4");
  });

  it("replaces an existing transform rather than stacking one", () => {
    const once = videoPosterUrl(RAW);
    expect(videoPosterUrl(once).match(/so_1/g)).toHaveLength(1);
  });

  it("passes a non-Cloudinary thumbnail through, so callers need not check", () => {
    expect(videoPosterUrl("https://example.com/t.jpg")).toBe("https://example.com/t.jpg");
    expect(videoPosterUrl(null)).toBe("");
  });
});
