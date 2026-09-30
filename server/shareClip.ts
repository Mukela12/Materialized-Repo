/**
 * "Download for socials": the published video as an MP4 with its product
 * carousel drawn on, for Stories, Reels and WhatsApp.
 *
 * The client asked for it in August ("the product carousel should still be
 * visible in the download so as to share and promote the software on social
 * media") and again on 30 Sep 2026: creators post the clip with "check my
 * latest shoppable vlog", and the shoppable original does the selling.
 *
 * ── How it is made ───────────────────────────────────────────────────────────
 * The live player (GET /embed/:videoId) shows each product only during its own
 * seconds, laid out by the video's carousel settings. This does the same thing
 * offline: the video's timeline is cut wherever a product appears or leaves,
 * each stretch gets one transparent picture of the carousel as it stands then
 * (drawn as SVG, text as outlines in the platform's Aileron), and ffmpeg lays
 * each picture over its stretch. With commerce off there is no carousel during
 * playback, so the clip ends on the product list instead, as the player does.
 *
 * The buttons cannot be pressed in a file. They are drawn anyway: the clip is
 * a teaser for the shoppable video, and it should look like it.
 *
 * ── What it will and will not fetch ──────────────────────────────────────────
 * Product image URLs are creator-supplied, so they are fetched over https from
 * public addresses only, small and quick. The video is read only from the
 * platform's own video hosts, with ffmpeg restricted to https, so a crafted
 * video URL cannot make the server read its own files or its private network.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import { buttonBackground, isStackedPosition, panelBackground, type CarouselSettings } from "@shared/carousel";
import { ffmpegPath } from "./ffmpegFrames";

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface ClipProduct {
  name: string;
  brandName: string;
  price: string | null;
  imageUrl: string | null;
  startTime: number;
  endTime: number | null;
  /** Has a price, so the player shows its buy button. */
  buyable: boolean;
  buttonLabel: string | null;
}

/** The longest stretch rendered: long editorials would tie the server up for minutes. */
export const MAX_CLIP_SECONDS = 180;
/** How long the product list shows at the end when commerce is off. */
export const END_LIST_SECONDS = 4;

// ─── Timeline ────────────────────────────────────────────────────────────────

export interface ClipSegment { start: number; end: number; items: number[] }

/**
 * The stretches of the video with the same products on screen, in the order
 * the player shows them. Stretches with nothing on screen are left out.
 */
export function carouselSegments(products: Pick<ClipProduct, "startTime" | "endTime">[], duration: number): ClipSegment[] {
  if (!(duration > 0)) return [];
  const cuts = new Set<number>([0, duration]);
  for (const p of products) {
    const s = Math.max(0, Number(p.startTime) || 0);
    const e = p.endTime == null ? duration : Math.min(duration, Number(p.endTime));
    if (s < duration) cuts.add(s);
    if (e > 0 && e < duration) cuts.add(e);
  }
  const points = Array.from(cuts).sort((a, b) => a - b);
  const out: ClipSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (b - a < 0.01) continue;
    const mid = (a + b) / 2;
    // The player's rule: on while start <= t < end.
    const items = products.flatMap((p, idx) => {
      const s = Number(p.startTime) || 0;
      const e = p.endTime == null ? Infinity : Number(p.endTime);
      return mid >= s && mid < e ? [idx] : [];
    });
    if (items.length === 0) continue;
    const prev = out[out.length - 1];
    if (prev && prev.end === a && prev.items.join() === items.join()) prev.end = b;
    else out.push({ start: a, end: b, items });
  }
  return out;
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

type Font = opentype.Font;
interface Fonts { regular: Font; semibold: Font; bold: Font; files: string[] }
let fontCache: Fonts | null = null;

/** Aileron, the platform's typeface, from wherever this deployment keeps it. */
export function loadFonts(): Fonts {
  if (fontCache) return fontCache;
  const dirs = ["client/public/fonts/Aileron", "dist/public/fonts/Aileron"].map((d) => join(process.cwd(), d));
  const dir = dirs.find((d) => existsSync(join(d, "Aileron-Regular.otf")));
  if (!dir) throw new Error("Aileron font files not found");
  const load = (f: string) => {
    const buf = readFileSync(join(dir, f));
    return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  };
  const names = ["Aileron-Regular.otf", "Aileron-SemiBold.otf", "Aileron-Bold.otf"];
  fontCache = {
    regular: load(names[0]), semibold: load(names[1]), bold: load(names[2]),
    files: names.map((n) => join(dir, n)),
  };
  return fontCache;
}

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A CSS color the player uses, as an SVG fill with its opacity kept apart. */
export function svgPaint(color: string): { fill: string; opacity: number } {
  const m = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
    return { fill: `#${hex}`, opacity: m[4] == null ? 1 : clamp(0, Number(m[4]), 1) };
  }
  return /^#[0-9a-f]{3,8}$/i.test(color) ? { fill: color, opacity: 1 } : { fill: "#000000", opacity: 1 };
}
const paint = (color: string, extraOpacity = 1) => {
  const p = svgPaint(color);
  return `fill="${p.fill}" fill-opacity="${(p.opacity * extraOpacity).toFixed(3)}"`;
};

/** Text that fits `maxW`, with an ellipsis like the player's CSS when it does not. */
export function fitText(font: Font, text: string, size: number, maxW: number, letterSpacing = 0): string {
  const w = (t: string) => font.getAdvanceWidth(t, size, { letterSpacing });
  if (w(text) <= maxW) return text;
  let t = text;
  while (t.length > 0 && w(t + "…") > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

/**
 * Text, drawn by the SVG renderer from the Aileron files themselves. opentype.js
 * only MEASURES (advance widths, for the ellipsis): its outlines came out
 * corrupted once a few strings had been drawn, "Gold Crinkle" ending "Gold Crir".
 */
function textPath(font: Font, text: string, x: number, baseline: number, size: number, fillAttrs: string, letterSpacing = 0): string {
  if (!text) return "";
  const f = fontCache;
  const weight = f && font === f.bold ? 700 : f && font === f.semibold ? 600 : 400;
  return `<text x="${x.toFixed(2)}" y="${baseline.toFixed(2)}" font-family="Aileron" font-weight="${weight}" font-size="${size.toFixed(2)}"` +
    `${letterSpacing ? ` letter-spacing="${(letterSpacing * size).toFixed(2)}"` : ""} ${fillAttrs}>${esc(text)}</text>`;
}

/**
 * The card and panel metrics of the player, in its CSS pixels, for a stage
 * `w` x `h`. The same formulas as fitPlayer() in the embed (server/routes.ts),
 * so the clip and the player agree on size.
 */
export function cardMetrics(s: CarouselSettings, w: number, h: number = w * 16 / 9) {
  const title = s.titleFontSize / 100, price = s.priceFontSize / 100, buy = s.buttonFontSize / 100;
  const base = Math.min(w, h * 1.25);
  return {
    compact: h < 320,
    edge: clamp(8, base * 0.03, 16),
    cardGap: clamp(3, base * 0.01, 6),
    cardW: clamp(52, Math.min(w * 0.24, h * 0.15), 104),
    cardPad: clamp(4, base * 0.012, 7),
    brandFs: clamp(6.5, base * 0.021, 8.5) * title,
    nameFs: clamp(8.5, base * 0.03, 12) * title,
    priceFs: clamp(8, base * 0.028, 11) * price,
    buyFs: clamp(7, base * 0.022, 9.5) * buy,
    btnH: clamp(18, base * 0.062, 26),
    // The client's "5px more" between the brand line and the name.
    nameTop: clamp(2, 0.005 * w, 4) + 5,
  };
}
type Metrics = ReturnType<typeof cardMetrics>;

const LINE = 1.25;

/** Up to `max` lines of `text` in `maxW`, the last with an ellipsis if it had to stop. */
export function wrapLines(font: Font, text: string, size: number, maxW: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (font.getAdvanceWidth(next, size) <= maxW || !cur) { cur = next; continue; }
    lines.push(cur);
    cur = words[i];
    if (lines.length === max - 1) {
      // The last line takes everything left, cut to fit.
      cur = words.slice(i).join(" ");
      break;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, max).map((l, i) => (i === max - 1 || font.getAdvanceWidth(l, size) > maxW ? fitText(font, l, size, maxW) : l));
}

function nameLines(m: Metrics) { return m.compact ? 1 : 2; }

function cardHeight(p: ClipProduct, s: CarouselSettings, m: Metrics): number {
  const inner = m.cardW - m.cardPad * 2;
  let h = m.cardPad * 2;
  if (p.imageUrl && s.showThumbnail) h += inner;
  if (p.brandName && s.showTitle && !m.compact) h += m.cardPad + 1 + m.brandFs * 1.3;
  if (s.showTitle) h += (m.compact ? 4 : m.nameTop) + m.nameFs * LINE * nameLines(m);
  if (p.price && s.showPrice) h += 2 + m.priceFs * LINE;
  if (p.buyable && s.showButton) h += (m.compact ? 5 : 8) + m.btnH;
  return h;
}

/** One product card at (x, y) in CSS px, `cw` wide, as SVG. */
function drawCard(
  p: ClipProduct, x: number, y: number, cw: number, s: CarouselSettings, m: Metrics,
  fonts: Fonts, images: Map<string, string | null>, currency: string, buyLabel: string, id: string,
): string {
  const inner = cw - m.cardPad * 2;
  const left = x + m.cardPad;
  let cy = y + m.cardPad;
  const out: string[] = [];
  if (p.imageUrl && s.showThumbnail) {
    const data = images.get(p.imageUrl);
    const r = Math.max(0, s.cornerRadius - 7);
    out.push(`<clipPath id="c${id}"><rect x="${left}" y="${cy}" width="${inner}" height="${inner}" rx="${r}"/></clipPath>`);
    out.push(`<rect x="${left}" y="${cy}" width="${inner}" height="${inner}" rx="${r}" fill="#ffffff" fill-opacity="0.08"/>`);
    if (data) out.push(`<image href="${data}" x="${left}" y="${cy}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${id})"/>`);
    // The hairline the player draws inside the frame.
    out.push(`<rect x="${left + 0.5}" y="${cy + 0.5}" width="${inner - 1}" height="${inner - 1}" rx="${r}" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1"/>`);
    cy += inner;
  }
  if (p.brandName && s.showTitle && !m.compact) {
    cy += m.cardPad + 1;
    const ls = 0.12;
    const t = fitText(fonts.semibold, p.brandName.toUpperCase(), m.brandFs, inner, ls);
    out.push(textPath(fonts.semibold, t, left, cy + m.brandFs * 1.02, m.brandFs, paint(s.brandTitleColor, 0.62), ls));
    cy += m.brandFs * 1.3;
  }
  if (s.showTitle) {
    cy += m.compact ? 4 : m.nameTop;
    wrapLines(fonts.regular, p.name, m.nameFs, inner, nameLines(m)).forEach((line, i) => {
      out.push(textPath(fonts.regular, line, left, cy + m.nameFs * (1.0 + i * LINE), m.nameFs, paint(s.productTitleColor)));
    });
    cy += m.nameFs * LINE * nameLines(m);
  }
  if (p.price && s.showPrice) {
    cy += 2;
    const t = fitText(fonts.semibold, `${currency}${p.price}`, m.priceFs, inner);
    out.push(textPath(fonts.semibold, t, left, cy + m.priceFs * 1.0, m.priceFs, paint(s.productTitleColor, 0.9)));
    cy += m.priceFs * LINE;
  }
  if (p.buyable && s.showButton) {
    cy += m.compact ? 5 : 8;
    const bh = m.btnH;
    const r = Math.min(s.buttonCornerRadius, bh / 2);
    out.push(`<rect x="${left}" y="${cy}" width="${inner}" height="${bh}" rx="${r}" ${paint(buttonBackground(s))}/>`);
    // The inset highlight along the top of the player's button.
    out.push(`<rect x="${left + r * 0.3}" y="${cy + 0.5}" width="${inner - r * 0.6}" height="1" fill="#ffffff" fill-opacity="0.18"/>`);
    const ls = 0.08;
    const label = fitText(fonts.semibold, (p.buttonLabel || buyLabel).toUpperCase(), m.buyFs, inner - 8, ls);
    const lw = fonts.semibold.getAdvanceWidth(label, m.buyFs, { letterSpacing: ls });
    out.push(textPath(fonts.semibold, label, left + (inner - lw) / 2, cy + bh / 2 + m.buyFs * 0.36, m.buyFs, paint(s.buttonTextColor), ls));
  }
  return out.join("");
}

export interface OverlayFrame { W: number; H: number; ref: number }

const SHADOW = `<filter id="dock" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.45"/></filter>`;

/**
 * The carousel as it stands with `items` on screen: a transparent SVG the
 * size of the output video. Laid out in the player's CSS pixels for a stage
 * `ref` wide, then scaled to the video's real pixels.
 */
export function carouselSvg(
  items: ClipProduct[], s: CarouselSettings, frame: OverlayFrame, fonts: Fonts,
  images: Map<string, string | null>, currency: string,
): string {
  const { W, H, ref } = frame;
  const k = W / ref;
  const w = ref, h = H / k;
  const m = cardMetrics(s, w, h);
  const stacked = isStackedPosition(s.position);
  const ox = s.positionOffsetX, oy = s.positionOffsetY;
  const pad = m.cardPad;

  const heights = items.map((p) => cardHeight(p, s, m));
  let px: number, py: number, pw: number, ph: number;
  const placed: { p: ClipProduct; x: number; y: number; cw: number }[] = [];

  if (stacked) {
    pw = Math.min(m.cardW + pad * 2, 0.4 * w);
    const cw = pw - pad * 2;
    const maxH = 0.78 * h;
    let used = pad * 2, shown = 0;
    for (let i = 0; i < items.length; i++) {
      const add = heights[i] + (shown ? m.cardGap : 0);
      if (used + add > maxH && shown > 0) break;
      used += add; shown++;
    }
    ph = used;
    px = s.position === "left" ? m.edge + ox : w - m.edge + ox - pw;
    py = (h - ph) / 2;
    let cy = py + pad;
    for (let i = 0; i < shown; i++) { placed.push({ p: items[i], x: px + pad, y: cy, cw }); cy += heights[i] + m.cardGap; }
  } else {
    const dock = s.position === "top" || s.position === "bottom";
    const maxW = dock ? w - m.edge * 2 : 0.72 * w;
    let content = 0, shown = 0;
    for (let i = 0; i < items.length; i++) {
      const add = m.cardW + (shown ? m.cardGap : 0);
      if (pad * 2 + content + add > maxW && shown > 0) break;
      content += add; shown++;
    }
    const rowH = Math.max(...heights.slice(0, shown));
    ph = rowH + pad * 2;
    pw = content + pad * 2;
    const top = s.position.startsWith("top");
    py = top ? m.edge + oy : h - m.edge + oy - ph;
    // Top and bottom: a dock as wide as its products, centred.
    if (dock) px = (w - pw) / 2 + ox;
    else if (s.position.endsWith("left")) px = m.edge + ox;
    else px = w - m.edge + ox - pw;
    let cx = px + pad;
    for (let i = 0; i < shown; i++) {
      // align-items: flex-end, so a shorter card sits on the same baseline.
      placed.push({ p: items[i], x: cx, y: py + pad + (rowH - heights[i]), cw: m.cardW });
      cx += m.cardW + m.cardGap;
    }
  }

  const glass = s.backgroundOpacity > 0;
  const buyLabel = s.buttonLabel;
  const cards = placed.map((c, i) => drawCard(c.p, c.x, c.y, c.cw, s, m, fonts, images, currency, buyLabel, String(i))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs>${SHADOW}</defs>` +
    `<g transform="scale(${k})">` +
    `<clipPath id="panel"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${s.cornerRadius}"/></clipPath>` +
    `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${s.cornerRadius}" ${paint(panelBackground(s))}${glass ? ` filter="url(#dock)"` : ""}/>` +
    (glass ? `<rect x="${px + 0.5}" y="${py + 0.5}" width="${pw - 1}" height="${ph - 1}" rx="${s.cornerRadius}" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="1"/>` : "") +
    `<g clip-path="url(#panel)">${cards}</g></g></svg>`;
}

/**
 * The end-of-video product list the player shows when commerce is off: the
 * last frame dimmed, a small heading, one glass row per product.
 */
export function endListSvg(
  items: ClipProduct[], s: CarouselSettings, frame: OverlayFrame, fonts: Fonts,
  images: Map<string, string | null>, currency: string,
): string {
  const { W, H, ref } = frame;
  const k = W / ref, w = ref, h = H / k;
  const m = cardMetrics(s, w, h);
  const thumb = s.showThumbnail ? 52 : 0;
  const nameFs = m.nameFs, brandFs = m.brandFs, priceFs = m.priceFs;
  const rowH = Math.max(thumb, brandFs * 1.3 + 2 + nameFs * LINE + priceFs * LINE) + 16;
  const rowW = Math.min(440, w - m.edge * 2);
  const titleFs = brandFs * 1.15;
  const maxRows = Math.max(1, Math.floor((h - m.edge * 2 - titleFs - 12) / (rowH + 8)));
  const rows = items.slice(0, maxRows);
  const blockH = titleFs + 12 + rows.length * (rowH + 8) - 8;
  let y = (h - blockH) / 2;
  const x = (w - rowW) / 2;
  const out: string[] = [];
  const title = "SHOP THE VIDEO";
  const tls = 0.2;
  const tw = fonts.semibold.getAdvanceWidth(title, titleFs, { letterSpacing: tls });
  out.push(textPath(fonts.semibold, title, (w - tw) / 2, y + titleFs, titleFs, `fill="#ffffff" fill-opacity="0.72"`, tls));
  y += titleFs + 12;
  rows.forEach((p, i) => {
    out.push(`<rect x="${x}" y="${y}" width="${rowW}" height="${rowH}" rx="14" fill="#ffffff" fill-opacity="0.07"/>`);
    out.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${rowW - 1}" height="${rowH - 1}" rx="14" fill="none" stroke="#ffffff" stroke-opacity="0.09"/>`);
    let tx = x + 8;
    if (thumb && p.imageUrl) {
      const data = images.get(p.imageUrl);
      const ty0 = y + (rowH - thumb) / 2;
      out.push(`<clipPath id="e${i}"><rect x="${tx}" y="${ty0}" width="${thumb}" height="${thumb}" rx="10"/></clipPath>`);
      out.push(data
        ? `<image href="${data}" x="${tx}" y="${ty0}" width="${thumb}" height="${thumb}" preserveAspectRatio="xMidYMid slice" clip-path="url(#e${i})"/>`
        : `<rect x="${tx}" y="${ty0}" width="${thumb}" height="${thumb}" rx="10" fill="#ffffff" fill-opacity="0.12"/>`);
      tx += thumb + 12;
    }
    const cta = (p.buttonLabel || s.buttonLabel).toUpperCase();
    const ctaLs = 0.08;
    const ctaW = s.showButton ? fonts.semibold.getAdvanceWidth(cta, m.buyFs, { letterSpacing: ctaLs }) + 28 : 0;
    const textW = x + rowW - 8 - ctaW - 12 - tx;
    const textH = (p.brandName && s.showTitle ? brandFs * 1.3 + 2 : 0) + (s.showTitle ? nameFs * LINE : 0) + (p.price && s.showPrice ? priceFs * LINE : 0);
    let ty = y + (rowH - textH) / 2;
    if (p.brandName && s.showTitle) {
      out.push(textPath(fonts.semibold, fitText(fonts.semibold, p.brandName.toUpperCase(), brandFs, textW, 0.12), tx, ty + brandFs, brandFs, paint(s.brandTitleColor, 0.62), 0.12));
      ty += brandFs * 1.3 + 2;
    }
    if (s.showTitle) {
      out.push(textPath(fonts.regular, fitText(fonts.regular, p.name, nameFs, textW), tx, ty + nameFs, nameFs, paint(s.productTitleColor)));
      ty += nameFs * LINE;
    }
    if (p.price && s.showPrice) {
      out.push(textPath(fonts.semibold, `${currency}${p.price}`, tx, ty + priceFs, priceFs, paint(s.productTitleColor, 0.9)));
    }
    if (s.showButton) {
      const bh = m.btnH, bx = x + rowW - 8 - ctaW, by = y + (rowH - bh) / 2;
      out.push(`<rect x="${bx}" y="${by}" width="${ctaW}" height="${bh}" rx="${Math.min(s.buttonCornerRadius, bh / 2)}" ${paint(buttonBackground(s))}/>`);
      out.push(textPath(fonts.semibold, cta, bx + 14, by + bh / 2 + m.buyFs * 0.36, m.buyFs, paint(s.buttonTextColor), ctaLs));
    }
    y += rowH + 8;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><linearGradient id="dim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0.55"/><stop offset="1" stop-color="#000000" stop-opacity="0.8"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#dim)"/>` +
    `<g transform="scale(${k})">${out.join("")}</g></svg>`;
}

export function svgToPng(svg: string): Buffer {
  const fonts = loadFonts();
  return new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: fonts.files, defaultFontFamily: "Aileron" } }).render().asPng();
}

// ─── Fetching, carefully ─────────────────────────────────────────────────────

/** Loopback, private, link-local, CGNAT and other addresses that are never a public image host. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function publicHttpsUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a: any) => a.address);
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) return null;
  return u;
}

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;

/** A product image as a data URL, or null when it cannot be fetched safely. */
export async function fetchImageDataUrl(raw: string, maxBytes = 5 * 1024 * 1024): Promise<string | null> {
  if (raw.startsWith("data:")) return /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(raw) && raw.length < maxBytes * 1.4 ? raw : null;
  let url = await publicHttpsUrl(raw);
  for (let hop = 0; url && hop < 3; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      url = next ? await publicHttpsUrl(new URL(next, url).toString()) : null;
      continue;
    }
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!res.ok || !IMAGE_TYPES.test(type)) return null;
    if (Number(res.headers.get("content-length") || 0) > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  }
  return null;
}

/** Only the platform's own video hosts are read. */
export function isAllowedVideoUrl(raw: string, env: Record<string, string | undefined> = process.env): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  const bunny = (env.BUNNY_STREAM_HOST || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  return host.endsWith(".b-cdn.net") || host === "res.cloudinary.com" || (!!bunny && host === bunny);
}

// ─── ffmpeg ──────────────────────────────────────────────────────────────────

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });
    const t = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`)); });
  });
}

const HTTPS_ONLY = ["-protocol_whitelist", "https,tls,tcp"];

export async function probeVideo(url: string): Promise<{ width: number; height: number; duration: number; hasAudio: boolean }> {
  const ffprobe = ffmpegPath().replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
  const { stdout } = await run(ffprobe, [...HTTPS_ONLY, "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", url], 60_000);
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s: any) => s.codec_type === "video");
  if (!v) throw new Error("No video stream");
  return { width: v.width, height: v.height, duration: Number(j.format?.duration) || 0, hasAudio: (j.streams || []).some((s: any) => s.codec_type === "audio") };
}

/** Output size: the source's own, long side at most 1280, even numbers. */
export function outputSize(width: number, height: number, longSide = 1280): { W: number; H: number } {
  const k = Math.min(1, longSide / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { W: even(width), H: even(height) };
}

/** The player's stage width to lay the carousel out for: a phone for portrait, an embed for landscape. */
export const referenceStage = (W: number, H: number) => (H > W ? 390 : 700);

export interface RenderInput {
  videoUrl: string;
  products: ClipProduct[];
  settings: CarouselSettings;
  currency: string;
}

export async function renderShareClip(input: RenderInput, outFile: string, onProgress?: (pct: number) => void): Promise<void> {
  if (!isAllowedVideoUrl(input.videoUrl)) throw new Error("This video's file is not on the platform's video host");
  const info = await probeVideo(input.videoUrl);
  const duration = Math.min(info.duration || MAX_CLIP_SECONDS, MAX_CLIP_SECONDS);
  const { W, H } = outputSize(info.width, info.height);
  const frame = { W, H, ref: referenceStage(W, H) };
  const fonts = loadFonts();

  const images = new Map<string, string | null>();
  for (const p of input.products) {
    if (p.imageUrl && !images.has(p.imageUrl)) images.set(p.imageUrl, await fetchImageDataUrl(p.imageUrl).catch(() => null));
  }

  const work = join(clipDir(), `w-${randomUUID()}`);
  mkdirSync(work, { recursive: true });
  try {
    const overlays: { file: string; enable: string }[] = [];
    const endList = !input.settings.commerceEnabled && input.products.length > 0;
    if (input.settings.commerceEnabled) {
      carouselSegments(input.products, duration).forEach((seg, i) => {
        const file = join(work, `s${i}.png`);
        writeFileSync(file, svgToPng(carouselSvg(seg.items.map((j) => input.products[j]), input.settings, frame, fonts, images, input.currency)));
        overlays.push({ file, enable: `gte(t,${seg.start.toFixed(3)})*lt(t,${seg.end.toFixed(3)})` });
      });
    } else if (endList) {
      const file = join(work, "end.png");
      writeFileSync(file, svgToPng(endListSvg(input.products, input.settings, frame, fonts, images, input.currency)));
      overlays.push({ file, enable: `gte(t,${duration.toFixed(3)})` });
    }

    const total = duration + (endList ? END_LIST_SECONDS : 0);
    const chain: string[] = [`[0:v]scale=${W}:${H},setsar=1${endList ? `,tpad=stop_mode=clone:stop_duration=${END_LIST_SECONDS}` : ""}[v0]`];
    overlays.forEach((o, i) => chain.push(`[v${i}][${i + 1}:v]overlay=0:0:enable='${o.enable}'[v${i + 1}]`));
    const audio = info.hasAudio ? (endList ? [`[0:a]apad=pad_dur=${END_LIST_SECONDS}[a]`] : []) : [];
    const args = [
      "-y", ...HTTPS_ONLY, "-t", String(duration), "-i", input.videoUrl,
      ...overlays.flatMap((o) => ["-i", o.file]),
      "-filter_complex", [...chain, ...audio].join(";"),
      "-map", `[v${overlays.length}]`,
      ...(info.hasAudio ? ["-map", endList ? "[a]" : "0:a"] : []),
      "-t", String(total),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
      ...(info.hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : []),
      "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", outFile,
    ];
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpegPath(), args);
      let err = "";
      p.stdout.on("data", (d: Buffer) => {
        const m = d.toString().match(/out_time_ms=(\d+)/g);
        if (m && onProgress) onProgress(Math.min(99, Math.round((Number(m[m.length - 1].split("=")[1]) / 1e6 / total) * 100)));
      });
      p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
      const t = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("Rendering took too long")); }, 10 * 60_000);
      p.on("error", (e) => { clearTimeout(t); reject(e); });
      p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`)); });
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export function clipDir(): string {
  const d = join(tmpdir(), "mtrlzd-clips");
  mkdirSync(d, { recursive: true });
  return d;
}

/** Same video, products and look: same clip. Anything that changes the picture changes the key. */
export function clipKey(videoId: string, input: RenderInput): string {
  return createHash("sha256").update(JSON.stringify({ videoId, v: 1, ...input })).digest("hex").slice(0, 24);
}

export interface ClipJob {
  id: string;
  videoId: string;
  status: "queued" | "rendering" | "ready" | "failed";
  progress: number;
  error?: string;
  file: string;
  createdAt: number;
}

const jobs = new Map<string, ClipJob>();
let chain: Promise<void> = Promise.resolve();
const DAY = 24 * 60 * 60 * 1000;

function sweep(now = Date.now()) {
  for (const [id, j] of Array.from(jobs)) if (now - j.createdAt > DAY) { jobs.delete(id); try { unlinkSync(j.file); } catch { /* gone */ } }
  for (const f of readdirSync(clipDir())) {
    const p = join(clipDir(), f);
    try { if (now - statSync(p).mtimeMs > DAY) unlinkSync(p); } catch { /* gone or a dir */ }
  }
}

export function getClipJob(id: string): ClipJob | undefined { return jobs.get(id); }

/**
 * Start (or reuse) the clip for this video as it looks now. One render at a
 * time: each takes a CPU for up to a minute or two, and a queue keeps a burst
 * of clicks from slowing the whole site.
 */
export function startClipJob(videoId: string, input: RenderInput): ClipJob {
  sweep();
  const id = clipKey(videoId, input);
  const existing = jobs.get(id);
  if (existing && existing.status !== "failed") return existing;
  const job: ClipJob = { id, videoId, status: "queued", progress: 0, file: join(clipDir(), `${id}.mp4`), createdAt: Date.now() };
  if (existsSync(job.file) && statSync(job.file).size > 0) { job.status = "ready"; job.progress = 100; jobs.set(id, job); return job; }
  jobs.set(id, job);
  chain = chain.then(async () => {
    job.status = "rendering";
    try {
      const tmp = `${job.file}.part.mp4`;
      await renderShareClip(input, tmp, (pct) => { job.progress = pct; });
      renameSync(tmp, job.file);
      job.status = "ready"; job.progress = 100;
    } catch (err) {
      console.error(`[ShareClip] ${videoId} failed:`, err);
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
    }
  });
  return job;
}
