/**
 * Where the carousel sits on the video.
 *
 * ── Why this is shared ───────────────────────────────────────────────────────
 * There were two previews of the same thing and they disagreed. The upload
 * editor implemented all eight positions; the Brand Kit preview implemented two
 * — `items-start` for "top" and `items-end` for everything else — so choosing
 * "bottom-right" there drew the carousel bottom-centre. The setting saved
 * correctly and the preview lied about it, which is worse than not having a
 * preview: the client reported that the positioning options did not exist,
 * because the only way she had to check said they did nothing.
 *
 * One function now answers "where does it go", and every preview and player
 * calls it.
 */
import type { CAROUSEL_POSITION_OPTIONS } from "@shared/schema";

export type CarouselPosition = (typeof CAROUSEL_POSITION_OPTIONS)[number];

/**
 * Absolute-positioning styles for a carousel at `position`, nudged by the
 * per-video offsets.
 *
 * Offsets push the carousel AWAY from the edge it is anchored to, whichever
 * edge that is — so a positive Y moves a top-anchored carousel down and a
 * bottom-anchored one up. Adding the offset to both would make the control
 * feel inverted on half the positions.
 */
export function carouselPositionStyles(
  position: CarouselPosition | string,
  offsetX = 0,
  offsetY = 0,
): React.CSSProperties {
  const base: React.CSSProperties = { position: "absolute", zIndex: 10 };
  const top = `${8 + offsetY}px`;
  const bottom = `${8 - offsetY}px`;
  const left = `${8 + offsetX}px`;
  const right = `${8 - offsetX}px`;

  switch (position) {
    case "top":          return { ...base, top, left: "50%", transform: "translateX(-50%)" };
    case "bottom":       return { ...base, bottom, left: "50%", transform: "translateX(-50%)" };
    case "left":         return { ...base, left, top: "50%", transform: "translateY(-50%)" };
    case "right":        return { ...base, right, top: "50%", transform: "translateY(-50%)" };
    case "top-left":     return { ...base, top, left };
    case "top-right":    return { ...base, top, right };
    case "bottom-left":  return { ...base, bottom, left };
    case "bottom-right": return { ...base, bottom, right };
    default:             return { ...base, bottom, left: "50%", transform: "translateX(-50%)" };
  }
}

/**
 * Does this position lay products out side by side, or stack them?
 *
 * The client's rule: anchored to the bottom (or top) there is width to spare,
 * so several products sit next to each other; anchored to a side there is not,
 * so they stack. A side-by-side row pinned to the left edge would run across
 * the whole video and cover it.
 */
export function isStackedPosition(position: CarouselPosition | string): boolean {
  return position === "left" || position === "right";
}
