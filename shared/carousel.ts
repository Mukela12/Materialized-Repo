/**
 * What a product carousel looks like, and where its values come from.
 *
 * ── Why this is shared, and why it is one file ───────────────────────────────
 * The settings shape was declared twice — once in ProductCarouselEditor, once
 * in the Brand Kit page — with the mapping to and from the database written out
 * by hand in each. They drifted, as duplicated lists do: the Brand Kit preview
 * honoured two of the eight carousel positions, so choosing "bottom-right"
 * drew the carousel bottom-centre. The setting saved correctly the whole time;
 * only the picture lied, and the client reasonably concluded the positioning
 * options did not exist.
 *
 * Adding a setting now means editing this file, the schema and the migration.
 * Nothing else needs to know the full list.
 *
 * ── The precedence rule ──────────────────────────────────────────────────────
 *   base defaults  ->  the user's brand kit  ->  this video's override
 * with NULL at any layer meaning "inherit from the one before". That is what
 * lets the client restyle a single video for a season without disturbing the
 * thirty others that use her defaults.
 */
import { BUTTON_LABEL_OPTIONS, CAROUSEL_POSITION_OPTIONS } from "./schema";

export type CarouselPosition = (typeof CAROUSEL_POSITION_OPTIONS)[number];
export type ButtonLabel = (typeof BUTTON_LABEL_OPTIONS)[number];

export interface CarouselSettings {
  position: CarouselPosition;
  positionOffsetX: number;
  positionOffsetY: number;
  delayUntilEnd: boolean;

  /** The panel. */
  carouselBackgroundColor: string;
  backgroundOpacity: number;
  cornerRadius: number;

  /** The button. Its radius is deliberately NOT the panel's — see 0022. */
  buttonColor: string;
  buttonTextColor: string;
  buttonHoverColor: string;
  buttonOpacity: number;
  buttonCornerRadius: number;
  buttonLabel: ButtonLabel;

  /** Text. Both were previously locked to the theme's white. */
  brandTitleColor: string;
  productTitleColor: string;

  buttonFont: string;
  titleFont: string;
  titleFontSize: number;
  priceFontSize: number;
  buttonFontSize: number;

  showThumbnail: boolean;
  showButton: boolean;
  showPrice: boolean;
  showTitle: boolean;

  /**
   * Sell during playback, or list the products at the end instead.
   * The client's "Enable Commerce / Disable Commerce" radio.
   */
  commerceEnabled: boolean;
}

/** The single source for what a carousel looks like before anyone styles it. */
export const CAROUSEL_DEFAULTS: CarouselSettings = {
  position: "bottom",
  positionOffsetX: 0,
  positionOffsetY: 0,
  delayUntilEnd: false,

  // Black at 55% is what the hard-coded panel already rendered as, so an
  // existing carousel looks identical after this change until someone edits it.
  carouselBackgroundColor: "#000000",
  backgroundOpacity: 55,
  cornerRadius: 16,

  buttonColor: "#1351aa",
  buttonTextColor: "#FFFFFF",
  buttonHoverColor: "#0f3f85",
  buttonOpacity: 100,
  buttonCornerRadius: 999, // pill, which is what the button already was
  buttonLabel: "BUY NOW",

  brandTitleColor: "#FFFFFF",
  productTitleColor: "#FFFFFF",

  buttonFont: "system",
  titleFont: "system",
  titleFontSize: 100,
  priceFontSize: 100,
  buttonFontSize: 100,

  showThumbnail: true,
  showButton: true,
  showPrice: true,
  showTitle: true,

  commerceEnabled: true,
};

/** Only the keys that exist on both a brand kit and a per-video override. */
const SHARED_KEYS = [
  "position", "cornerRadius", "backgroundOpacity",
  "showThumbnail", "showButton", "showPrice", "showTitle",
  "buttonLabel", "buttonFont", "buttonColor", "buttonTextColor",
  "carouselBackgroundColor", "buttonCornerRadius", "brandTitleColor",
  "productTitleColor", "buttonHoverColor", "buttonOpacity", "commerceEnabled",
] as const;

/** Keys that only a per-video override carries. */
const OVERRIDE_ONLY_KEYS = ["positionOffsetX", "positionOffsetY", "delayUntilEnd"] as const;

/** `default`-prefixed name of a shared key, as stored on brand_kits. */
function defaultKey(key: string): string {
  return "default" + key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Fold a brand kit row into settings. Anything unset on the row is left at the
 * base default rather than becoming null — a half-populated settings object is
 * how a colour picker ends up rendering "undefined".
 */
export function settingsFromBrandKit(kit: Record<string, any> | null | undefined): CarouselSettings {
  const out: CarouselSettings = { ...CAROUSEL_DEFAULTS };
  if (!kit) return out;
  for (const key of SHARED_KEYS) {
    const v = kit[defaultKey(key)];
    if (v !== null && v !== undefined) (out as any)[key] = v;
  }
  return out;
}

/** Settings back into the `default*` columns, for saving a brand kit. */
export function brandKitFromSettings(s: CarouselSettings): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of SHARED_KEYS) out[defaultKey(key)] = (s as any)[key];
  return out;
}

/**
 * Apply a per-video override on top of settings.
 *
 * NULL means inherit — the whole point of the override table — so only values
 * that are actually set replace what came before.
 */
export function applyOverride(
  base: CarouselSettings,
  override: Record<string, any> | null | undefined,
): CarouselSettings {
  const out: CarouselSettings = { ...base };
  if (!override) return out;
  for (const key of [...SHARED_KEYS, ...OVERRIDE_ONLY_KEYS]) {
    const v = override[key];
    if (v !== null && v !== undefined) (out as any)[key] = v;
  }
  return out;
}

/**
 * The panel's background as a CSS colour.
 *
 * Opacity is stored 0–100 separately from the hex so the two controls the
 * client asked for stay independent: changing the colour must not reset the
 * transparency, and vice versa.
 */
export function panelBackground(s: Pick<CarouselSettings, "carouselBackgroundColor" | "backgroundOpacity">): string {
  return withAlpha(s.carouselBackgroundColor, s.backgroundOpacity);
}

/** The button's background, same treatment. */
export function buttonBackground(s: Pick<CarouselSettings, "buttonColor" | "buttonOpacity">): string {
  return withAlpha(s.buttonColor, s.buttonOpacity);
}

/**
 * `#rrggbb` + 0–100 -> `rgba(...)`.
 *
 * Handles #rgb and #rrggbb. Anything else is returned untouched rather than
 * mangled into `rgba(NaN,NaN,NaN)`, which renders as transparent black and
 * looks exactly like the carousel having disappeared.
 */
export function withAlpha(hex: string, opacityPct: number): string {
  const a = Math.min(100, Math.max(0, opacityPct)) / 100;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Does this position lay products side by side, or stack them?
 *
 * The client's rule: anchored top or bottom there is width to spare, so several
 * products sit next to each other; anchored to a side there is not, so they
 * stack. A side-by-side row pinned to the left edge would run the width of the
 * video and cover the thing being sold.
 */
export function isStackedPosition(position: CarouselPosition | string): boolean {
  return position === "left" || position === "right";
}
