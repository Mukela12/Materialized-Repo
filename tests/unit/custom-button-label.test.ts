/**
 * Custom text on the carousel's buy button (client, 23 Nov 2026: 'add a
 * "Custom" (up to 9 characters) button text for the CTA button').
 *
 * The text is typed by a brand or creator and ends up in three places a
 * stranger's browser reads: the embed's script, the embed's markup and the
 * share clip. So the rule is tested here as a rule, and the files that must
 * apply it are checked for applying it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  BUTTON_LABEL_MAX, CAROUSEL_DEFAULTS, safeButtonLabel, cleanButtonLabel, isCustomButtonLabel,
  sanitiseSettings, settingsFromBrandKit, brandKitFromSettings, applyOverride, overrideFromSettings,
} from "../../shared/carousel";
import { BUTTON_LABEL_OPTIONS } from "../../shared/schema";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("custom button text: the rule", () => {
  it("allows nine characters, the length of the longest ready-made labels", () => {
    expect(BUTTON_LABEL_MAX).toBe(9);
    for (const label of BUTTON_LABEL_OPTIONS) expect(label.length).toBeLessThanOrEqual(BUTTON_LABEL_MAX);
  });

  it("keeps a ready-made label as it is, whatever case it arrives in", () => {
    for (const label of BUTTON_LABEL_OPTIONS) {
      expect(safeButtonLabel(label, "BUY NOW")).toBe(label);
      expect(safeButtonLabel(label.toLowerCase(), "BUY NOW")).toBe(label);
      expect(isCustomButtonLabel(label)).toBe(false);
    }
  });

  it("keeps custom text, in capitals, cut at nine characters", () => {
    expect(safeButtonLabel("Shop now", "BUY NOW")).toBe("SHOP NOW");
    expect(safeButtonLabel("shop the look", "BUY NOW")).toBe("SHOP THE");
    expect(safeButtonLabel("  get   it  ", "BUY NOW")).toBe("GET IT");
    expect(safeButtonLabel("20% off!", "BUY NOW")).toBe("20% OFF!");
    expect(isCustomButtonLabel("SHOP NOW")).toBe(true);
  });

  it("keeps letters from other alphabets", () => {
    expect(safeButtonLabel("Acheter", "BUY NOW")).toBe("ACHETER");
    expect(safeButtonLabel("купить", "BUY NOW")).toBe("КУПИТЬ");
    expect(safeButtonLabel("今すぐ購入", "BUY NOW")).toBe("今すぐ購入");
  });

  it("removes anything that could close a string or a tag, and all emoji", () => {
    for (const hostile of [
      "<img src=x onerror=alert(1)>", "\"};alert(1)//", "</script>", "a'b\"c", "x\\y", "&lt;b&gt;", "`${1}`", "😀 BUY",
    ]) {
      const out = safeButtonLabel(hostile, "BUY NOW");
      expect(out).not.toMatch(/[<>"'`&\\/{}()=;$]/);
      expect(out.length).toBeLessThanOrEqual(BUTTON_LABEL_MAX);
      expect(out).not.toMatch(/[\uD800-\uDFFF]/);
    }
  });

  it("falls back when nothing is left, or the value is not text", () => {
    expect(safeButtonLabel("", "BUY NOW")).toBe("BUY NOW");
    expect(safeButtonLabel("   ", "BUY NOW")).toBe("BUY NOW");
    expect(safeButtonLabel("😀😀", "BUY NOW")).toBe("BUY NOW");
    expect(safeButtonLabel(null, "RENT")).toBe("RENT");
    expect(safeButtonLabel(42, "RENT")).toBe("RENT");
  });

  it("while typing, keeps a space at the end and lets the box be empty", () => {
    expect(cleanButtonLabel("shop ")).toBe("SHOP ");
    expect(cleanButtonLabel("")).toBe("");
    expect(cleanButtonLabel(" shop")).toBe("SHOP");
    expect(cleanButtonLabel("abcdefghijkl")).toHaveLength(BUTTON_LABEL_MAX);
  });
});

describe("custom button text: saved, inherited and overridden like any other setting", () => {
  it("survives the trip to a brand kit and back", () => {
    const kit = brandKitFromSettings({ ...CAROUSEL_DEFAULTS, buttonLabel: "SHOP NOW" });
    expect(kit.defaultButtonLabel).toBe("SHOP NOW");
    expect(sanitiseSettings(settingsFromBrandKit(kit)).buttonLabel).toBe("SHOP NOW");
  });

  it("a video can use its own text, and go back to the default", () => {
    const base = { ...CAROUSEL_DEFAULTS, buttonLabel: "SHOP NOW" };
    const override = overrideFromSettings(base, { ...base, buttonLabel: "GET YOURS" });
    expect(override.buttonLabel).toBe("GET YOURS");
    expect(applyOverride(base, override).buttonLabel).toBe("GET YOURS");
    expect(overrideFromSettings(base, base).buttonLabel).toBeNull();
  });

  it("is cleaned on the way out, whatever the row holds", () => {
    expect(sanitiseSettings({ buttonLabel: "<b>hi</b>" } as any).buttonLabel).toBe("BHIB");
    expect(sanitiseSettings({ buttonLabel: "" } as any).buttonLabel).toBe(CAROUSEL_DEFAULTS.buttonLabel);
  });
});

describe("the title font and the three text sizes are saved (0057)", () => {
  it("are among the settings a brand kit and an override carry", () => {
    const edited = { ...CAROUSEL_DEFAULTS, titleFont: "playfair", titleFontSize: 120, priceFontSize: 90, buttonFontSize: 110 };
    const kit = brandKitFromSettings(edited);
    expect(kit).toMatchObject({
      defaultTitleFont: "playfair", defaultTitleFontSize: 120, defaultPriceFontSize: 90, defaultButtonFontSize: 110,
    });
    expect(settingsFromBrandKit(kit)).toMatchObject({ titleFont: "playfair", titleFontSize: 120, priceFontSize: 90, buttonFontSize: 110 });
    expect(overrideFromSettings(CAROUSEL_DEFAULTS, edited)).toMatchObject({ titleFont: "playfair", titleFontSize: 120 });
  });

  it("have a column on both tables, in the schema and in the migration", () => {
    const schema = read("shared/schema.ts");
    const sql = read("migrations/0057_custom_button_text_and_fonts.sql");
    for (const col of ["default_title_font", "default_title_font_size", "default_price_font_size", "default_button_font_size"]) {
      expect(schema).toContain(`"${col}"`);
      expect(sql).toMatch(new RegExp(`brand_kits ADD COLUMN IF NOT EXISTS ${col} `));
    }
    for (const col of ["title_font", "title_font_size", "price_font_size", "button_font_size"]) {
      expect(sql).toMatch(new RegExp(`video_carousel_overrides ADD COLUMN IF NOT EXISTS ${col} `));
    }
  });
});

describe("custom button text: the places that must apply the rule", () => {
  const schema = read("shared/schema.ts");
  const routes = read("server/routes.ts");
  const sql = read("migrations/0057_custom_button_text_and_fonts.sql");

  it("both label columns are text, not the old fixed list", () => {
    expect(schema).toContain('defaultButtonLabel: text("default_button_label").default("BUY NOW")');
    expect(schema).toMatch(/buttonLabel: text\("button_label"\), \/\/ text since 0057/);
    expect(sql).toMatch(/brand_kits ALTER COLUMN default_button_label TYPE text USING default_button_label::text/);
    expect(sql).toMatch(/video_carousel_overrides ALTER COLUMN button_label TYPE text USING button_label::text/);
    expect(sql).toMatch(/SET DEFAULT 'BUY NOW'/);
    expect(sql).not.toMatch(/\bDROP (TABLE|TYPE|COLUMN)\b/i);
  });

  it("the brand kit and the per-video save clean the text before keeping it", () => {
    expect(routes).toContain("kitBody.defaultButtonLabel = safeButtonLabel(kitBody.defaultButtonLabel, CAROUSEL_DEFAULTS.buttonLabel)");
    expect(routes).toContain('body.buttonLabel = safeButtonLabel(body.buttonLabel, "") || null');
  });

  it("neither save lets the request say whose kit or which video it is", () => {
    expect(routes).toContain('for (const k of ["id", "userId", "createdAt", "updatedAt"]) delete kitBody[k];');
    expect(routes).toContain('for (const k of ["id", "videoId", "createdAt"]) delete body[k];');
    // On create, the session's user id is written last so the body cannot replace it.
    expect(routes).toMatch(/createBrandKit\(\{\s*\.\.\.kitBody,\s*userId: user\.id,/);
  });

  it("the embed writes the label as a JSON string and as text, never as markup", () => {
    expect(routes).toContain("BUY_LABEL=${JSON.stringify(carousel.buttonLabel)}");
    expect(routes).toContain("b.textContent=p.buttonLabel||BUY_LABEL");
  });

  it("the editor offers Custom with a nine character box", () => {
    const editor = read("client/src/components/ProductCarouselEditor.tsx");
    expect(editor).toContain('data-testid="option-button-label-custom"');
    expect(editor).toContain("maxLength={BUTTON_LABEL_MAX}");
    expect(editor).toContain("cleanButtonLabel(e.target.value)");
  });
});
