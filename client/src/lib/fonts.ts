/**
 * Font loading for brand styling.
 *
 * WHY THIS EXISTS
 *   The carousel editor offered eight fonts, two of which were never available:
 *   "Oswald" was in the picker but absent from the Google Fonts link in
 *   index.html, and "Public Pixel" exists nowhere in the project at all — the
 *   only local @font-face families are Aileron and Lekton. Choosing either one
 *   silently fell back to system-ui, so the setting appeared to save and changed
 *   nothing.
 *
 *   Separately, a brand could type any font name into the brand kit. That name
 *   was stored and used as a CSS font-family, but nothing ever loaded a font by
 *   that name, so it too silently fell back. A client added one called "Hello",
 *   saw it save, and reasonably reported the feature as broken.
 *
 * THE RULE HERE
 *   A font is only offered if it can actually render. Anything loaded on demand
 *   is verified with document.fonts.check() before it is reported as available,
 *   so the UI can say "not found" rather than showing a silent fallback.
 */

// The stacks and `fontStack` now live in shared/fonts.ts so the server-rendered
// embed resolves fonts identically. Re-exported here so existing imports of
// "@/lib/fonts" keep working.
export { BUILT_IN_FONTS, fontStack } from "@shared/fonts";
// Also imported by value — ensureGoogleFont below reads the list.
import { BUILT_IN_FONTS } from "@shared/fonts";

/** Track injected stylesheets so the same family is never requested twice. */
const requested = new Set<string>();

function googleFontHref(family: string): string {
  const name = family.trim().replace(/\s+/g, "+");
  // Ask for a usable weight range; display=swap avoids invisible text while loading.
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%2B/g, "+")}:wght@300..700&display=swap`;
}

/**
 * Load a font from Google Fonts and report whether it actually rendered.
 *
 * Resolves `true` only when the browser confirms the family is usable. A name
 * Google does not publish yields a stylesheet that loads fine but defines
 * nothing, which is exactly how "Hello" appeared to work — so the check is on
 * the font, not on the network request.
 */
export async function ensureGoogleFont(family: string): Promise<boolean> {
  const name = family.trim();
  if (!name) return false;

  const builtIn = BUILT_IN_FONTS.find((f) => f.label.toLowerCase() === name.toLowerCase());
  if (builtIn) return true;

  if (!requested.has(name)) {
    requested.add(name);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = googleFontHref(name);
    document.head.appendChild(link);
  }

  // document.fonts.load resolves once the face is fetched (or immediately if
  // there is nothing to fetch), after which check() tells us the truth.
  try {
    await (document as any).fonts?.load?.(`16px "${name}"`);
    return Boolean((document as any).fonts?.check?.(`16px "${name}"`));
  } catch {
    return false;
  }
}
