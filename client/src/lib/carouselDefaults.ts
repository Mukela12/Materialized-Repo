/**
 * The one definition of the default product-carousel button colours.
 *
 * WHY A SHARED CONSTANT AND NOT A LITERAL
 *   The green #314d3b was hardcoded in five places — ProductCarouselEditor's
 *   defaultSettings, brand-kit's useState initialiser, brand-kit's `||` fallback
 *   when hydrating a saved kit, and two more copies in VideoProductCarousel /
 *   VideoPlayerWithCarousel. When the client asked for green to stop meaning
 *   "act here", a file-by-file sweep changed the app chrome and left every one
 *   of these behind, so a creator opening the upload modal still met a green
 *   BUY NOW. Five literals cannot be changed together; one constant can.
 *
 * WHY #1351aa
 *   It is the MTRLZD accent — the same value as --primary in index.css and the
 *   landing page CTA. Green is reserved for "published" and other success
 *   states, where it means done rather than act here.
 *
 * THIS IS ONLY A DEFAULT
 *   It is what a brand sees before choosing anything. A saved brand kit, or a
 *   per-video override, wins over it everywhere it is used.
 */
export const CAROUSEL_DEFAULT_BUTTON_COLOR = "#1351aa";
export const CAROUSEL_DEFAULT_BUTTON_TEXT_COLOR = "#FFFFFF";
