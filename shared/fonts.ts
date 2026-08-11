/**
 * Font stacks, shared by the browser and the server.
 *
 * `fontStack` lived only in client/src/lib/fonts.ts. The embed is rendered on
 * the SERVER and needs the same resolution, and copying the map across would
 * have recreated the drift that has already bitten this project twice — a
 * carousel preview that disagreed with the carousel. So the pure part moved
 * here and the client module re-exports it.
 *
 * The constraint that matters is unchanged: a font is only offered if it can
 * actually render, because a name that silently falls back to system-ui looks
 * exactly like a setting that does not work.
 */

import { isCustomFontKey } from "./brandFonts";

/** Fonts guaranteed to render: in index.html's Google Fonts link, or a local @font-face. */
export const BUILT_IN_FONTS = [
  { value: "system", label: "System default", stack: "system-ui, -apple-system, sans-serif" },
  { value: "aileron", label: "Aileron", stack: "'Aileron', sans-serif" },
  { value: "lekton", label: "Lekton", stack: "'Lekton', monospace" },
  { value: "inter", label: "Inter", stack: "'Inter', sans-serif" },
  { value: "roboto", label: "Roboto", stack: "'Roboto', sans-serif" },
  { value: "poppins", label: "Poppins", stack: "'Poppins', sans-serif" },
  { value: "montserrat", label: "Montserrat", stack: "'Montserrat', sans-serif" },
  { value: "playfair", label: "Playfair Display", stack: "'Playfair Display', serif" },
  { value: "dm-sans", label: "DM Sans", stack: "'DM Sans', sans-serif" },
  { value: "outfit", label: "Outfit", stack: "'Outfit', sans-serif" },
  { value: "lora", label: "Lora", stack: "'Lora', serif" },
  { value: "space-grotesk", label: "Space Grotesk", stack: "'Space Grotesk', sans-serif" },
] as const;

const BY_VALUE = new Map<string, { value: string; label: string; stack: string }>(
  BUILT_IN_FONTS.map((f) => [f.value, f]),
);

/**
 * A stored font setting as a CSS font-family stack.
 *
 * ON THE QUOTE STRIPPING: this result is interpolated into a stylesheet that
 * the embed serves inside a BRAND'S page. A custom family is a creator-supplied
 * string, and an apostrophe in it would close the quoted family name and let
 * the rest be read as CSS. Quotes are removed, and the embed additionally only
 * ever passes values that `sanitiseSettings` has restricted to the known keys
 * above — belt and braces, because this one is served cross-site.
 */
export function fontStack(value: string | undefined | null): string {
  if (!value) return BY_VALUE.get("system")!.stack;
  const builtIn = BY_VALUE.get(value);
  if (builtIn) return builtIn.stack;

  /**
   * An uploaded font's key — `custom:<uuid>` — is the family name declared by
   * the @font-face rule the embed emits. It is quoted here and contains nothing
   * that can escape those quotes, which is precisely why the key is generated
   * rather than taken from what the user typed.
   *
   * The fallback stays, so a deleted font degrades to a readable page rather
   * than nothing.
   */
  if (isCustomFontKey(value)) return `'${value}', sans-serif`;

  return `'${String(value).replace(/['"\;{}<>()]/g, "")}', sans-serif`;
}
