/**
 * Category badge colours.
 *
 * ── Why solid, and why one copy ──────────────────────────────────────────────
 * These badges sit ON TOP OF a video thumbnail. They were `bg-pink-500/15` and
 * friends — fifteen percent opacity — so the thumbnail showed straight through
 * and the label was legible or not depending entirely on what the video
 * happened to look like at that frame. The client, verbatim: "need to be solid
 * background colors as the text/opaque color can become illegible with the
 * thumbnail background."
 *
 * The map existed in FOUR places (VideoCard, library, brand-library,
 * affiliate-library) with the fallback colour already drifting between them —
 * `bg-muted` in two, `bg-muted/50` in the others. One copy now.
 *
 * ON_THUMBNAIL is opaque, with white text and a shadow, because it must survive
 * any frame underneath it. ON_SURFACE keeps the softer tinted look for badges
 * on a solid card background, where there is nothing to show through.
 */

/** Over a video thumbnail. Opaque — the frame underneath is unknown. */
export const CATEGORY_ON_THUMBNAIL: Record<string, string> = {
  fashion:     "bg-pink-600 text-white",
  travel:      "bg-blue-600 text-white",
  skincare:    "bg-violet-600 text-white",
  cuisine_bev: "bg-orange-600 text-white",
  health:      "bg-green-700 text-white",
  eco:         "bg-emerald-700 text-white",
  interiors:   "bg-stone-600 text-white",
};

/** Over a card surface, where the tint reads fine. */
export const CATEGORY_ON_SURFACE: Record<string, string> = {
  fashion:     "bg-pink-500/15 text-pink-600",
  travel:      "bg-blue-500/15 text-blue-600",
  skincare:    "bg-violet-500/15 text-violet-600",
  cuisine_bev: "bg-orange-500/15 text-orange-600",
  health:      "bg-green-500/15 text-green-600",
  eco:         "bg-emerald-500/15 text-emerald-600",
  interiors:   "bg-stone-500/15 text-stone-600",
};

export const CATEGORY_FALLBACK_ON_THUMBNAIL = "bg-neutral-700 text-white";
export const CATEGORY_FALLBACK_ON_SURFACE = "bg-muted text-muted-foreground";

/** Badge classes for a category shown over a thumbnail. */
export function categoryBadgeOnThumbnail(category: string | null | undefined): string {
  const key = (category ?? "").toLowerCase();
  return CATEGORY_ON_THUMBNAIL[key] ?? CATEGORY_FALLBACK_ON_THUMBNAIL;
}

/**
 * The selection checkbox, which has the same problem: a white outline icon on
 * an unknown frame. A dark opaque chip behind it makes it readable on anything.
 */
export const SELECTION_CHIP =
  "flex items-center justify-center h-6 w-6 rounded-md bg-black/70 backdrop-blur-sm ring-1 ring-white/20";
