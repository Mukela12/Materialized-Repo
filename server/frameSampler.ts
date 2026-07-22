import { cloudinary, isCloudinaryConfigured } from "./cloudinaryService";

/**
 * Server-side frame sampling for vision analysis — no ffmpeg.
 *
 * Videos are stored on Cloudinary but the DB only persists `videoUrl` (the
 * `secure_url`), never the `publicId`. So we parse the publicId out of the URL
 * and ask Cloudinary to render still-frame JPEGs at spread timestamps via URL
 * transformations (`so_<sec>` + `.jpg`), the same mechanism `getVideoThumbnailUrl`
 * already relies on.
 *
 * Everything here is resilient by design: a missing/short/non-Cloudinary video,
 * an unconfigured Cloudinary account, or a per-frame fetch failure all degrade to
 * fewer (or zero) frames rather than throwing, so the caller can fall back to the
 * metadata-only detection path.
 */

export interface SampledFrame {
  url: string;
  base64?: string;
  mimeType: "image/jpeg";
  timestamp: number;
}

export interface SampleFramesOptions {
  /** How many frames to sample (default 4, capped by duration). */
  count?: number;
  /** Known video duration in seconds (from videos.durationSeconds). */
  durationSeconds?: number | null;
  /** Frame width for the rendered JPEG (default 640). */
  width?: number;
  /** Fetch each frame and attach base64 (default true — the vision path needs it). */
  asBase64?: boolean;
}

interface ParsedCloudinaryVideo {
  publicId: string;
  cloudName: string;
}

const TRANSFORM_KEY = /(^|,)(so|eo|du|w|h|c|q|f|e|g|l|b|ar|dpr|fl|r|o|co|a|x|y|z|vc|ac|br|fps|sp)_/;

/**
 * Parse the Cloudinary publicId (folder path + name, without extension) out of a
 * stored `secure_url`. Returns null for anything that isn't a Cloudinary video URL.
 *
 * Canonical shape:
 *   https://res.cloudinary.com/<cloud>/video/upload/[<transforms>/][v<NNN>/]<folder>/<name>.<ext>
 */
export function parseCloudinaryVideoUrl(input: string): ParsedCloudinaryVideo | null {
  if (!input || typeof input !== "string") return null;

  // Bare publicId (no scheme) — trust it as-is.
  if (!input.includes("://")) {
    return { publicId: input.replace(/\.[a-z0-9]+$/i, ""), cloudName: "" };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.hostname !== "res.cloudinary.com") return null;

  // Path: /<cloud>/video/upload/<...rest>
  const segments = url.pathname.split("/").filter(Boolean);
  const cloudName = segments[0];
  const resourceType = segments[1];
  const deliveryType = segments[2];

  if (resourceType !== "video" || deliveryType !== "upload") return null;

  let rest = segments.slice(3);
  if (rest.length === 0) return null;

  // Drop a leading transformation segment (comma-joined transform keys).
  if (rest.length > 1 && TRANSFORM_KEY.test(rest[0])) {
    rest = rest.slice(1);
  }

  // Drop a version segment (v1, v1700000000, ...).
  if (rest.length > 1 && /^v\d+$/.test(rest[0])) {
    rest = rest.slice(1);
  }

  if (rest.length === 0) return null;

  // Strip the trailing extension off the final segment.
  const last = rest[rest.length - 1].replace(/\.[a-z0-9]+$/i, "");
  const publicId = [...rest.slice(0, -1), last].join("/");

  if (!publicId) return null;
  return { publicId, cloudName };
}

/**
 * Compute K spread timestamps at the midpoints of K equal buckets, avoiding the
 * black intro/outro frames you'd get sampling at exactly 0 and duration.
 * Handles unknown/short/zero durations gracefully.
 */
export function computeSampleTimestamps(durationSeconds: number | null | undefined, count: number): number[] {
  const k = Math.max(1, Math.floor(count));

  // Unknown or non-positive duration — sample a single safe frame at t=0.
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [0];
  }

  // Very short video — sample at integer seconds, at most floor(duration) frames.
  if (durationSeconds < k) {
    const n = Math.max(1, Math.floor(durationSeconds));
    const secs = Array.from({ length: n }, (_, i) => i);
    return Array.from(new Set(secs));
  }

  const upper = Math.max(0, durationSeconds - 0.1);
  const timestamps: number[] = [];
  for (let i = 0; i < k; i++) {
    const t = ((i + 0.5) / k) * durationSeconds;
    const clamped = Math.min(upper, Math.max(0, t));
    timestamps.push(Math.round(clamped * 10) / 10);
  }
  return Array.from(new Set(timestamps));
}

/**
 * Sample K still frames from a stored Cloudinary video.
 *
 * @param videoUrlOrPublicId  The stored `secure_url` or a bare publicId.
 * @returns Frames with a JPEG URL (and base64 when `asBase64`), or `[]` in any
 *          degraded case (unconfigured Cloudinary, non-Cloudinary URL, all fetches
 *          failing). Never throws.
 */
export async function sampleVideoFrames(
  videoUrlOrPublicId: string,
  opts: SampleFramesOptions = {}
): Promise<SampledFrame[]> {
  const { count = 4, durationSeconds = null, width = 640, asBase64 = true } = opts;

  // Bare publicId is usable without Cloudinary credentials for URL building, but a
  // stored URL path still requires a configured account to sign/deliver frames.
  if (!isCloudinaryConfigured()) return [];

  const parsed = parseCloudinaryVideoUrl(videoUrlOrPublicId);
  if (!parsed) return [];

  const timestamps = computeSampleTimestamps(durationSeconds, count);

  const frames: SampledFrame[] = timestamps.map((t) => ({
    url: cloudinary.url(parsed.publicId, {
      resource_type: "video",
      format: "jpg",
      secure: true,
      start_offset: String(t),
      width,
      crop: "scale",
      quality: "auto",
    }),
    mimeType: "image/jpeg" as const,
    timestamp: t,
  }));

  if (!asBase64) return frames;

  // Fetch each frame; skip any that fail rather than failing the whole job.
  const settled = await Promise.allSettled(
    frames.map(async (frame) => {
      const res = await fetch(frame.url);
      if (!res.ok) throw new Error(`Frame fetch failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { ...frame, base64: buf.toString("base64") };
    })
  );

  const fetched: SampledFrame[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value.base64) {
      fetched.push(result.value);
    }
  }

  return fetched;
}
