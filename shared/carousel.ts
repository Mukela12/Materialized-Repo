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
import { BUTTON_LABEL_OPTIONS, CAROUSEL_POSITION_OPTIONS, FONT_OPTIONS } from "./schema";
import { isCustomFontKey } from "./brandFonts";

/** The font keys that may appear in a stylesheet. See sanitiseSettings. */
const FONT_KEYS = FONT_OPTIONS.map((f) => f.value) as readonly string[];

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

// ── Sanitising, for anywhere settings are interpolated into CSS or HTML ──────
//
// THE THREAT
//   Colours and fonts are free-text columns a creator controls. The embed is
//   server-rendered HTML served INSIDE A BRAND'S PAGE, so a value like
//       #fff;} #pay{display:none} .x{
//   would close the rule it sits in and write arbitrary CSS — hiding the
//   checkout, covering the video, or overlaying content on someone else's site.
//   Nothing about the storage path prevents that: the column is `text`, and the
//   admin screen is not the only way to write it.
//
//   So no value reaches a stylesheet without passing through here. Anything
//   that does not match its expected shape falls back to the default rather
//   than being escaped and emitted — an invalid colour has no correct rendering
//   anyway, and a fallback is the only safe interpretation.

/** `#rgb` or `#rrggbb`, and nothing else. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A colour, or the given fallback if it is not one. */
export function safeColor(value: unknown, fallback: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  return HEX.test(v) ? v : fallback;
}

/** A built-in font key, an uploaded font's `custom:<uuid>`, or the fallback. */
export function safeFontKey(value: unknown, fallback: string): string {
  if (isCustomFontKey(value)) return (value as string).trim();
  return safeEnum(value, FONT_KEYS, fallback);
}

/** A whole number inside [min, max], or the fallback. */
export function safeInt(value: unknown, min: number, max: number, fallback: number): number {
  // `Number("")` and `Number(null)` are both 0, and 0 is finite — so an unset
  // value would sail through as a real zero. For backgroundOpacity that is an
  // invisible carousel, reached by leaving a field blank.
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  if (typeof value === "boolean") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** One of `allowed`, compared case-insensitively, or the fallback. */
export function safeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (allowed.find((a) => a.toLowerCase() === v) ?? fallback) as T;
}

/**
 * Every field validated against its own shape.
 *
 * Call this on anything read from the database before it is rendered. It is
 * deliberately total — it returns a complete settings object, so a caller
 * cannot forget one field and interpolate the raw value by accident.
 */
export function sanitiseSettings(raw: Partial<CarouselSettings> | null | undefined): CarouselSettings {
  const d = CAROUSEL_DEFAULTS;
  const r = raw ?? {};
  return {
    position: safeEnum(r.position, CAROUSEL_POSITION_OPTIONS, d.position),
    positionOffsetX: safeInt(r.positionOffsetX, -200, 200, d.positionOffsetX),
    positionOffsetY: safeInt(r.positionOffsetY, -200, 200, d.positionOffsetY),
    delayUntilEnd: typeof r.delayUntilEnd === "boolean" ? r.delayUntilEnd : d.delayUntilEnd,

    carouselBackgroundColor: safeColor(r.carouselBackgroundColor, d.carouselBackgroundColor),
    backgroundOpacity: safeInt(r.backgroundOpacity, 0, 100, d.backgroundOpacity),
    cornerRadius: safeInt(r.cornerRadius, 0, 80, d.cornerRadius),

    buttonColor: safeColor(r.buttonColor, d.buttonColor),
    buttonTextColor: safeColor(r.buttonTextColor, d.buttonTextColor),
    buttonHoverColor: safeColor(r.buttonHoverColor, d.buttonHoverColor),
    buttonOpacity: safeInt(r.buttonOpacity, 0, 100, d.buttonOpacity),
    buttonCornerRadius: safeInt(r.buttonCornerRadius, 0, 999, d.buttonCornerRadius),
    buttonLabel: safeEnum(r.buttonLabel, BUTTON_LABEL_OPTIONS, d.buttonLabel),

    brandTitleColor: safeColor(r.brandTitleColor, d.brandTitleColor),
    productTitleColor: safeColor(r.productTitleColor, d.productTitleColor),

    /**
     * A built-in key, or an uploaded font's generated key.
     *
     * Never a raw family name: that string ends up inside `font-family:` and
     * closes on an apostrophe like any other. A built-in is checked against the
     * fixed list; an uploaded one is checked STRUCTURALLY, because this
     * function cannot reach the database — `custom:<uuid>` contains nothing
     * that can escape a CSS context, so it is safe to pass through even if it
     * names a font that has since been deleted.
     *
     * Without this branch an uploaded font would fail safeEnum and revert to
     * system-ui on every render — the setting saving, and doing nothing, which
     * is the failure this project keeps producing.
     */
    buttonFont: safeFontKey(r.buttonFont, d.buttonFont),
    titleFont: safeFontKey(r.titleFont, d.titleFont),
    titleFontSize: safeInt(r.titleFontSize, 50, 200, d.titleFontSize),
    priceFontSize: safeInt(r.priceFontSize, 50, 200, d.priceFontSize),
    buttonFontSize: safeInt(r.buttonFontSize, 50, 200, d.buttonFontSize),

    showThumbnail: typeof r.showThumbnail === "boolean" ? r.showThumbnail : d.showThumbnail,
    showButton: typeof r.showButton === "boolean" ? r.showButton : d.showButton,
    showPrice: typeof r.showPrice === "boolean" ? r.showPrice : d.showPrice,
    showTitle: typeof r.showTitle === "boolean" ? r.showTitle : d.showTitle,

    commerceEnabled: typeof r.commerceEnabled === "boolean" ? r.commerceEnabled : d.commerceEnabled,
  };
}

/**
 * What this video overrides, relative to the creator's defaults.
 *
 * ── Why a diff, and not just "save the settings" ─────────────────────────────
 * The client's intent: "Product Carousel Styling are Default settings for this
 * user and all of their videos. However, the user should have capabilities to
 * edit each unique video setting."
 *
 * Both halves matter. If editing one video wrote all eighteen fields as
 * overrides — which is what saving a whole settings object does — that video
 * would be permanently detached from the brand kit. She changes her palette for
 * a season, every video follows except the ones she once tweaked, and nothing
 * on screen explains why. The override table's nullable columns exist precisely
 * to avoid that: NULL means inherit.
 *
 * So only fields that actually DIFFER from the baseline are stored. Everything
 * else is explicitly NULLed, which also means unticking a change restores
 * inheritance rather than freezing the current value.
 */
export function overrideFromSettings(
  base: CarouselSettings,
  edited: CarouselSettings,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of [...SHARED_KEYS, ...OVERRIDE_ONLY_KEYS]) {
    const a = (base as any)[key];
    const b = (edited as any)[key];
    // Colours compare case-insensitively: a picker returns "#1F1B6D" for a
    // stored "#1f1b6d", and storing that as an override would detach the field
    // from the brand kit over a difference nobody can see.
    const same = typeof a === "string" && typeof b === "string"
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;
    out[key] = same ? null : b;
  }
  return out;
}

/** Which fields this video overrides. For telling someone what is not inherited. */
export function overriddenKeys(override: Record<string, any> | null | undefined): string[] {
  if (!override) return [];
  return [...SHARED_KEYS, ...OVERRIDE_ONLY_KEYS].filter(
    (k) => override[k] !== null && override[k] !== undefined,
  );
}

/** An override that inherits everything — used to reset a video to the defaults. */
export function emptyOverride(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of [...SHARED_KEYS, ...OVERRIDE_ONLY_KEYS]) out[key] = null;
  return out;
}
