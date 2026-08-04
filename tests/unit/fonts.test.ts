/**
 * Every font offered must actually render.
 *
 * The carousel picker listed eight fonts, two of which could never work:
 * "Public Pixel" existed nowhere in the project, and "Oswald" was offered but
 * absent from the Google Fonts request in index.html. Both silently fell back
 * to system-ui, so the setting saved and changed nothing — indistinguishable
 * from a broken feature, and reported as one by the client.
 *
 * These tests pin the invariant that caused it: the offered list and the
 * loadable list must not drift apart.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { FONT_OPTIONS } from "../../shared/schema";
import { BUILT_IN_FONTS, fontStack } from "../../client/src/lib/fonts";

const ROOT = join(__dirname, "..", "..");
const indexHtml = readFileSync(join(ROOT, "client/index.html"), "utf8");
const indexCss = readFileSync(join(ROOT, "client/src/index.css"), "utf8");

/** A font renders if Google Fonts loads it, or a local @font-face declares it. */
function isLoadable(label: string): boolean {
  if (label === "System Default" || label === "System default") return true;
  const googleName = label.replace(/\s+/g, "+");
  if (indexHtml.includes(`family=${googleName}`)) return true;
  return new RegExp(`font-family:\\s*['"]${label}['"]`, "i").test(indexCss);
}

describe("FONT_OPTIONS — every offered font can render", () => {
  for (const opt of FONT_OPTIONS) {
    it(`"${opt.label}" is actually available`, () => {
      expect(isLoadable(opt.label)).toBe(true);
    });
  }

  it("no longer offers the two that never worked", () => {
    const labels = FONT_OPTIONS.map((o) => o.label);
    expect(labels).not.toContain("Public Pixel");
    expect(labels).not.toContain("Oswald");
  });
});

describe("the offered list and the stack list stay in step", () => {
  it("every FONT_OPTIONS value has a CSS stack", () => {
    const stacks = new Set(BUILT_IN_FONTS.map((f) => f.value));
    for (const opt of FONT_OPTIONS) expect(stacks.has(opt.value)).toBe(true);
  });
});

describe("fontStack", () => {
  it("resolves a built-in value to its real family", () => {
    expect(fontStack("playfair")).toContain("Playfair Display");
    expect(fontStack("aileron")).toContain("Aileron");
  });

  it("falls back to the system stack for nothing / unknown-but-empty", () => {
    expect(fontStack(undefined)).toContain("system-ui");
    expect(fontStack(null)).toContain("system-ui");
  });

  it("quotes a custom Google font name", () => {
    expect(fontStack("Bebas Neue")).toBe("'Bebas Neue', sans-serif");
  });

  it("strips quotes from a name so it cannot break out of the CSS value", () => {
    expect(fontStack("Ev'il")).toBe("'Evil', sans-serif");
  });
});
