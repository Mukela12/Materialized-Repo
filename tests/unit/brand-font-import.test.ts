/**
 * An uploaded font, after the upload (23 Nov 2026: "did you test that any otf
 * will import properly?"). Uploading a real .otf showed three things:
 *
 *  1. The embed drew it. The app never did: no page in the app declared the
 *     font to the browser, so every preview stayed in the fallback face.
 *  2. The server's check reads the first bytes. A file cut short, or a desktop
 *     format with a font's header, passed it and then drew nothing.
 *  3. Removing a font deleted the row the embed finds the file through, while
 *     the app said published videos keep it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { MemStorage } from "../../server/storage";
import { embedFontFaceCss } from "../../server/embedCarousel";
import { CAROUSEL_DEFAULTS } from "../../shared/carousel";
import { customFontKey, fontFaceRule, sniffFontFormat } from "../../shared/brandFonts";
import { matchFont } from "../../shared/brandScan";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const URL_ = "https://res.cloudinary.com/x/raw/upload/v1/materialized/fonts/abc.otf";

describe("an .otf is recognised by its bytes, whichever outlines it holds", () => {
  it("takes an OpenType file with CFF outlines as otf", () => {
    expect(sniffFontFormat(new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0x0b, 0, 0x80]))).toBe("otf");
  });
  it("takes an .otf that holds TrueType outlines as ttf, which is what it is", () => {
    expect(sniffFontFormat(new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 0x12, 1, 0]))).toBe("ttf");
  });
});

describe("the app declares an uploaded font, with the rule the embed uses", () => {
  const lib = read("client/src/lib/fonts.ts");
  const upload = read("client/src/components/BrandFontUpload.tsx");

  it("writes the shared @font-face rule into the page, once per font", () => {
    expect(lib).toContain("export function declareUploadedFont(");
    expect(lib).toContain("fontFaceRule(key, fileUrl, format as FontFormat)");
    expect(lib).toContain("if (declaredUploads.has(key)) return true;");
  });

  it("does so wherever the uploaded fonts are read, pickers included", () => {
    expect(upload).toContain("for (const f of fonts ?? []) declareUploadedFont(f.key, f.fileUrl, f.format);");
    expect(upload).toMatch(/export function useBrandFontOptions\(\) \{\s*const \{ data: fonts = \[\] \} = useBrandFonts\(\);/);
    // The one query, not a second copy that declares nothing.
    expect(upload.match(/useQuery<BrandFontRow\[\]>/g)).toHaveLength(1);
  });

  it("shows each uploaded font's name in its own face", () => {
    expect(upload).toContain("style={{ fontFamily: fontStack(f.key) }}");
  });
});

describe("a font file is checked by the browser before it is sent", () => {
  const lib = read("client/src/lib/fonts.ts");
  const upload = read("client/src/components/BrandFontUpload.tsx");

  it("asks the browser's own loader", () => {
    expect(lib).toContain('new FontFace("mz-font-check", await file.arrayBuffer()).load()');
  });
  it("refuses the upload, by name, when the browser cannot read the file", () => {
    const i = upload.indexOf("const usable = await fontFileIsUsable(file);");
    expect(i).toBeGreaterThan(-1);
    const after = upload.slice(i, i + 600);
    expect(after).toMatch(/if \(!usable\) \{[\s\S]*can't be used on the web[\s\S]*return;\s*\}\s*upload\.mutate\(file\);/);
  });
});

describe("removing a font keeps it for the videos that use it", () => {
  it("leaves the account's list, and is still found by id", async () => {
    const s = new MemStorage();
    const font: any = await s.createBrandFont({ userId: "u1", label: "Canela", fileUrl: URL_, format: "otf", sizeBytes: 1 } as any);
    expect(await s.getBrandFonts("u1")).toHaveLength(1);

    expect(await s.deleteBrandFont(font.id, "someone-else")).toBe(false);
    expect(await s.deleteBrandFont(font.id, "u1")).toBe(true);
    expect(await s.getBrandFonts("u1")).toHaveLength(0);
    expect(await s.deleteBrandFont(font.id, "u1")).toBe(false);

    const key = customFontKey(font.id);
    const css = await embedFontFaceCss({ ...CAROUSEL_DEFAULTS, titleFont: key }, (id) => s.getBrandFontById(id));
    expect(css).toBe(fontFaceRule(key, URL_, "otf"));
    expect(css).toContain("format('opentype')");
  });

  it("is a marked row in the database, not a deleted one", () => {
    const storage = read("server/storage.ts");
    expect(storage).toMatch(/db\.update\(brandFonts\)\s*\.set\(\{ removedAt: new Date\(\) \}\)/);
    expect(storage).not.toMatch(/db\.delete\(brandFonts\)/);
    expect(storage).toContain("and(eq(brandFonts.userId, userId), isNull(brandFonts.removedAt))");
    expect(read("migrations/0058_brand_font_removed_at.sql")).toMatch(/ALTER TABLE brand_fonts ADD COLUMN IF NOT EXISTS removed_at timestamp;/);
    expect(read("shared/schema.ts")).toContain('removedAt: timestamp("removed_at")');
  });
});

describe("a scan uses an uploaded font by the name it was given", () => {
  it("matches the guideline's font to the upload, with or without a weight", () => {
    const uploaded = [{ key: "custom:1f0c9c1e-0000-4000-8000-000000000001", label: "TeX Gyre Bonum" }];
    expect(matchFont("TeX Gyre Bonum", uploaded)?.key).toBe(uploaded[0].key);
    expect(matchFont("TeX Gyre Bonum Regular", uploaded)?.key).toBe(uploaded[0].key);
    // A file name is a common label: texgyrebonum-regular.
    expect(matchFont("TeX Gyre Bonum", [{ key: uploaded[0].key, label: "texgyrebonum-regular" }])?.key).toBe(uploaded[0].key);
  });
});
