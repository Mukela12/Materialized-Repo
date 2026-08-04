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

/** Fonts guaranteed to render: in the index.html Google Fonts link, or a local @font-face. */
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

const BUILT_IN_BY_VALUE = new Map<string, { value: string; label: string; stack: string }>(
  BUILT_IN_FONTS.map((f) => [f.value, f]),
);

/**
 * Resolve a stored font setting to a CSS font-family stack.
 *
 * Falls back to the system stack for an unknown value, as before — but the
 * picker no longer offers values that land here, and a custom name is loaded by
 * ensureGoogleFont before being used.
 */
export function fontStack(value: string | undefined | null): string {
  if (!value) return BUILT_IN_BY_VALUE.get("system")!.stack;
  const builtIn = BUILT_IN_BY_VALUE.get(value);
  if (builtIn) return builtIn.stack;
  // A custom (Google) font is stored by its display name.
  return `'${value.replace(/'/g, "")}', sans-serif`;
}

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
