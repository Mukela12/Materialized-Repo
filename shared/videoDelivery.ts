/**
 * How a video is DELIVERED — as opposed to how it was stored.
 *
 * ── The problem this fixes ───────────────────────────────────────────────────
 * Uploads are stored as originals and, everywhere except the third-party embed,
 * were played back as originals. Measured off the live CDN on 5 Aug 2026, one
 * demo video in the library is 23.74 MB delivered. The same file through
 * `f_auto,q_auto:good,w_1080,c_limit` is 6.15 MB — a quarter of the bytes, for
 * a vertical phone video nobody is watching on a broadcast monitor.
 *
 * That ratio decides whether the product is viable at $0.005 a view. Across the
 * 28 videos in the library the mean is 17.2 MB. Ten thousand views of a video
 * that size is 168 GB, which costs about $37 on Cloudinary's Plus plan against
 * the $50 we charge for those views — a margin thin enough that one heavy
 * uploader erases it, and the heaviest video in the library already costs
 * $50.92 to serve ten thousand times, which is more than we would charge.
 * Through this helper the same ten thousand views cost roughly $9.
 *
 * ── Why a URL in and a URL out ───────────────────────────────────────────────
 * `getOptimizedVideoUrl` in cloudinaryService.ts already built optimised URLs
 * and was called from nowhere, because it takes a publicId while the database
 * stores whole URLs. Two places in the embed path therefore hand-rolled their
 * own `.replace("/upload/", "/upload/q_auto,f_auto,w_720/")` — with different
 * widths, so an embed and a widget of the same video disagreed. This takes what
 * is actually stored.
 *
 * ── Idempotent on purpose ────────────────────────────────────────────────────
 * A URL that already carries a transformation is returned unchanged rather than
 * having a second segment stacked in front of it. Stored URLs, hand-written
 * marketing URLs and already-optimised URLs all pass through the same call
 * sites, and `w_1080/w_640/<file>` is not a URL Cloudinary serves.
 */

/**
 * Transformation keys, per Cloudinary's URL grammar. Used to recognise a
 * segment that is already a transformation rather than a folder called, say,
 * "videos". Kept in sync with the copy in server/frameSampler.ts, which parses
 * the same URLs for a different purpose.
 */
const TRANSFORM_KEY =
  /(^|,)(so|eo|du|w|h|c|q|f|e|g|l|b|ar|dpr|fl|r|o|co|a|x|y|z|vc|ac|br|fps|sp)_/;

export type DeliveryContext = "player" | "embed" | "preview" | "thumbnail";

/**
 * What each surface gets.
 *
 * `q_auto:good` rather than plain `q_auto`: on the vertical fashion footage this
 * product carries, plain q_auto was visibly soft on fabric texture, which is the
 * one thing a viewer is looking at before they buy. `c_limit` only ever shrinks —
 * a 720-wide source is never upscaled to 1080 and made larger than the original.
 */
const PROFILES: Record<DeliveryContext, string> = {
  // In-app playback, full attention, often full-screen on a laptop.
  player: "f_auto,q_auto:good,w_1080,c_limit",
  // Third-party sites. Smaller: it is someone else's page weight, it is usually
  // in a card rather than full-bleed, and it is the surface we least control.
  embed: "f_auto,q_auto:good,w_720,c_limit",
  // The upload preview, seen once while positioning a carousel. It does not need
  // to be beautiful and it should appear immediately.
  preview: "f_auto,q_auto:eco,w_720,c_limit",
  // A still frame, for cards and posters.
  thumbnail: "f_auto,q_auto:good,w_640,c_limit",
};

/** True when this looks like a Cloudinary VIDEO delivery URL we may rewrite. */
function isCloudinaryVideoUrl(url: string): boolean {
  return /^https?:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\//.test(url);
}

/**
 * Return a delivery URL for `context`.
 *
 * Anything that is not a Cloudinary video URL — a blob: preview, an external
 * host, an empty string — comes back untouched. This is deliberately total: it
 * sits directly in `src=` attributes, and a helper that threw or returned
 * undefined there would blank the player rather than degrade to the original.
 */
export function videoDeliveryUrl(
  url: string | null | undefined,
  context: DeliveryContext = "player",
): string {
  if (!url || typeof url !== "string") return url ?? "";
  if (!isCloudinaryVideoUrl(url)) return url;

  const marker = "/video/upload/";
  const at = url.indexOf(marker);
  const head = url.slice(0, at + marker.length);
  const tail = url.slice(at + marker.length);
  if (!tail) return url;

  // Already transformed by whoever wrote the URL — leave their intent alone.
  const firstSegment = tail.split("/")[0] ?? "";
  if (TRANSFORM_KEY.test(firstSegment)) return url;

  return `${head}${PROFILES[context]}/${tail}`;
}

/**
 * A poster still, taken a little way in.
 *
 * `so_1` rather than frame zero because the first frame of a phone video is
 * routinely black or a blurred pan, which makes a whole grid of cards look
 * broken. Only for Cloudinary videos; anything else is returned unchanged so
 * callers can pass a stored thumbnail through without checking.
 */
export function videoPosterUrl(url: string | null | undefined): string {
  if (!url || !isCloudinaryVideoUrl(url)) return url ?? "";
  const marker = "/video/upload/";
  const at = url.indexOf(marker);
  const head = url.slice(0, at + marker.length);
  let tail = url.slice(at + marker.length);
  if (!tail) return url;

  const firstSegment = tail.split("/")[0] ?? "";
  if (TRANSFORM_KEY.test(firstSegment)) tail = tail.split("/").slice(1).join("/");

  return `${head}so_1,${PROFILES.thumbnail}/${tail.replace(/\.[a-z0-9]+$/i, ".jpg")}`;
}
