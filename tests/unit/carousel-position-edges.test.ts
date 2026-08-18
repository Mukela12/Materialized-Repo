/**
 * A positioned carousel must anchor to its corner, not stretch to the frame.
 *
 * ── The bug this exists for ──────────────────────────────────────────────────
 * positionCss emits a block appended AFTER the base #carousel rule, which sets
 * bottom, left and right. Naming only the edges a position cares about left the
 * rest of the base in force. "top-right" set top and right; bottom and left
 * survived; the element was anchored to all four and filled the whole video.
 *
 * Measured on the live embed before the fix, on a 768x432 frame:
 *   #carousel  top 15.36  left 15.36  right 15.36  bottom 15.36
 *              background rgba(0,0,0,0.55)  children 0
 *
 * a full-frame translucent slab over the footage. The client reported it as
 * "blank container sits over the video on the left side".
 *
 * Only `bottom` escaped, because it overwrites every edge the base sets — so
 * the default looked right and all seven other choices in the picker did not.
 */
import { describe, it, expect } from "vitest";
import { embedCarouselCss } from "../../server/embedCarousel";
import type { CarouselSettings } from "@shared/carousel";

const POSITIONS = [
  "top", "bottom", "left", "right",
  "top-left", "top-right", "bottom-left", "bottom-right",
] as const;

/** The base rule this block is layered on top of, from the embed document. */
const BASE_EDGES = ["bottom", "left", "right"];

function cssFor(position: string): string {
  return embedCarouselCss({
    position, positionOffsetX: 0, positionOffsetY: 0,
    commerceEnabled: true, cornerRadius: 16, backgroundOpacity: 55,
  } as unknown as CarouselSettings);
}

/** The `#carousel{...}` block, which is the one layered over the base. */
function carouselBlock(css: string): string {
  const at = css.indexOf("#carousel{");
  expect(at, "no #carousel block").toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("carousel position anchors rather than stretches", () => {
  it.each(POSITIONS)("%s neutralises every base edge it does not use", (position) => {
    const block = carouselBlock(cssFor(position));

    // Whatever it anchors, it must have an opinion about all four edges —
    // otherwise a base edge survives and the element stretches.
    for (const edge of ["top", "bottom", "left", "right"]) {
      const declared = new RegExp(`[;{\\n]\\s*${edge}\\s*:`).test(block);
      const isBase = BASE_EDGES.includes(edge);
      if (isBase) {
        expect(declared, `${position}: must override base edge "${edge}"`).toBe(true);
      }
    }
  });

  it.each(POSITIONS)("%s is never anchored to all four edges at once", (position) => {
    const block = carouselBlock(cssFor(position));
    const anchored = ["top", "bottom", "left", "right"].filter((edge) => {
      const m = block.match(new RegExp(`[;{\\n]\\s*${edge}\\s*:\\s*([^;\\n]+)`));
      // An edge set to auto is not an anchor — that is the whole point.
      return !!m && m[1].trim() !== "auto";
    });
    expect(anchored.length, `${position} anchored: ${anchored.join(",")}`).toBeLessThan(4);
  });

  it("top-right anchors top and right only — the reported case", () => {
    const block = carouselBlock(cssFor("top-right"));
    expect(block).toMatch(/[;{\n]\s*bottom\s*:\s*auto/);
    expect(block).toMatch(/[;{\n]\s*left\s*:\s*auto/);
  });
});
