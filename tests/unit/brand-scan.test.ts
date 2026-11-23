/**
 * A scanned Brand Kit applied to the product carousel (client, 23 Nov 2026:
 * "ensure that it scans and applies these settings to the product carousel,
 * and holds it as a Default setting which can be over-written manually").
 *
 * The scan itself is a model reading a PDF. What is tested here is everything
 * after it: which colour goes where, that text stays readable, which fonts can
 * be used, and that the page saves the result as the default.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  carouselFromBrandScan, normaliseHex, contrast, readableOn, hoverShade, matchFont,
  READABLE_CONTRAST, BOLD_CONTRAST, LIGHT_PANEL_MIN_OPACITY,
} from "../../shared/brandScan";
import { CAROUSEL_DEFAULTS, sanitiseSettings, brandKitFromSettings, settingsFromBrandKit } from "../../shared/carousel";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("colour helpers", () => {
  it("reads hex with or without the #, short or long, and nothing else", () => {
    expect(normaliseHex("#1a2b3c")).toBe("#1A2B3C");
    expect(normaliseHex("1a2b3c")).toBe("#1A2B3C");
    expect(normaliseHex("#abc")).toBe("#AABBCC");
    for (const bad of ["null", "", "#12", "rgb(0,0,0)", "#12345g", null, undefined, 7, "#fff;}x{"]) {
      expect(normaliseHex(bad)).toBeNull();
    }
  });

  it("measures contrast the WCAG way", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#FFFFFF")).toBeLessThan(READABLE_CONTRAST);
  });

  it("picks the brand's colour when it reads, otherwise white or near-black", () => {
    expect(readableOn("#0B1F3A", ["#F5F0E6"])).toBe("#F5F0E6");
    expect(readableOn("#0B1F3A", ["#102A4D", null])).toBe("#FFFFFF");
    expect(readableOn("#FFE066", ["#FFF2B3"])).toBe("#111111");
    // A mid-tone red takes white, as the brand's own buttons would.
    expect(readableOn("#E63946", [])).toBe("#FFFFFF");
  });

  it("hovers darker, or lighter when the button is already near black", () => {
    expect(contrast(hoverShade("#E63946"), "#FFFFFF")).toBeGreaterThan(contrast("#E63946", "#FFFFFF"));
    expect(hoverShade("#000000")).not.toBe("#000000");
    expect(hoverShade("#E63946")).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("fonts the carousel can draw", () => {
  it("matches a built-in by name, ignoring case, spacing and a weight", () => {
    expect(matchFont("Montserrat")?.key).toBe("montserrat");
    expect(matchFont("playfair display")?.key).toBe("playfair");
    expect(matchFont("Playfair Display Bold")?.key).toBe("playfair");
    expect(matchFont("DM Sans Medium")?.key).toBe("dm-sans");
    expect(matchFont("Space-Grotesk")?.key).toBe("space-grotesk");
  });

  it("prefers a font the account uploaded", () => {
    const uploaded = [{ key: "custom:1f0c9c1e-0000-4000-8000-000000000001", label: "Canela" }];
    expect(matchFont("Canela", uploaded)?.key).toBe(uploaded[0].key);
    expect(matchFont("Canela Deck Light", uploaded)?.key).toBe(uploaded[0].key);
  });

  it("says no to a font it does not have, and never falls back to 'system'", () => {
    expect(matchFont("Helvetica Neue")).toBeNull();
    expect(matchFont("System Default")).toBeNull();
    expect(matchFont("")).toBeNull();
    expect(matchFont(null)).toBeNull();
  });
});

describe("a scan laid over the carousel", () => {
  const light = {
    colors: { primary: "#E63946", secondary: "#457B9D", accent: "#F4A261", background: "#FFFFFF", text: "#1D3557", additionalColors: [] },
    fonts: { headingFont: "Playfair Display", bodyFont: "Inter" },
  };

  it("puts the primary on the button and keeps its text readable", () => {
    const { settings } = carouselFromBrandScan(light, CAROUSEL_DEFAULTS);
    expect(settings.buttonColor).toBe("#E63946");
    expect(settings.buttonTextColor).toBe("#FFFFFF");
    expect(contrast(settings.buttonTextColor, settings.buttonColor)).toBeGreaterThanOrEqual(BOLD_CONTRAST);
    expect(settings.buttonHoverColor).not.toBe(settings.buttonColor);
  });

  it("puts the background on the panel, with titles that read on it", () => {
    const { settings } = carouselFromBrandScan(light, CAROUSEL_DEFAULTS);
    expect(settings.carouselBackgroundColor).toBe("#FFFFFF");
    expect(settings.productTitleColor).toBe("#1D3557");
    expect(settings.brandTitleColor).toBe("#1D3557");
    expect(contrast(settings.productTitleColor, settings.carouselBackgroundColor)).toBeGreaterThanOrEqual(READABLE_CONTRAST);
  });

  it("makes a light panel mostly opaque, and leaves a dark one alone", () => {
    expect(carouselFromBrandScan(light, CAROUSEL_DEFAULTS).settings.backgroundOpacity).toBe(LIGHT_PANEL_MIN_OPACITY);
    const dark = { colors: { primary: "#C9A227", background: "#0B0B0B", text: "#F5F0E6" } };
    const out = carouselFromBrandScan(dark, CAROUSEL_DEFAULTS).settings;
    expect(out.backgroundOpacity).toBe(CAROUSEL_DEFAULTS.backgroundOpacity);
    expect(out.carouselBackgroundColor).toBe("#0B0B0B");
    expect(out.productTitleColor).toBe("#F5F0E6");
    // Someone who had already chosen a more solid panel keeps it.
    expect(carouselFromBrandScan(light, { ...CAROUSEL_DEFAULTS, backgroundOpacity: 95 }).settings.backgroundOpacity).toBe(95);
  });

  it("never leaves the button the same colour as the panel", () => {
    const mono = { colors: { primary: "#FFFFFF", background: "#FFFFFF", text: "#111111" } };
    const out = carouselFromBrandScan(mono, CAROUSEL_DEFAULTS).settings;
    expect(out.buttonColor).toBe("#FFFFFF");
    expect(out.carouselBackgroundColor).toBe(CAROUSEL_DEFAULTS.carouselBackgroundColor);
    expect(contrast(out.buttonColor, out.carouselBackgroundColor)).toBeGreaterThan(1.5);
    expect(contrast(out.productTitleColor, out.carouselBackgroundColor)).toBeGreaterThanOrEqual(READABLE_CONTRAST);
  });

  it("replaces a brand pairing that cannot be read", () => {
    const faint = { colors: { primary: "#FFE066", background: "#FFF9DB", text: "#FFE8A1" } };
    const out = carouselFromBrandScan(faint, CAROUSEL_DEFAULTS).settings;
    expect(contrast(out.buttonTextColor, out.buttonColor)).toBeGreaterThanOrEqual(READABLE_CONTRAST);
    expect(contrast(out.productTitleColor, out.carouselBackgroundColor)).toBeGreaterThanOrEqual(READABLE_CONTRAST);
  });

  it("uses the heading font for titles and the body font for the button", () => {
    const { settings, applied, fontsToUpload } = carouselFromBrandScan(light, CAROUSEL_DEFAULTS);
    expect(settings.titleFont).toBe("playfair");
    expect(settings.buttonFont).toBe("inter");
    expect(fontsToUpload).toEqual([]);
    expect(applied.find((a) => a.field === "titleFont")).toMatchObject({ value: "Playfair Display", kind: "font" });
  });

  it("names the fonts it could not use, once each, and leaves those settings alone", () => {
    const scan = { colors: {}, fonts: { headingFont: "Canela", bodyFont: "Canela" } };
    const before = { ...CAROUSEL_DEFAULTS, titleFont: "lora", buttonFont: "inter" };
    const { settings, applied, fontsToUpload } = carouselFromBrandScan(scan, before);
    expect(fontsToUpload).toEqual(["Canela"]);
    expect(settings).toEqual(before);
    expect(applied).toEqual([]);
  });

  it("changes nothing for an empty or broken scan", () => {
    for (const scan of [null, undefined, {}, { colors: null, fonts: null }, { colors: { primary: "null", background: "none" } }] as any[]) {
      const { settings, applied } = carouselFromBrandScan(scan, CAROUSEL_DEFAULTS);
      expect(settings).toEqual(CAROUSEL_DEFAULTS);
      expect(applied).toEqual([]);
    }
  });

  it("touches colours and fonts only: position, corners, wording and what shows stay", () => {
    const mine = {
      ...CAROUSEL_DEFAULTS, position: "top-right" as const, cornerRadius: 4, buttonCornerRadius: 6,
      buttonLabel: "SHOP NOW", showPrice: false, carouselWidth: 120, commerceEnabled: false,
    };
    const out = carouselFromBrandScan(light, mine).settings;
    for (const k of ["position", "cornerRadius", "buttonCornerRadius", "buttonLabel", "showPrice", "carouselWidth", "commerceEnabled"] as const) {
      expect(out[k]).toBe(mine[k]);
    }
  });

  it("produces settings that pass the sanitiser unchanged and save as a default", () => {
    const { settings, applied } = carouselFromBrandScan(light, CAROUSEL_DEFAULTS);
    expect(sanitiseSettings(settings)).toEqual(settings);
    expect(settingsFromBrandKit(brandKitFromSettings(settings))).toEqual(settings);
    // Every change it reports is one it made.
    for (const a of applied) expect((settings as any)[a.field]).not.toBeUndefined();
    expect(applied.map((a) => a.field)).toEqual(expect.arrayContaining(["buttonColor", "buttonTextColor", "carouselBackgroundColor", "productTitleColor", "titleFont"]));
  });

  it("uses the accent or secondary for the button when there is no primary", () => {
    expect(carouselFromBrandScan({ colors: { accent: "#F4A261" } }, CAROUSEL_DEFAULTS).settings.buttonColor).toBe("#F4A261");
    expect(carouselFromBrandScan({ colors: { secondary: "#457B9D" } }, CAROUSEL_DEFAULTS).settings.buttonColor).toBe("#457B9D");
  });
});

describe("the Brand Kit page applies a scan and holds it as the default", () => {
  const page = read("client/src/pages/brand-kit.tsx");

  it("lays the scan over the carousel and saves it in the same step", () => {
    expect(page).toContain("carouselFromBrandScan(");
    expect(page).toMatch(/apiRequest\("POST", "\/api\/brand-kit", \{\s*extractedColors: JSON\.stringify\(newExtractedColors\),\s*extractedFonts: JSON\.stringify\(newExtractedFonts\),\s*\.\.\.brandKitFromSettings\(scan\.settings\),/);
  });

  it("only says it is saved when the save worked", () => {
    expect(page).toContain("saved = true;");
    expect(page).toContain('title: "Scanned, but not saved"');
  });

  it("can undo, by saving the settings from before the scan", () => {
    expect(page).toContain('apiRequest("POST", "/api/brand-kit", brandKitFromSettings(scanResult.previous))');
    expect(page).toContain('data-testid="button-undo-scan"');
  });

  it("Save Brand Kit writes every carousel setting through the one mapping", () => {
    expect(page).toContain("...brandKitFromSettings(carouselSettings),");
    expect(page).not.toContain("defaultButtonFont: carouselSettings.buttonFont");
  });

  it("takes a dropped file itself, so the browser does not open it", () => {
    expect(page).toMatch(/onDrop=\{\(e\) => \{[\s\S]{0,200}e\.preventDefault\(\);/);
  });
});

describe("Import Influencer Program is a button brands cannot miss", () => {
  it("is on the brand dashboard before Upload Video, and on the creators page", () => {
    const dash = read("client/src/pages/brand-dashboard.tsx");
    expect(dash.indexOf("<ImportProgramButton")).toBeGreaterThan(-1);
    expect(dash.indexOf("<ImportProgramButton")).toBeLessThan(dash.indexOf('data-testid="button-upload-video"'));
    expect(dash).toContain("navigate(IMPORT_PROGRAM_PATH)");
    const creators = read("client/src/pages/brand-creators.tsx");
    expect(creators).toContain("<ImportProgramButton");
    expect(creators).toContain('get("import") === "1"');
  });

  it("glows, grows and changes colour on hover, and holds still for reduced motion", () => {
    const css = read("client/src/index.css");
    const block = css.slice(css.indexOf(".mz-glow-btn.mz-glow-btn {"));
    expect(block).toMatch(/@keyframes mz-glow-breathe/);
    expect(block).toMatch(/@media \(hover: hover\) \{\s*\.mz-glow-btn\.mz-glow-btn:hover \{ background-color: hsl\(var\(--glow-hover\)\); transform: scale\(1\.04\); \}/);
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none;/);
    // Movement is transform and opacity only.
    const frames = block.slice(block.indexOf("@keyframes mz-glow-breathe"), block.indexOf("@media (hover: hover)"));
    expect(frames.replace(/opacity|transform|scale/g, "")).not.toMatch(/box-shadow|width|height|filter|background/);
  });
});
