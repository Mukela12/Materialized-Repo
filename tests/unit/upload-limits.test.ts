/**
 * The upload box must not promise what the plan refuses.
 *
 * ── The failure this exists for ──────────────────────────────────────────────
 * The box said "up to 500MB". The Cloudinary account is on the Free plan, which
 * caps video at 100 MiB. So the product advertised five times what it accepts,
 * and there was no size check and no error handler — a rejected upload threw
 * into nothing and the box returned to its idle state.
 *
 * The client dragged in a 469MB editorial, waited, and watched nothing happen.
 * Twice. There was no way for her to learn why from the screen.
 *
 * An earlier upload of hers succeeded at 103,698,819 bytes — 98.9 MiB — which
 * is how close to the ceiling the working case already was.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_VIDEO_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_LABEL, videoTooLargeMessage, formatBytes,
} from "../../shared/uploadLimits";

const MB = 1024 * 1024;

describe("the limit matches the plan", () => {
  it("is 100 MiB, the Free plan's video ceiling", () => {
    expect(MAX_VIDEO_UPLOAD_BYTES).toBe(100 * MB);
    expect(MAX_VIDEO_UPLOAD_LABEL).toBe("100MB");
  });

  it("accepts the size that actually worked in production", () => {
    // Her 18 Aug upload, measured off the CDN.
    expect(videoTooLargeMessage(103_698_819)).toBeNull();
  });

  it("refuses the size that did not", () => {
    const msg = videoTooLargeMessage(469 * MB);
    expect(msg).toBeTruthy();
    expect(msg).toContain("469MB");
    expect(msg).toContain("100MB");
  });

  it("accepts a file exactly on the line", () => {
    expect(videoTooLargeMessage(MAX_VIDEO_UPLOAD_BYTES)).toBeNull();
    expect(videoTooLargeMessage(MAX_VIDEO_UPLOAD_BYTES + 1)).toBeTruthy();
  });

  it("reads sizes the way a person would", () => {
    expect(formatBytes(469 * MB)).toBe("469MB");
    expect(formatBytes(2 * 1024 * MB)).toBe("2.0GB");
  });
});

describe("the screen agrees with the limit", () => {
  const modal = readFileSync(
    join(__dirname, "../../client/src/components/VideoUploadModal.tsx"), "utf8",
  );

  it("no longer advertises a number of its own", () => {
    expect(modal).not.toContain("up to 500MB");
    expect(modal).toContain("MAX_VIDEO_UPLOAD_LABEL");
  });

  /** The client asked for the limit to be visible before a file is chosen. */
  it("states the limit up front, not only in the failure", () => {
    expect(modal).toContain('data-testid="notice-upload-limit"');
    expect(modal).toContain("Maximum file size");
  });

  it("checks the size before starting a transfer", () => {
    const fn = modal.slice(modal.indexOf("const validateAndUpload"));
    const check = fn.indexOf("videoTooLargeMessage");
    const duration = fn.indexOf("getVideoDuration");
    expect(check).toBeGreaterThan(-1);
    // Before reading duration, which loads the whole file into a video element.
    expect(check).toBeLessThan(duration);
  });

  it("has somewhere for a failure to go", () => {
    expect(modal).toMatch(/onError:\s*\(err\)/);
    expect(modal).toContain("Upload failed");
  });
});

describe("the reason survives", () => {
  const hook = readFileSync(join(__dirname, "../../client/src/hooks/use-upload.tsx"), "utf8");

  it("keeps Cloudinary's message rather than only a status code", () => {
    expect(hook).toContain("error?.message");
    expect(hook).toMatch(/detail \|\| `Upload failed with status/);
  });
});

describe("overlays appear only during their own seconds", () => {
  const routes = readFileSync(join(__dirname, "../../server/routes.ts"), "utf8");

  /**
   * Two overlays on the client's Botnari interview, 5-20s and 22-40s, both
   * rendered from the first frame side by side under one long panel. The times
   * were stored, shown in the editor, and never sent to the player.
   */
  it("the embed payload carries the window", () => {
    expect(routes).toMatch(/startTime: Number\(o\.startTime \?\? 0\)/);
    expect(routes).toMatch(/endTime: o\.endTime == null \? null : Number\(o\.endTime\)/);
  });

  it("the player follows playback, and scrubbing", () => {
    expect(routes).toContain('vid.addEventListener("timeupdate",syncOverlays)');
    expect(routes).toContain('vid.addEventListener("seeked",syncOverlays)');
  });

  /** The panel carries the background, so an empty one is a smear on the video. */
  it("hides the panel when nothing is due", () => {
    const fn = routes.slice(routes.indexOf("function syncOverlays()"));
    expect(fn.slice(0, 400)).toContain('carousel.style.display=any?"":"none"');
  });
});
