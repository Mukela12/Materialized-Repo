/**
 * One overlay form, used in both places that write overlay rows.
 *
 * ── Why this is worth pinning ────────────────────────────────────────────────
 * The fields lived in VideoDetailSheet, reachable only after publishing. The
 * client makes sample shoppable videos by hand, so that put the step she
 * repeats behind the step she does once. Adding them to the upload flow was
 * either an extraction or a copy, and a copy of a nine-field form is a copy
 * that drifts: add a field to one, and rows written through the other silently
 * lack it.
 *
 * This repo has already paid that bill once — two call sites in the embed path
 * hand-rolled their own Cloudinary transformation strings with different
 * widths, so an embed and a widget of the same video disagreed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const COMPOSER = "client/src/components/OverlayComposer.tsx";
const CONSUMERS = [
  "client/src/components/VideoDetailSheet.tsx",
  "client/src/components/VideoUploadModal.tsx",
];

describe("the overlay form lives in one place", () => {
  it.each(CONSUMERS)("%s renders OverlayComposer", (file) => {
    const src = code(file);
    expect(src).toMatch(/import \{ OverlayComposer \} from "@\/components\/OverlayComposer"/);
    expect(src).toMatch(/<OverlayComposer\b/);
  });

  /**
   * The fields themselves must exist in exactly one file. If a second file
   * grows its own input-overlay-url, the copy has happened.
   */
  it.each(CONSUMERS)("%s does not carry its own copy of the fields", (file) => {
    expect(code(file)).not.toContain("input-overlay-url");
  });

  it("the composer has the manual fields the client asked for", () => {
    const src = code(COMPOSER);
    for (const id of [
      "input-overlay-name",
      "input-overlay-url",
      "input-overlay-price",
      "input-overlay-brand",
      "input-overlay-start",
      "input-overlay-end",
      "select-overlay-position",
    ]) {
      expect(src, `missing ${id}`).toContain(id);
    }
  });

  /**
   * Overlays are rows against a videoId, so the upload flow can only show this
   * once the draft exists. Mounting it unguarded would POST to
   * /api/videos/undefined/overlays.
   */
  it("the upload flow only mounts it once a draft video exists", () => {
    expect(code("client/src/components/VideoUploadModal.tsx"))
      .toMatch(/createdVideoId &&\s*\(?\s*<OverlayComposer/);
  });

  it("writes manual overlays, not AI-sourced ones", () => {
    expect(code(COMPOSER)).toMatch(/source:\s*"manual"/);
  });
});
