/**
 * Carousel settings: defaults, inheritance, and colour.
 *
 * ── What went wrong before ───────────────────────────────────────────────────
 * The settings shape existed in two files with the database mapping written out
 * by hand in each, and they drifted. The Brand Kit preview honoured two of the
 * eight positions, so "bottom-right" drew bottom-centre — the value saved
 * correctly and only the picture lied, which is the hardest kind of bug to
 * report. The client concluded the positioning options did not exist.
 *
 * The mapping is now generated from one list. These tests defend the two
 * properties that make that safe: every setting survives a round trip, and
 * "not set" never overwrites something that is.
 */
import { describe, it, expect } from "vitest";
import {
  CAROUSEL_DEFAULTS, settingsFromBrandKit, brandKitFromSettings, applyOverride,
  panelBackground, buttonBackground, withAlpha, isStackedPosition,
  type CarouselSettings,
} from "../../shared/carousel";

describe("the defaults", () => {
  it("gives every setting a concrete value — none undefined", () => {
    // A half-populated settings object is how a colour input ends up rendering
    // the string "undefined" instead of a colour.
    for (const [k, v] of Object.entries(CAROUSEL_DEFAULTS)) {
      expect(v, `${k} has no default`).toBeDefined();
      expect(v, `${k} is null`).not.toBeNull();
    }
  });

  it("keeps the look the hard-coded carousel already had", () => {
    // These two reproduce the previous `rgba(0,0,0,opacity)` panel exactly, so
    // an already-published carousel does not change appearance the day this
    // ships. It changes when someone edits it, and not before.
    expect(CAROUSEL_DEFAULTS.carouselBackgroundColor).toBe("#000000");
    expect(CAROUSEL_DEFAULTS.backgroundOpacity).toBe(55);
  });

  it("keeps the button and the panel on separate radii", () => {
    // One value used to drive both, so a square panel forced square buttons.
    expect(CAROUSEL_DEFAULTS.buttonCornerRadius).not.toBe(CAROUSEL_DEFAULTS.cornerRadius);
  });

  it("has commerce on, because that is what the product does", () => {
    expect(CAROUSEL_DEFAULTS.commerceEnabled).toBe(true);
  });
});

describe("round-tripping through a brand kit", () => {
  const custom: CarouselSettings = {
    ...CAROUSEL_DEFAULTS,
    position: "bottom-right",
    carouselBackgroundColor: "#1f1b6d",
    backgroundOpacity: 80,
    cornerRadius: 30,
    buttonColor: "#1650a8",
    buttonHoverColor: "#0a275b",
    buttonOpacity: 90,
    buttonCornerRadius: 15,
    brandTitleColor: "#ffffff",
    productTitleColor: "#cfd8ea",
    commerceEnabled: false,
  };

  it("survives a save and a reload unchanged", () => {
    const row = brandKitFromSettings(custom);
    const back = settingsFromBrandKit(row);
    // Offsets and delay live only on a per-video override, never on the kit.
    const { positionOffsetX, positionOffsetY, delayUntilEnd, ...shared } = custom;
    expect(back).toMatchObject(shared);
  });

  it("writes to the default* columns the schema actually has", () => {
    const row = brandKitFromSettings(custom);
    expect(row).toHaveProperty("defaultCarouselBackgroundColor", "#1f1b6d");
    expect(row).toHaveProperty("defaultButtonCornerRadius", 15);
    expect(row).toHaveProperty("defaultCommerceEnabled", false);
    expect(row).toHaveProperty("defaultPosition", "bottom-right");
  });

  it("falls back to defaults for a kit that predates a setting", () => {
    // Every column added by 0022 is NULL on existing rows.
    const old = { defaultButtonColor: "#abcdef", defaultCarouselBackgroundColor: null };
    const s = settingsFromBrandKit(old);
    expect(s.buttonColor).toBe("#abcdef");
    expect(s.carouselBackgroundColor).toBe(CAROUSEL_DEFAULTS.carouselBackgroundColor);
  });

  it("treats no brand kit at all as pure defaults", () => {
    expect(settingsFromBrandKit(null)).toEqual(CAROUSEL_DEFAULTS);
  });
});

describe("a per-video override", () => {
  const base = { ...CAROUSEL_DEFAULTS, buttonColor: "#111111", cornerRadius: 20 };

  it("replaces only what it actually sets", () => {
    const out = applyOverride(base, { buttonColor: "#ff0000" });
    expect(out.buttonColor).toBe("#ff0000");
    expect(out.cornerRadius).toBe(20); // untouched
  });

  it("treats null as inherit, not as clear", () => {
    // This is the entire meaning of a nullable override column. If null won,
    // saving one field on one video would wipe every other setting on it.
    const out = applyOverride(base, { buttonColor: null, cornerRadius: undefined });
    expect(out.buttonColor).toBe("#111111");
    expect(out.cornerRadius).toBe(20);
  });

  it("carries the offsets and delay that only it has", () => {
    const out = applyOverride(base, { positionOffsetX: 12, delayUntilEnd: true });
    expect(out.positionOffsetX).toBe(12);
    expect(out.delayUntilEnd).toBe(true);
  });

  it("lets a video turn commerce off while the kit leaves it on", () => {
    expect(base.commerceEnabled).toBe(true);
    expect(applyOverride(base, { commerceEnabled: false }).commerceEnabled).toBe(false);
  });

  it("does not let `false` be mistaken for unset", () => {
    // A plain falsy check here would make every "off" toggle un-settable.
    const out = applyOverride({ ...base, showPrice: true }, { showPrice: false });
    expect(out.showPrice).toBe(false);
  });
});

describe("colour and opacity", () => {
  it("keeps colour and transparency independent", () => {
    // Two separate controls in the client's list. Changing one must not reset
    // the other, which is why opacity is stored apart from the hex.
    expect(withAlpha("#1f1b6d", 80)).toBe("rgba(31, 27, 109, 0.8)");
    expect(withAlpha("#1f1b6d", 100)).toBe("rgba(31, 27, 109, 1)");
    expect(withAlpha("#1f1b6d", 0)).toBe("rgba(31, 27, 109, 0)");
  });

  it("expands three-digit hex", () => {
    expect(withAlpha("#fff", 100)).toBe("rgba(255, 255, 255, 1)");
  });

  it("accepts a hex with or without the hash", () => {
    expect(withAlpha("1f1b6d", 50)).toBe(withAlpha("#1f1b6d", 50));
  });

  it("returns junk untouched rather than rgba(NaN,NaN,NaN)", () => {
    // NaN renders as transparent black — indistinguishable from the carousel
    // having vanished, which is a support ticket rather than a visible error.
    for (const junk of ["", "not-a-colour", "#12345", "rgb(1,2,3)"]) {
      expect(withAlpha(junk, 50)).toBe(junk);
    }
  });

  it("clamps opacity outside 0–100", () => {
    expect(withAlpha("#000000", 150)).toBe("rgba(0, 0, 0, 1)");
    expect(withAlpha("#000000", -20)).toBe("rgba(0, 0, 0, 0)");
  });

  it("builds the panel and the button from their own colour and opacity", () => {
    const s = { ...CAROUSEL_DEFAULTS, carouselBackgroundColor: "#112233", backgroundOpacity: 50,
                buttonColor: "#445566", buttonOpacity: 25 };
    expect(panelBackground(s)).toBe("rgba(17, 34, 51, 0.5)");
    expect(buttonBackground(s)).toBe("rgba(68, 85, 102, 0.25)");
  });
});

describe("the stacking rule", () => {
  it("stacks on the sides and runs side by side elsewhere", () => {
    expect(isStackedPosition("left")).toBe(true);
    expect(isStackedPosition("right")).toBe(true);
    for (const p of ["top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"]) {
      expect(isStackedPosition(p)).toBe(false);
    }
  });
});
