/**
 * The refined carousel (30 Sep 2026: "more premium and high quality and
 * refined"), and the copy buttons that said "Copied!" without copying.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { embedCarouselCss } from "../../server/embedCarousel";
import { cardMetrics } from "../../server/shareClip";
import { CAROUSEL_DEFAULTS } from "../../shared/carousel";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const routes = code("server/routes.ts");
const embed = routes.slice(routes.indexOf('app.get("/embed/:videoId"'), routes.indexOf('app.get("/embed/:videoId/widget.js"'));

describe("the player's carousel", () => {
  it("is a dock as wide as its products for top and bottom, not a strip across the video", () => {
    for (const position of ["top", "bottom"] as const) {
      const css = embedCarouselCss({ ...CAROUSEL_DEFAULTS, position });
      expect(css).toMatch(/left:calc\(50% \+ 0px\);right:auto;transform:translateX\(-50%\);width:max-content;max-width:calc\(100% - 2 \* var\(--edge,12px\)\)/);
    }
  });

  it("corners cancel the dock's centring shift", () => {
    for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      expect(embedCarouselCss({ ...CAROUSEL_DEFAULTS, position })).toMatch(/transform:none;max-width:72%/);
    }
  });

  it("has glass only when the panel is not set fully clear", () => {
    expect(embedCarouselCss({ ...CAROUSEL_DEFAULTS })).toMatch(/backdrop-filter:blur\(18px\)/);
    expect(embedCarouselCss({ ...CAROUSEL_DEFAULTS, backgroundOpacity: 0 })).not.toMatch(/backdrop-filter/);
  });

  it("keeps every creator choice: colours, fonts, sizes, toggles", () => {
    const css = embedCarouselCss({ ...CAROUSEL_DEFAULTS, productTitleColor: "#123456", brandTitleColor: "#abcdef", titleFontSize: 120, showThumbnail: false, showButton: false });
    expect(css).toMatch(/color:#123456/);
    expect(css).toMatch(/color:#abcdef/);
    expect(css).toMatch(/calc\(var\(--card-name,11px\) \* 1\.2\)/);
    expect(css).toMatch(/\.product-card \.thumb\{[^}]*display:none/);
    expect(css).toMatch(/\.buy-btn\{[^}]*display:none/);
  });

  it("square framed product shots, two-line names, a compact card for short stages, still for reduced motion", () => {
    expect(embed).toMatch(/\.product-card \.thumb\{[^}]*aspect-ratio:1\/1/);
    expect(embed).toMatch(/th\.className="thumb"/);
    expect(embed).toMatch(/\.product-name\{[^}]*-webkit-line-clamp:2/);
    expect(embed).toMatch(/p\.classList\.toggle\("compact", h<320\)/);
    expect(embed).toMatch(/#player\.compact \.product-brand\{display:none\}/);
    expect(embed).toMatch(/@media \(prefers-reduced-motion:reduce\)/);
  });

  it("the end screen has its heading and rows", () => {
    expect(embed).toMatch(/endTitle\.textContent="Shop the video"/);
    expect(embed).toMatch(/row\.className="end-row"/);
  });
});

describe("the downloaded clip sizes cards exactly as the player does", () => {
  it("uses the player's formulas (fitPlayer) for every size", () => {
    const fit = embed.slice(embed.indexOf("function fitPlayer"), embed.indexOf("function fitPlayer") + 2500);
    for (const [name, lo, k, hi] of [
      ["--card-pad", 4, 0.012, 7], ["--gap", 3, 0.01, 6], ["--edge", 8, 0.03, 16],
      ["--card-brand", 6.5, 0.021, 8.5], ["--card-name", 8.5, 0.03, 12], ["--card-price", 8, 0.028, 11],
      ["--card-buy", 7, 0.022, 9.5], ["--btn-h", 18, 0.062, 26],
    ] as const) {
      expect(fit, name).toContain(`p.style.setProperty("${name}", c(${lo},base*${k},${hi}))`);
    }
    expect(fit).toContain('p.style.setProperty("--card-w", c(52,Math.min(w*0.24,h*0.15),104))');
    expect(fit).toContain("var base=Math.min(w,h*1.25)");

    // And the clip computes the same numbers for the same stage.
    const m = cardMetrics(CAROUSEL_DEFAULTS, 390, 693);
    const base = Math.min(390, 693 * 1.25);
    const c = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v));
    expect(m.cardW).toBeCloseTo(c(52, Math.min(390 * 0.24, 693 * 0.15), 104));
    expect(m.nameFs).toBeCloseTo(c(8.5, base * 0.03, 12));
    expect(m.btnH).toBeCloseTo(c(18, base * 0.062, 26));
    expect(cardMetrics(CAROUSEL_DEFAULTS, 390, 219).compact).toBe(true);
  });
});

describe("copy buttons", () => {
  function files(dir: string): string[] {
    return readdirSync(join(__dirname, "../..", dir)).flatMap((f) => {
      const rel = `${dir}/${f}`;
      return statSync(join(__dirname, "../..", rel)).isDirectory() ? files(rel) : /\.tsx?$/.test(f) ? [rel] : [];
    });
  }

  it("all go through the helper that has a fallback and says whether it worked", () => {
    const direct = files("client/src").filter((f) => f !== "client/src/lib/clipboard.ts" && /navigator\.clipboard/.test(code(f)));
    expect(direct).toEqual([]);
    const helper = code("client/src/lib/clipboard.ts");
    expect(helper).toMatch(/document\.execCommand\("copy"\)/);
  });

  it("the embed code no longer says Copied when it wasn't", () => {
    const modal = code("client/src/components/EmbedCodeModal.tsx");
    expect(modal).toMatch(/if \(!\(await copyText\(code\)\)\) \{[\s\S]*?return;\s*\}\s*setCopied\(true\)/);
  });

  it("the shoppable link is shown to copy by hand when the browser refuses", () => {
    const panel = code("client/src/components/ShareClipPanel.tsx");
    expect(panel).toMatch(/if \(await copyText\(shoppableUrl\)\)/);
    expect(panel).toMatch(/setShowLink\(true\)/);
    expect(panel).toMatch(/data-testid="input-shoppable-link"/);
  });
});
