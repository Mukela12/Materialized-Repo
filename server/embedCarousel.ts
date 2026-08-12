/**
 * Carousel styling for the embed.
 *
 * ── Why the embed is the surface that actually matters ───────────────────────
 * Every styling control the client asked for was built, saved and previewed —
 * and the embed ignored all of it. `/embed/:videoId` had the carousel pinned to
 * the bottom in hard-coded CSS, a hard-coded `#1351aa` button, and the word
 * "Buy" written into the JavaScript regardless of the label chosen.
 *
 * That is the one place a viewer ever sees a carousel. So a brand could set
 * their colours, watch the preview change, publish, and find their own site
 * showing the platform's default blue.
 *
 * ── Everything here is sanitised first ───────────────────────────────────────
 * These values are creator-controlled free text, and this CSS is served inside
 * a BRAND'S page. `sanitiseSettings` is what stands between a `text` column and
 * arbitrary CSS on somebody else's site — see tests/unit/carousel-sanitise.
 * Nothing in this file interpolates a value that has not been through it.
 */
import {
  sanitiseSettings, panelBackground, buttonBackground, isStackedPosition,
  settingsFromBrandKit, applyOverride, type CarouselSettings,
} from "../shared/carousel";
import { fontStack } from "../shared/fonts";
import {
  isCustomFontKey, customFontId, fontFaceRule, type FontFormat,
} from "../shared/brandFonts";

/**
 * Resolve the settings for one video: base defaults, then the creator's brand
 * kit, then this video's override. Mirrors the precedence the editor previews.
 */
export function resolveEmbedSettings(
  brandKit: Record<string, any> | null | undefined,
  override: Record<string, any> | null | undefined,
): CarouselSettings {
  return sanitiseSettings(applyOverride(settingsFromBrandKit(brandKit), override));
}

/** Where the carousel strip sits, as CSS edges. */
function positionCss(s: CarouselSettings): string {
  const gap = "clamp(8px,2vw,16px)";
  const x = `calc(${gap} + ${s.positionOffsetX}px)`;
  const y = `calc(${gap} + ${s.positionOffsetY}px)`;
  const yUp = `calc(${gap} - ${s.positionOffsetY}px)`;
  const xIn = `calc(${gap} - ${s.positionOffsetX}px)`;

  switch (s.position) {
    case "top":          return `top:${y};left:${gap};right:${gap};justify-content:center`;
    case "bottom":       return `bottom:${yUp};left:${gap};right:${gap};justify-content:center`;
    case "left":         return `left:${x};top:50%;transform:translateY(-50%);max-width:38%`;
    case "right":        return `right:${xIn};top:50%;transform:translateY(-50%);max-width:38%`;
    case "top-left":     return `top:${y};left:${x};max-width:70%`;
    case "top-right":    return `top:${y};right:${xIn};max-width:70%;justify-content:flex-end`;
    case "bottom-left":  return `bottom:${yUp};left:${x};max-width:70%`;
    case "bottom-right": return `bottom:${yUp};right:${xIn};max-width:70%;justify-content:flex-end`;
    default:             return `bottom:${yUp};left:${gap};right:${gap};justify-content:center`;
  }
}

/**
 * The stylesheet for one video's carousel.
 *
 * Emitted as a block appended after the base rules, so it overrides them
 * without the base needing to know these settings exist.
 */
export function embedCarouselCss(raw: CarouselSettings): string {
  const s = sanitiseSettings(raw);

  // The client's rule: anchored to a side there is no width to spare, so
  // products stack; anchored top or bottom they run side by side.
  const stacked = isStackedPosition(s.position);

  return `
    #carousel{
      ${positionCss(s)};
      flex-direction:${stacked ? "column" : "row"};
      overflow-${stacked ? "y" : "x"}:auto;
      align-items:${stacked ? "stretch" : "flex-end"};
      ${stacked ? "max-height:76%;" : ""}
      background:${panelBackground(s)};
      border-radius:${s.cornerRadius}px;
      padding:${s.cornerRadius > 0 ? "6px" : "4px 0"};
    }
    .product-card{
      background:transparent;
      backdrop-filter:none;
      ${stacked ? "width:100%;" : ""}
    }
    .product-name{
      color:${s.productTitleColor};
      font-family:${fontStack(s.titleFont)};
      font-size:calc(clamp(8px,2vw,11px) * ${s.titleFontSize / 100});
      ${s.showTitle ? "" : "display:none;"}
    }
    /* PRICE FOLLOWS THE PRODUCT TITLE, NOT THE BRAND TITLE.
       It was bound to brandTitleColor, so changing "Brand title colour"
       recoloured the price and nothing else — the client reported exactly
       that. The price belongs to the product line; the brand name is its own
       element, styled below. */
    .product-price{
      color:${s.productTitleColor};
      font-size:calc(clamp(7px,1.8vw,10px) * ${s.priceFontSize / 100});
      ${s.showPrice ? "" : "display:none;"}
    }
    /* The brand name — what brandTitleColor is actually for. */
    .product-brand{
      color:${s.brandTitleColor};
      font-family:${fontStack(s.titleFont)};
      font-size:calc(clamp(6px,1.5vw,9px) * ${s.titleFontSize / 100});
      text-transform:uppercase;
      letter-spacing:.04em;
      opacity:.85;
      ${s.showTitle ? "" : "display:none;"}
    }
    .product-card img{ ${s.showThumbnail ? "" : "display:none;"} }
    .buy-btn{
      background:${buttonBackground(s)};
      color:${s.buttonTextColor};
      border-radius:${s.buttonCornerRadius}px;
      font-family:${fontStack(s.buttonFont)};
      font-size:calc(clamp(7px,1.7vw,10px) * ${s.buttonFontSize / 100});
      ${s.showButton ? "" : "display:none;"}
    }
    .buy-btn:hover{ background:${s.buttonHoverColor}; }
    /* ── The end-of-video list, when commerce is off ──────────────────────
       Its elements reuse .product-brand/.product-name/.product-price/.buy-btn
       above, so the client's show/hide toggles apply to BOTH places without
       being decided twice. Only the layout differs. */
    .end-thumb{
      width:44px;height:44px;object-fit:cover;border-radius:6px;flex:0 0 auto;
      ${s.showThumbnail ? "" : "display:none;"}
    }
    .end-cta{
      width:auto;padding:4px 12px;flex:0 0 auto;
    }
    /* Commerce off: nothing over the video during playback. The end-of-video
       list is rendered by the embed's own script, not by this rule. */
    ${s.commerceEnabled ? "" : "#carousel{display:none}"}
  `.replace(/\n\s+/g, "\n").trim();
}

/**
 * The same styling, as inline-style strings for the script embed.
 *
 * `/embed/:videoId/widget.js` builds its carousel in JavaScript with inline
 * styles rather than a stylesheet, so it could not use the CSS above — and it
 * was therefore a SECOND surface ignoring every setting. A brand using the
 * script tag rather than the iframe got the platform's defaults no matter what
 * they chose.
 *
 * Values come from the same sanitised object, so the two surfaces cannot
 * disagree about what a carousel looks like or differ in what they let through.
 */
export function widgetInlineStyles(raw: CarouselSettings) {
  const s = sanitiseSettings(raw);
  const stacked = isStackedPosition(s.position);
  const gap = "clamp(4px,2%,12px)";

  const edges = (() => {
    switch (s.position) {
      case "top":          return `top:${gap};left:${gap};right:${gap};justify-content:center;`;
      case "left":         return `left:${gap};top:50%;transform:translateY(-50%);max-width:38%;`;
      case "right":        return `right:${gap};top:50%;transform:translateY(-50%);max-width:38%;`;
      case "top-left":     return `top:${gap};left:${gap};max-width:70%;`;
      case "top-right":    return `top:${gap};right:${gap};max-width:70%;justify-content:flex-end;`;
      case "bottom-left":  return `bottom:${gap};left:${gap};max-width:70%;`;
      case "bottom-right": return `bottom:${gap};right:${gap};max-width:70%;justify-content:flex-end;`;
      default:             return `bottom:${gap};left:${gap};right:${gap};justify-content:center;`;
    }
  })();

  return {
    container:
      `position:absolute;${edges}display:${s.commerceEnabled ? "flex" : "none"};` +
      `flex-direction:${stacked ? "column" : "row"};gap:clamp(3px,1%,6px);` +
      `overflow-${stacked ? "y" : "x"}:auto;z-index:5;scrollbar-width:none;` +
      `background:${panelBackground(s)};border-radius:${s.cornerRadius}px;padding:4px;`,
    card:
      `flex:0 0 auto;background:transparent;padding:clamp(3px,1%,6px);` +
      `${stacked ? "width:100%;" : "width:clamp(60px,20%,100px);"}text-decoration:none;`,
    image: s.showThumbnail
      ? "width:100%;height:clamp(30px,8vw,60px);object-fit:cover;border-radius:clamp(4px,1%,6px)"
      : "display:none",
    name:
      `font-size:calc(clamp(7px,2%,10px) * ${s.titleFontSize / 100});font-weight:600;` +
      `color:${s.productTitleColor};font-family:${fontStack(s.titleFont)};margin-top:2px;` +
      `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;` +
      `${s.showTitle ? "" : "display:none;"}`,
    price:
      `font-size:calc(9px * ${s.priceFontSize / 100});color:${s.productTitleColor};font-weight:700;` +
      `${s.showPrice ? "" : "display:none;"}`,
    brand:
      `font-size:calc(7px * ${s.titleFontSize / 100});color:${s.brandTitleColor};` +
      `text-transform:uppercase;letter-spacing:.04em;opacity:.85;` +
      `font-family:${fontStack(s.titleFont)};${s.showTitle ? "" : "display:none;"}`,
  };
}


/**
 * The @font-face rules a video's carousel needs.
 *
 * Without these the stylesheet references `font-family:'custom:<uuid>'`, the
 * browser has never heard of it, and the text falls back to system-ui — the
 * setting saving and doing nothing, which is the failure mode this project has
 * produced three times over. So the embed must declare the face, not just name
 * it.
 *
 * Only fonts actually referenced by these settings are emitted. A creator with
 * nine uploaded faces should not have all nine downloaded by every visitor to
 * a brand's page.
 */
export async function embedFontFaceCss(
  settings: CarouselSettings,
  lookup: (id: string) => Promise<{ fileUrl: string; format: string } | undefined>,
): Promise<string> {
  const keys = Array.from(new Set(
    [settings.buttonFont, settings.titleFont].filter(isCustomFontKey),
  ));
  if (keys.length === 0) return "";

  const rules: string[] = [];
  for (const key of keys) {
    const id = customFontId(key);
    if (!id) continue;
    const font = await lookup(id).catch(() => undefined);
    // A deleted font leaves the setting pointing at nothing. Emitting no rule
    // is correct: the text falls back rather than the page 404ing on a file.
    if (!font) continue;
    const rule = fontFaceRule(key, font.fileUrl, font.format as FontFormat);
    if (rule) rules.push(rule);
  }
  return rules.join("\n");
}
