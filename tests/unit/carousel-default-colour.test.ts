/**
 * The green must not come back, and must stay defined in exactly one place.
 *
 * #314d3b has now been removed twice. The first sweep changed app chrome and
 * missed --cta, so every default Button stayed green. The second sweep fixed
 * --cta and missed the product-carousel defaults, which were hardcoded in five
 * separate files — so a creator opening the upload modal still met a green BUY
 * NOW, and so did any brand that had never picked a colour.
 *
 * Both misses have the same shape: a colour written as a literal in more than
 * one place cannot be changed in one edit, and a grep for the *chrome* does not
 * find the *defaults*. These tests pin both properties — no hardcoded green
 * anywhere, and one definition for the carousel default.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  CAROUSEL_DEFAULT_BUTTON_COLOR,
  CAROUSEL_DEFAULT_BUTTON_TEXT_COLOR,
} from "../../client/src/lib/carouselDefaults";

const ROOTS = ["client/src", "server", "shared"];
const EXTS = [".ts", ".tsx", ".css"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, out);
    } else if (EXTS.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(r));

describe("the retired green", () => {
  it("appears in no source file as a colour value", () => {
    // Quoted or in a CSS declaration — i.e. actually used as a colour. A prose
    // mention in a comment explaining the history is fine and deliberate.
    const asValue = /(["'`]#314d3b["'`]|:\s*#314d3b\b)/i;

    const offenders = FILES.filter((f) => asValue.test(readFileSync(f, "utf8")));

    expect(offenders, `hardcoded #314d3b in:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});

describe("the carousel default colour", () => {
  it("is the MTRLZD accent, not a green", () => {
    expect(CAROUSEL_DEFAULT_BUTTON_COLOR.toLowerCase()).toBe("#1351aa");
    expect(CAROUSEL_DEFAULT_BUTTON_TEXT_COLOR.toUpperCase()).toBe("#FFFFFF");
  });

  // Deliberately NOT asserted: that #1351aa appears in only one file. The accent
  // is used as a Tailwind arbitrary value all over the app for unrelated
  // styling, and forbidding that would be a rule about the wrong thing. What
  // matters is the next test — that the carousel defaults go through the
  // constant instead of each holding their own copy.

  it("is what every carousel default object uses", () => {
    // Each of these declares a default carousel settings object. If one grows a
    // literal colour again, the import disappears and this fails.
    for (const f of [
      "client/src/components/ProductCarouselEditor.tsx",
      "client/src/components/VideoProductCarousel.tsx",
      "client/src/components/VideoPlayerWithCarousel.tsx",
      "client/src/pages/brand-kit.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} no longer imports the shared default`).toContain(
        "CAROUSEL_DEFAULT_BUTTON_COLOR",
      );
    }
  });
});
