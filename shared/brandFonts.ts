/**
 * Uploaded brand fonts.
 *
 * The client: "Font upload must allow for the .otf or .ttf".
 *
 * Until now a font was either one of twelve built-ins or a NAME typed into the
 * brand kit and looked up on Google Fonts. A brand with its own licensed
 * typeface — which is most fashion brands — had no way to use it.
 *
 * ── The two things that make this different from any other upload ────────────
 *
 * 1. A FONT FILE IS SERVED TO THIRD-PARTY SITES. The embed renders
 *    `@font-face { src: url(...) }` into CSS on a brand's own page. Whatever is
 *    stored is therefore fetched and parsed by every visitor to that page, so
 *    "is this actually a font" has to be decided from the BYTES. An extension
 *    and a Content-Type are both set by whoever uploads.
 *
 * 2. THE FAMILY NAME LANDS IN A STYLESHEET. `font-family: 'X'` closes on an
 *    apostrophe as readily as any other CSS string. sanitiseSettings restricts
 *    fonts to a fixed key list precisely to stop that — so an uploaded font
 *    cannot simply be "whatever the user typed". It gets a GENERATED key that
 *    is structurally checkable (`custom:<uuid>`), and the human-readable label
 *    never reaches CSS at all: the stylesheet uses the key.
 */

/** Formats a browser can actually use, with their CSS `format()` token. */
export const FONT_FORMATS = {
  otf: { css: "opentype", mime: "font/otf", ext: ".otf" },
  ttf: { css: "truetype", mime: "font/ttf", ext: ".ttf" },
  woff: { css: "woff", mime: "font/woff", ext: ".woff" },
  woff2: { css: "woff2", mime: "font/woff2", ext: ".woff2" },
} as const;

export type FontFormat = keyof typeof FONT_FORMATS;

/** How long a family label may be. Long enough for real names, short enough to display. */
export const MAX_FONT_LABEL = 60;

/**
 * Biggest font we accept, in bytes.
 *
 * 5 MB is generous for a single weight — a full CJK face runs larger, but this
 * file is downloaded by every visitor to a brand's page before text renders.
 * A 40 MB upload is not a font problem, it is a page-speed problem inflicted on
 * the brand's own visitors.
 */
export const MAX_FONT_BYTES = 5 * 1024 * 1024;

/**
 * Identify a font from its first bytes.
 *
 * These are the actual signatures in the file header:
 *   OTF   'OTTO'                     — CFF outlines
 *   TTF   0x00010000, or 'true'      — the second is Apple's variant
 *   WOFF  'wOFF'
 *   WOFF2 'wOF2'
 *   TTC   'ttcf'                     — a collection; rejected, see below
 *
 * Returns null for anything else, INCLUDING files whose extension says
 * otherwise. This is the check that matters: a .ttf that is really a zip, an
 * HTML page or a PDF would otherwise be stored and then served from our domain
 * to a brand's visitors.
 */
export function sniffFontFormat(head: Uint8Array): FontFormat | null {
  if (head.length < 4) return null;
  const b = (i: number) => head[i];
  const ascii = String.fromCharCode(b(0), b(1), b(2), b(3));

  if (ascii === "OTTO") return "otf";
  if (ascii === "wOFF") return "woff";
  if (ascii === "wOF2") return "woff2";
  if (ascii === "true" || ascii === "ttcf") {
    // 'ttcf' is a TrueType COLLECTION — several faces in one file. Browsers do
    // not load one from @font-face, so accepting it would store something that
    // silently never renders. 'true' is a genuine single face.
    return ascii === "true" ? "ttf" : null;
  }
  if (b(0) === 0x00 && b(1) === 0x01 && b(2) === 0x00 && b(3) === 0x00) return "ttf";
  return null;
}

/** `custom:<uuid>` — the shape an uploaded font's key always takes. */
const CUSTOM_KEY = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build the CSS-safe key for an uploaded font. */
export function customFontKey(id: string): string {
  return `custom:${id}`;
}

/**
 * Is this a well-formed uploaded-font key?
 *
 * Structural, not a lookup — which is the whole point. sanitiseSettings cannot
 * consult the database, so it needs to decide "could this be a custom font key"
 * from the string alone. A uuid after a fixed prefix contains nothing that can
 * escape a CSS context, so a key passing this is safe to interpolate even if it
 * names a font that no longer exists.
 */
export function isCustomFontKey(value: unknown): boolean {
  return typeof value === "string" && CUSTOM_KEY.test(value.trim());
}

/** The uuid part, for looking the font up. Null if the key is malformed. */
export function customFontId(value: string): string | null {
  return isCustomFontKey(value) ? value.trim().slice("custom:".length) : null;
}

/**
 * A label safe to show in the app.
 *
 * Never reaches CSS — the stylesheet uses the key — but it does reach the
 * admin UI and the creator's own font picker, so it is stripped of anything
 * that could matter if some future caller renders it as markup.
 */
export function sanitiseFontLabel(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  return s.replace(/[<>"'`\\{};]/g, "").trim().slice(0, MAX_FONT_LABEL);
}

/**
 * The @font-face rule for one uploaded font.
 *
 * The family name is the KEY, not the label — so nothing a user typed is ever
 * interpolated into the stylesheet. `font-display: swap` so a brand's text is
 * readable while the file loads rather than invisible.
 */
export function fontFaceRule(key: string, url: string, format: FontFormat): string {
  if (!isCustomFontKey(key)) return "";
  // https only: this URL is fetched by a brand's visitors, and a mixed-content
  // font on an https page is blocked outright, which renders as a silent
  // fallback nobody can diagnose.
  if (!/^https:\/\//i.test(url)) return "";
  // A URL containing a quote or a paren would close the url() token.
  if (/["'()\\]/.test(url)) return "";
  return `@font-face{font-family:'${key}';src:url('${url}') format('${FONT_FORMATS[format].css}');font-display:swap;}`;
}
