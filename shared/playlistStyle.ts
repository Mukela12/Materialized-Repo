/**
 * The frame a playlist's videos are viewed in.
 *
 * The client, verbatim: "Playlist Styling refers to the box in which one or
 * several videos are viewed in. There should be basic options here to Add
 * Border (1pt - 5pt), Color Border, Corners, Show Frame/Hide Frame (radio
 * selection), Show Play Button/Automatic Playback, Play Button color, size,
 * opacity. Show Audio/Hide Audio, Audio Icon/Mute Icon color, size, opacity.
 * Add Logo, Logo position (…)".
 *
 * None of it existed. The embed drew a fixed black rounded rectangle — and,
 * more to the point, the script that was supposed to draw it had never been
 * written, so every published playlist embed 404'd.
 *
 * ── Same sanitising rule as the carousel ─────────────────────────────────────
 * These are publisher-controlled values rendered inside somebody else's page.
 * Nothing reaches a stylesheet without passing through here, and anything that
 * does not match its shape falls back rather than being escaped — an invalid
 * colour has no correct rendering.
 */
import { safeColor, safeInt, safeEnum } from "./carousel";

/**
 * Where a publisher's logo sits.
 *
 * The `watermark-*` variants are the same corners at reduced opacity — her
 * list names both, and they differ only in how present the mark is.
 */
export const LOGO_POSITIONS = [
  "top-left", "top-middle", "top-right",
  "bottom-left", "bottom-middle", "bottom-right",
  "watermark-top-left", "watermark-top-right",
  "watermark-bottom-left", "watermark-bottom-right",
] as const;

export type LogoPosition = (typeof LOGO_POSITIONS)[number];

export interface PlaylistStyle {
  /** The frame itself. Hidden, the video sits flush with no border or radius. */
  frameShow: boolean;
  frameBorderWidth: number;
  frameBorderColor: string;
  frameCornerRadius: number;

  /** Autoplay, or show a play button and wait. Her radio. */
  playAutoplay: boolean;
  playButtonColor: string;
  playButtonSize: number;
  playButtonOpacity: number;

  audioShow: boolean;
  audioIconColor: string;
  audioIconSize: number;
  audioIconOpacity: number;

  logoUrl: string | null;
  logoPosition: LogoPosition;
}

export const PLAYLIST_STYLE_DEFAULTS: PlaylistStyle = {
  // Reproduces what the embed already drew, so nothing published changes look.
  frameShow: true,
  frameBorderWidth: 0,
  frameBorderColor: "#000000",
  frameCornerRadius: 12,

  // Autoplay muted is what the existing player does; browsers block sound-on
  // autoplay anyway, so the alternative is a video that silently never starts.
  playAutoplay: true,
  playButtonColor: "#FFFFFF",
  playButtonSize: 72,
  playButtonOpacity: 90,

  audioShow: true,
  audioIconColor: "#FFFFFF",
  audioIconSize: 28,
  audioIconOpacity: 85,

  logoUrl: null,
  logoPosition: "bottom-right",
};

/** Column names on `playlists`, which carry no prefix — unlike the brand kit. */
const KEYS = [
  "frameShow", "frameBorderWidth", "frameBorderColor", "frameCornerRadius",
  "playAutoplay", "playButtonColor", "playButtonSize", "playButtonOpacity",
  "audioShow", "audioIconColor", "audioIconSize", "audioIconOpacity",
  "logoUrl", "logoPosition",
] as const;

/** Fold a playlist row into style, leaving unset columns at their default. */
export function styleFromPlaylist(row: Record<string, any> | null | undefined): PlaylistStyle {
  const out: PlaylistStyle = { ...PLAYLIST_STYLE_DEFAULTS };
  if (!row) return out;
  for (const key of KEYS) {
    const v = row[key];
    if (v !== null && v !== undefined) (out as any)[key] = v;
  }
  return out;
}

/**
 * Every field validated. Total, so a caller cannot forget one and interpolate
 * a raw value by accident.
 */
export function sanitisePlaylistStyle(raw: Partial<PlaylistStyle> | null | undefined): PlaylistStyle {
  const d = PLAYLIST_STYLE_DEFAULTS;
  const r = raw ?? {};
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

  return {
    frameShow: bool(r.frameShow, d.frameShow),
    // Her stated range is 1–5pt; 0 is allowed as "border off" while the frame
    // itself stays on, which is a different thing from hiding the frame.
    frameBorderWidth: safeInt(r.frameBorderWidth, 0, 5, d.frameBorderWidth),
    frameBorderColor: safeColor(r.frameBorderColor, d.frameBorderColor),
    frameCornerRadius: safeInt(r.frameCornerRadius, 0, 60, d.frameCornerRadius),

    playAutoplay: bool(r.playAutoplay, d.playAutoplay),
    playButtonColor: safeColor(r.playButtonColor, d.playButtonColor),
    playButtonSize: safeInt(r.playButtonSize, 24, 160, d.playButtonSize),
    playButtonOpacity: safeInt(r.playButtonOpacity, 0, 100, d.playButtonOpacity),

    audioShow: bool(r.audioShow, d.audioShow),
    audioIconColor: safeColor(r.audioIconColor, d.audioIconColor),
    audioIconSize: safeInt(r.audioIconSize, 12, 96, d.audioIconSize),
    audioIconOpacity: safeInt(r.audioIconOpacity, 0, 100, d.audioIconOpacity),

    logoUrl: safeImageUrl(r.logoUrl),
    logoPosition: safeEnum(r.logoPosition, LOGO_POSITIONS, d.logoPosition),
  };
}

/**
 * A logo URL, or null.
 *
 * https only, and no credentials in the authority. This ends up in an `img
 * src` on a third-party page: `javascript:` is the obvious attack, and a
 * `data:` URL can carry SVG, which executes script when loaded as a document
 * and is a common way to smuggle one past a naive check.
 */
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Is this position one of the reduced-opacity watermark variants? */
export function isWatermark(position: LogoPosition | string): boolean {
  return String(position).startsWith("watermark-");
}

/** CSS edges for a logo position, as a declaration list. */
export function logoPositionCss(position: LogoPosition | string): string {
  const p = String(position).replace(/^watermark-/, "");
  const gap = "clamp(6px,2%,14px)";
  switch (p) {
    case "top-left":      return `top:${gap};left:${gap};`;
    case "top-middle":    return `top:${gap};left:50%;transform:translateX(-50%);`;
    case "top-right":     return `top:${gap};right:${gap};`;
    case "bottom-left":   return `bottom:${gap};left:${gap};`;
    case "bottom-middle": return `bottom:${gap};left:50%;transform:translateX(-50%);`;
    case "bottom-right":  return `bottom:${gap};right:${gap};`;
    default:              return `bottom:${gap};right:${gap};`;
  }
}
