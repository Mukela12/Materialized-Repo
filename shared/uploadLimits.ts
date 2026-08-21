/**
 * How large a video may be.
 *
 * ── Why this is a shared constant and not a number in the copy ───────────────
 * The upload box advertised "up to 500MB" while the Cloudinary account is on
 * the Free plan, which refuses videos over 100MB. So the product promised five
 * times what the infrastructure accepts, and the client discovered it by
 * dragging a 469MB editorial in and watching nothing happen.
 *
 * The limit belongs to the PLAN, not to the app. When the account is upgraded
 * this is the one line to change, and the box, the pre-check and the error all
 * follow.
 */

/** 100 MiB — the Cloudinary Free plan's video ceiling. */
export const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;

/** As shown to a person: "100MB". */
export const MAX_VIDEO_UPLOAD_LABEL = `${Math.round(MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024))}MB`;

/** Human file size, for telling somebody how far over they are. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/** Null when acceptable; otherwise the sentence to show the user. */
export function videoTooLargeMessage(bytes: number): string | null {
  if (bytes <= MAX_VIDEO_UPLOAD_BYTES) return null;
  return `That video is ${formatBytes(bytes)}. The limit is ${MAX_VIDEO_UPLOAD_LABEL}, so it would be rejected before it finished uploading.`;
}
