/**
 * From a scanned Brand Kit to a product carousel.
 *
 * The scan (server/replit_integrations/pdf_analysis) reads a brand's guideline
 * PDF and returns its colours and fonts. Until 23 Nov 2026 that was where it
 * stopped: the colours were listed on the Brand Kit page and the carousel kept
 * the platform's blue. The client: "ensure that it scans and applies these
 * settings to the product carousel, and holds it as a Default setting which can
 * be over-written manually by the user in their Editing Suite."
 *
 * This file is the "applies" step, and it is pure so the rules can be tested
 * without a PDF or a model. What it decides:
 *
 *   button          the brand's primary colour (then accent, then secondary)
 *   button text     the brand's background or text colour if it reads on the
 *                   button, otherwise white or near-black, whichever reads
 *   button hover    a shade of the button colour
 *   panel           the brand's background colour, when the button still
 *                   stands out against it
 *   titles          the brand's text colour if it reads on the panel,
 *                   otherwise white or near-black
 *   fonts           the heading font for titles and the body font for the
 *                   button, when the font is one the carousel can draw
 *
 * A light panel over a video only stays legible when it is mostly opaque, so
 * its opacity is raised to LIGHT_PANEL_MIN_OPACITY. Nothing else about the
 * carousel (position, corners, what it shows, the button's wording) is touched.
 *
 * "Reads" is WCAG contrast: 4.5 to 1 for a brand's own colour, and at least
 * 3 to 1 for the white or near-black that replaces a pairing that fails.
 */
import { FONT_OPTIONS } from "./schema";
import type { CarouselSettings } from "./carousel";

export interface BrandScan {
  colors?: {
    primary?: string | null;
    secondary?: string | null;
    accent?: string | null;
    background?: string | null;
    text?: string | null;
    additionalColors?: (string | null)[] | null;
  } | null;
  fonts?: {
    headingFont?: string | null;
    bodyFont?: string | null;
    accentFont?: string | null;
    additionalFonts?: (string | null)[] | null;
  } | null;
}

/** A font the account uploaded: its `custom:<uuid>` key and the name it was given. */
export interface UploadedFont { key: string; label: string }

/** One thing the scan changed, for telling the person what happened. */
export interface AppliedChange {
  field: keyof CarouselSettings;
  /** What the person calls it: "Button", "Title font". */
  label: string;
  /** The new value: a hex colour, or a font's name. */
  value: string;
  kind: "color" | "font";
}

export interface BrandScanResult {
  settings: CarouselSettings;
  applied: AppliedChange[];
  /** Fonts the guidelines name that the carousel cannot draw yet. */
  fontsToUpload: string[];
}

export const READABLE_CONTRAST = 4.5;
/** WCAG's floor for bold or large text and for controls. */
export const BOLD_CONTRAST = 3;
export const LIGHT_PANEL_MIN_OPACITY = 85;
const WHITE = "#FFFFFF";
const INK = "#111111";

/** `#rgb` or `#rrggbb` (with or without the #) as `#RRGGBB`, or null. */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return "#" + h.toUpperCase();
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The first of `preferred` that reads on `background`; failing that, white or
 * near-black.
 *
 * White wins that last choice from BOLD_CONTRAST up, not only when it is the
 * stronger of the two: on a mid-tone red, green or blue, white is what the
 * brand itself would put on a button, and the carousel's text is bold. Black
 * is for the yellows and pastels where white cannot be read at all.
 */
export function readableOn(background: string, preferred: (string | null)[]): string {
  for (const c of preferred) {
    if (c && contrast(c, background) >= READABLE_CONTRAST) return c;
  }
  return contrast(WHITE, background) >= BOLD_CONTRAST ? WHITE : INK;
}

/**
 * The hover colour for a button: a little darker, or a little lighter when the
 * button is already too dark for darker to show.
 */
export function hoverShade(hex: string): string {
  const dark = luminance(hex) < 0.06;
  const out = channels(hex).map((c) =>
    dark ? Math.round(c + (255 - c) * 0.22) : Math.round(c * 0.82),
  );
  return "#" + out.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A font the guidelines name, as a key the carousel can draw: one of the
 * account's uploaded fonts first, then a built-in. null when it is neither.
 *
 * "Montserrat Bold" and "Playfair Display Regular" match their family: a
 * guideline names the weight, the carousel sets its own. An upload still named
 * after its file ("canela-deck-regular") matches the family it starts with.
 */
export function matchFont(name: unknown, uploaded: UploadedFont[] = []): { key: string; label: string } | null {
  if (typeof name !== "string" || !plain(name)) return null;
  const wanted = plain(name);
  const candidates = [
    ...uploaded.map((f) => ({ key: f.key, label: f.label })),
    ...FONT_OPTIONS.filter((f) => f.value !== "system").map((f) => ({ key: f.value as string, label: f.label as string })),
  ];
  const exact = candidates.find((c) => plain(c.label) === wanted);
  if (exact) return exact;
  // Longest family first, so "DM Sans" is not taken for a font that merely starts "DM".
  const byLength = [...candidates].sort((a, b) => plain(b.label).length - plain(a.label).length);
  const family = byLength.find((c) => plain(c.label).length >= 4 && wanted.startsWith(plain(c.label)));
  if (family) return family;
  // The other way round: an upload keeps its file name unless it is renamed,
  // so the guideline's "Canela" has to find "canela-deck-regular".
  if (wanted.length < 4) return null;
  return candidates.find((c) => plain(c.label).startsWith(wanted)) ?? null;
}

/** Lay a scan over the current settings. See the file header for the rules. */
export function carouselFromBrandScan(
  scan: BrandScan | null | undefined,
  current: CarouselSettings,
  uploaded: UploadedFont[] = [],
): BrandScanResult {
  const settings: CarouselSettings = { ...current };
  const applied: AppliedChange[] = [];
  const set = (field: keyof CarouselSettings, label: string, value: string, kind: "color" | "font", shown = value) => {
    (settings as any)[field] = value;
    applied.push({ field, label, value: shown, kind });
  };

  const c = scan?.colors ?? {};
  const primary = normaliseHex(c.primary);
  const secondary = normaliseHex(c.secondary);
  const accent = normaliseHex(c.accent);
  const background = normaliseHex(c.background);
  const text = normaliseHex(c.text);

  const button = primary ?? accent ?? secondary;
  if (button) {
    set("buttonColor", "Button", button, "color");
    set("buttonTextColor", "Button text", readableOn(button, [background, text]), "color");
    set("buttonHoverColor", "Button hover", hoverShade(button), "color");
  }

  // The panel takes the brand's background only when the button would still
  // stand out on it: a white button on a white panel is a button nobody finds.
  const buttonNow = normaliseHex(settings.buttonColor) ?? "#1351AA";
  if (background && contrast(background, buttonNow) >= 1.5) {
    set("carouselBackgroundColor", "Panel", background, "color");
    if (luminance(background) > 0.4 && settings.backgroundOpacity < LIGHT_PANEL_MIN_OPACITY) {
      settings.backgroundOpacity = LIGHT_PANEL_MIN_OPACITY;
    }
  }

  // Titles follow the panel they sit on, whether or not the panel just changed.
  if (button || background || text) {
    const panel = normaliseHex(settings.carouselBackgroundColor) ?? "#000000";
    const title = readableOn(panel, [text, secondary]);
    set("productTitleColor", "Product title", title, "color");
    set("brandTitleColor", "Brand name", title, "color");
  }

  const f = scan?.fonts ?? {};
  const fontsToUpload: string[] = [];
  const named = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const heading = named(f.headingFont);
  const body = named(f.bodyFont) ?? heading;

  const headingMatch = matchFont(heading, uploaded);
  if (headingMatch) set("titleFont", "Title font", headingMatch.key, "font", headingMatch.label);
  else if (heading) fontsToUpload.push(heading);

  const bodyMatch = matchFont(body, uploaded);
  if (bodyMatch) set("buttonFont", "Button font", bodyMatch.key, "font", bodyMatch.label);
  else if (body && !fontsToUpload.includes(body)) fontsToUpload.push(body);

  return { settings, applied, fontsToUpload };
}
