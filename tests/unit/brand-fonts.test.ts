/**
 * Uploaded brand fonts: what counts as a font, and what reaches a stylesheet.
 *
 * ── Why the bytes decide ─────────────────────────────────────────────────────
 * A font file is served from our domain, referenced by `@font-face` in CSS that
 * runs on a BRAND'S OWN PAGE, and fetched by every visitor to it. The extension
 * and the Content-Type are both chosen by whoever uploads, so neither can be
 * the thing that decides. If a zip, an HTML page or a PDF can be stored as a
 * font, it is stored on our domain and served to somebody else's customers.
 *
 * ── Why the family name is generated ─────────────────────────────────────────
 * `font-family: 'X'` closes on an apostrophe like any other CSS string. So the
 * name in the stylesheet is a uuid we minted, never text a user typed. The
 * human label exists only in the app.
 */
import { describe, it, expect } from "vitest";
import {
  sniffFontFormat, customFontKey, isCustomFontKey, customFontId,
  sanitiseFontLabel, fontFaceRule, MAX_FONT_BYTES, MAX_FONT_LABEL,
} from "../../shared/brandFonts";

/** First bytes of a file, as they actually appear on disk. */
const head = (...parts: Array<string | number>) => {
  const bytes: number[] = [];
  for (const p of parts) {
    if (typeof p === "number") bytes.push(p);
    else for (const ch of p) bytes.push(ch.charCodeAt(0));
  }
  return new Uint8Array(bytes);
};

describe("identifying a font from its bytes", () => {
  it("accepts the formats a browser can use", () => {
    expect(sniffFontFormat(head("OTTO"))).toBe("otf");
    expect(sniffFontFormat(head(0x00, 0x01, 0x00, 0x00))).toBe("ttf");
    expect(sniffFontFormat(head("true"))).toBe("ttf");
    expect(sniffFontFormat(head("wOFF"))).toBe("woff");
    expect(sniffFontFormat(head("wOF2"))).toBe("woff2");
  });

  it("covers the two the client actually asked for", () => {
    // "Font upload must allow for the .otf or .ttf"
    expect(sniffFontFormat(head("OTTO"))).toBe("otf");
    expect(sniffFontFormat(head(0x00, 0x01, 0x00, 0x00))).toBe("ttf");
  });

  it("REFUSES a file that is not a font, whatever it is named", () => {
    const notFonts: Array<[string, Uint8Array]> = [
      ["zip",   head("PK", 0x03, 0x04)],
      ["pdf",   head("%PDF")],
      ["html",  head("<htm")],
      ["gif",   head("GIF8")],
      ["png",   head(0x89, 0x50, 0x4e, 0x47)],
      ["elf",   head(0x7f, "ELF")],
      ["shell", head("#!/b")],
      ["svg",   head("<svg")],
    ];
    for (const [name, bytes] of notFonts) {
      expect(sniffFontFormat(bytes), `accepted a ${name}`).toBeNull();
    }
  });

  it("refuses a TrueType collection, which never renders from @font-face", () => {
    // 'ttcf' holds several faces. Browsers will not load one from a @font-face
    // rule, so storing it means a font that silently does nothing.
    expect(sniffFontFormat(head("ttcf"))).toBeNull();
  });

  it("refuses a file too short to identify", () => {
    expect(sniffFontFormat(new Uint8Array([]))).toBeNull();
    expect(sniffFontFormat(head("OT"))).toBeNull();
  });

  it("caps the size, because a brand's visitors download this", () => {
    expect(MAX_FONT_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("the key that reaches CSS", () => {
  const id = "3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c";

  it("round-trips", () => {
    const key = customFontKey(id);
    expect(isCustomFontKey(key)).toBe(true);
    expect(customFontId(key)).toBe(id);
  });

  it("rejects anything that is not exactly prefix + uuid", () => {
    for (const bad of [
      "custom:not-a-uuid",
      "custom:",
      `custom:${id};} body{display:none}`,
      `custom:${id}'`,
      `Custom${id}`,
      "system",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(isCustomFontKey(bad), `accepted: ${String(bad)}`).toBe(false);
    }
  });

  it("cannot contain anything that escapes a CSS string", () => {
    // The property stated directly: this value is interpolated between quotes
    // in `font-family:'…'`, so it must carry no quote, brace or semicolon.
    const key = customFontKey(id);
    expect(key).not.toMatch(/['"{};()<>\\]/);
  });
});

describe("the label shown in the app", () => {
  it("keeps a real typeface name intact", () => {
    expect(sanitiseFontLabel("Söhne Breit")).toBe("Söhne Breit");
    expect(sanitiseFontLabel("  Neue Haas Grotesk  ")).toBe("Neue Haas Grotesk");
  });

  it("strips anything that could matter if rendered as markup", () => {
    expect(sanitiseFontLabel('<script>alert(1)</script>')).not.toContain("<");
    expect(sanitiseFontLabel("x'; } body{")).not.toMatch(/['{};]/);
  });

  it("is length-capped", () => {
    expect(sanitiseFontLabel("A".repeat(500)).length).toBe(MAX_FONT_LABEL);
  });
});

describe("the @font-face rule", () => {
  const id = "3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c";
  const key = customFontKey(id);
  const url = "https://res.cloudinary.com/x/raw/upload/v1/fonts/a.otf";

  it("names the KEY, never anything a user typed", () => {
    const rule = fontFaceRule(key, url, "otf");
    expect(rule).toContain(`font-family:'${key}'`);
    expect(rule).toContain("format('opentype')");
    expect(rule).toContain("font-display:swap");
  });

  it("emits nothing for a malformed key", () => {
    expect(fontFaceRule("system", url, "otf")).toBe("");
    expect(fontFaceRule("custom:'; }", url, "otf")).toBe("");
  });

  it("refuses a non-https URL", () => {
    // Fetched by a brand's visitors on an https page; http is blocked outright
    // and renders as a silent fallback nobody can diagnose.
    expect(fontFaceRule(key, "http://x/a.otf", "otf")).toBe("");
    expect(fontFaceRule(key, "//x/a.otf", "otf")).toBe("");
    expect(fontFaceRule(key, "javascript:alert(1)", "otf")).toBe("");
  });

  it("refuses a URL that would close the url() token", () => {
    expect(fontFaceRule(key, "https://x/a.otf')}body{display:none}@font-face{src:url('", "otf")).toBe("");
    expect(fontFaceRule(key, 'https://x/a"b.otf', "otf")).toBe("");
  });

  it("produces a rule with balanced, unescapable syntax", () => {
    const rule = fontFaceRule(key, url, "ttf");
    expect((rule.match(/\{/g) ?? []).length).toBe(1);
    expect((rule.match(/\}/g) ?? []).length).toBe(1);
  });
});
