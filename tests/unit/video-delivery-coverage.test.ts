/**
 * Every surface that plays a STORED video must go through videoDeliveryUrl.
 *
 * ── The problem this exists for ──────────────────────────────────────────────
 * Uploads are stored as originals. A phone shooting in "most compatible" off is
 * an HEVC .mov — the client's first real upload was video/quicktime;codecs=hvc1
 * at 104MB. Safari plays that; Chrome and Firefox do not, so the player is a
 * black box with working controls.
 *
 * videoDeliveryUrl fixes it as a side effect of the bandwidth work: f_auto makes
 * Cloudinary re-encode per browser, and the same asset comes back to Chrome as
 * video/mp4;codecs=avc1 at 8.7MB. Measured, not assumed.
 *
 * The trap is that this is invisible when it is missing. A <video> pointed at
 * the raw stored URL looks correct in review, passes typecheck, and plays
 * perfectly for anyone testing on a Mac — which is how three of these got
 * written. It only fails for the people least likely to be in the room.
 *
 * So the rule is enforced by file rather than by hoping: any component that
 * renders a video from a stored URL imports the helper.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Source with comments stripped.
 *
 * The first version of this test asserted the file merely CONTAINED
 * "videoDeliveryUrl" — and passed against a file where the call had been
 * deleted, because the comment explaining the call still mentioned it by name.
 * A guard that its own documentation satisfies is not a guard.
 */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Files that put a stored (database-sourced) video URL into a player.
 *
 * Not every <video> in the codebase: a purely local blob: preview never touches
 * Cloudinary and needs nothing. These are the ones whose src can be an original.
 */
const MUST_TRANSFORM = [
  "client/src/components/VideoPlayerWithCarousel.tsx",
  "client/src/components/CarouselPreviewFrame.tsx",
  "client/src/components/DemoPopup.tsx",
  "client/src/pages/profile.tsx",
  "client/src/pages/brand-inventory.tsx",
];

describe("stored videos are delivered, not served raw", () => {
  it.each(MUST_TRANSFORM)("%s calls videoDeliveryUrl", (file) => {
    const src = code(file);
    expect(src, "must import the helper").toMatch(
      /import\s*\{[^}]*videoDeliveryUrl[^}]*\}\s*from\s*"@shared\/videoDelivery"/,
    );
    expect(src, "must actually call it").toMatch(/videoDeliveryUrl\(/);
  });

  it("the embed transforms too — it is someone else's page", () => {
    const routes = code("server/routes.ts");
    expect(routes).toContain('videoDeliveryUrl(video.videoUrl, "embed")');
  });

  /**
   * Uploads never set thumbnailUrl, so without a generated poster every freshly
   * published video shows the same grey placeholder and a creator cannot tell
   * their own campaigns apart.
   */
  it("cards fall back to a frame from the video when there is no thumbnail", () => {
    const card = code("client/src/components/VideoCard.tsx");
    expect(card).toContain("videoPosterUrl");
    expect(card).toMatch(/video\.thumbnailUrl \|\| videoPosterUrl\(video\.videoUrl\)/);
  });

  /** f_auto is the whole mechanism — without it nothing is re-encoded. */
  it("every delivery profile asks Cloudinary to pick the format", () => {
    const src = read("shared/videoDelivery.ts");
    const profiles = src.slice(src.indexOf("const PROFILES"), src.indexOf("/** True when this looks"));
    const lines = profiles.split("\n").filter((l) => l.includes('"f_') || l.includes("f_auto"));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l).toContain("f_auto");
  });
});
