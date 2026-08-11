/**
 * Nothing creator-controlled reaches a stylesheet unvalidated.
 *
 * ── Why this is a security boundary and not a tidiness one ───────────────────
 * Carousel colours and fonts are free-text columns a creator controls. The
 * embed is server-rendered HTML that runs INSIDE A BRAND'S OWN PAGE. So a
 * colour of
 *     #fff;} #pay{display:none} .x{
 * closes the rule it is written into and appends arbitrary CSS to a third
 * party's site: hide the checkout, cover the video, overlay anything anywhere.
 * A font of `x;} body{...` does the same from inside `font-family:`.
 *
 * The storage path offers no protection — the columns are `text`, and the admin
 * screen is not the only way to write them.
 *
 * The rule is fall back, not escape. An invalid colour has no correct
 * rendering, so the default is the only safe reading of it.
 */
import { describe, it, expect } from "vitest";
import {
  sanitiseSettings, safeColor, safeInt, safeEnum, CAROUSEL_DEFAULTS, withAlpha,
} from "../../shared/carousel";

/** Payloads that would each break out of a CSS declaration. */
const CSS_BREAKOUTS = [
  "#fff;} #pay{display:none} .x{",
  "red;}body{display:none}",
  "#000</style><script>alert(1)</script>",
  "expression(alert(1))",
  "url(javascript:alert(1))",
  "var(--x)",
  "#fff !important",
  "rgb(0,0,0)",
  "\\3c/style\\3e",
  "#fff\n}\n#carousel{opacity:0}",
];

describe("colours", () => {
  it("refuses every CSS break-out and falls back", () => {
    for (const payload of CSS_BREAKOUTS) {
      expect(safeColor(payload, "#1351aa"), `accepted: ${payload}`).toBe("#1351aa");
    }
  });

  it("accepts the two hex forms a colour input actually produces", () => {
    expect(safeColor("#1f1b6d", "#000000")).toBe("#1f1b6d");
    expect(safeColor("#FFF", "#000000")).toBe("#FFF");
    expect(safeColor("  #abc  ", "#000000")).toBe("#abc");
  });

  it("refuses anything that is not a hex colour", () => {
    for (const v of ["", "red", "1f1b6d", "#12345", "#gggggg", null, undefined, 42, {}]) {
      expect(safeColor(v, "#1351aa")).toBe("#1351aa");
    }
  });

  it("cannot produce a value containing a brace, semicolon or angle bracket", () => {
    // The property that actually matters, stated directly.
    for (const payload of CSS_BREAKOUTS) {
      const out = safeColor(payload, "#1351aa");
      expect(out).not.toMatch(/[{};<>()]/);
    }
  });
});

describe("numbers", () => {
  it("clamps rather than trusting", () => {
    expect(safeInt(999, 0, 100, 55)).toBe(100);
    expect(safeInt(-5, 0, 100, 55)).toBe(0);
    expect(safeInt(50, 0, 100, 55)).toBe(50);
  });

  it("falls back on anything non-numeric", () => {
    for (const v of ["", "abc", null, undefined, NaN, Infinity, {}, "12px;}"]) {
      expect(safeInt(v, 0, 100, 55)).toBe(55);
    }
  });

  it("rounds, so no fractional pixel string reaches CSS", () => {
    expect(safeInt(12.7, 0, 100, 0)).toBe(13);
    expect(Number.isInteger(safeInt("8.2", 0, 100, 0))).toBe(true);
  });

  it("reads a numeric string, because that is what a form field gives", () => {
    expect(safeInt("30", 0, 100, 0)).toBe(30);
  });
});

describe("enums", () => {
  it("only ever returns a member of the allowed list", () => {
    const allowed = ["bottom", "top", "left"] as const;
    expect(safeEnum("top", allowed, "bottom")).toBe("top");
    expect(safeEnum("TOP", allowed, "bottom")).toBe("top");
    for (const v of ["sideways", "", null, undefined, "top;}x{", 7]) {
      expect(allowed).toContain(safeEnum(v, allowed, "bottom"));
    }
  });
});

describe("sanitising a whole settings object", () => {
  it("returns every field, so a caller cannot forget one", () => {
    const out = sanitiseSettings({});
    expect(Object.keys(out).sort()).toEqual(Object.keys(CAROUSEL_DEFAULTS).sort());
  });

  it("neutralises a hostile row completely", () => {
    const hostile: any = {
      carouselBackgroundColor: "#000;} #pay{display:none} .x{",
      buttonColor: "</style><script>alert(1)</script>",
      buttonTextColor: "expression(alert(1))",
      buttonHoverColor: "url(javascript:alert(1))",
      brandTitleColor: "red !important",
      productTitleColor: "var(--leak)",
      buttonFont: "x;} body{display:none} .y{",
      titleFont: "Arial'; background:url(//evil)",
      position: "bottom;}#carousel{opacity:0}",
      buttonLabel: "<img src=x onerror=alert(1)>",
      cornerRadius: "12px;}",
      buttonOpacity: 99999,
      backgroundOpacity: -400,
    };
    const out = sanitiseSettings(hostile);

    // Every string field is now free of anything that can escape a context.
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === "string") {
        expect(v, `${k} still contains punctuation`).not.toMatch(/[{};<>()'"\\]/);
      }
    }
    expect(out.buttonOpacity).toBe(100);
    expect(out.backgroundOpacity).toBe(0);
    expect(out.cornerRadius).toBe(CAROUSEL_DEFAULTS.cornerRadius);
  });

  it("keeps a legitimate row intact — it must not be so strict it is useless", () => {
    const real = {
      carouselBackgroundColor: "#1f1b6d",
      buttonColor: "#1650a8",
      buttonHoverColor: "#0a275b",
      productTitleColor: "#ffffff",
      cornerRadius: 30,
      buttonCornerRadius: 15,
      backgroundOpacity: 80,
      buttonOpacity: 90,
      position: "bottom-right" as const,
      commerceEnabled: false,
    };
    expect(sanitiseSettings(real)).toMatchObject(real);
  });

  it("survives null, which is what an absent brand kit looks like", () => {
    expect(sanitiseSettings(null)).toEqual(CAROUSEL_DEFAULTS);
    expect(sanitiseSettings(undefined)).toEqual(CAROUSEL_DEFAULTS);
  });

  it("produces colours that withAlpha can always parse", () => {
    // withAlpha returns its input untouched on junk. Feeding it sanitised
    // values is what guarantees it never emits a raw payload into a rule.
    const out = sanitiseSettings({ carouselBackgroundColor: "#fff;}x{" } as any);
    expect(withAlpha(out.carouselBackgroundColor, 50)).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
  });

  it("does not let false be replaced by a default", () => {
    // A plain `||` here would make every "off" toggle impossible to store.
    const out = sanitiseSettings({ commerceEnabled: false, showPrice: false } as any);
    expect(out.commerceEnabled).toBe(false);
    expect(out.showPrice).toBe(false);
  });
});
