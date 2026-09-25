/**
 * Bunny Stream: where video lives after the Cloudinary Free plan's 100MB
 * ceiling stopped fitting the product (a 469MB editorial could not upload).
 *
 * ── Two keys, deliberately separated ─────────────────────────────────────────
 * BUNNY_API_KEY is the ACCOUNT key (api.bunny.net) — it can create and delete
 * whole libraries, and nothing in the request path needs that power, so this
 * module never reads it. BUNNY_STREAM_API_KEY is the library-scoped key
 * (video.bunnycdn.com); the worst it can do is touch videos in the one library.
 *
 * ── Browser uploads go DIRECT to Bunny via TUS ───────────────────────────────
 * The server mints a video object and a short-lived signature; the browser
 * then speaks TUS (resumable) straight to Bunny. A 1GB editorial on hotel
 * wifi survives a dropped connection, the backend never proxies the bytes,
 * and the signature only authorizes the one video id it was minted for.
 *
 * ── Upload ≠ playable ────────────────────────────────────────────────────────
 * Bunny transcodes after upload. The stored playback URL is not live until the
 * library webhook says Finished, which is when webhookHandlers picks the best
 * MP4 rendition that actually exists — never guessed in advance, because
 * play_720p.mp4 only exists for sources at least that tall.
 */
import { createHash } from "node:crypto";

const STREAM_API = "https://video.bunnycdn.com";
export const BUNNY_TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";

function libraryId(): string {
  return process.env.BUNNY_LIBRARY_ID || "";
}
function streamKey(): string {
  return process.env.BUNNY_STREAM_API_KEY || "";
}
export function bunnyStreamHost(): string {
  return process.env.BUNNY_STREAM_HOST || "";
}

/** All three env vars, or the feature does not exist — no partial modes. */
export function bunnyConfigured(): boolean {
  return !!(libraryId() && streamKey() && bunnyStreamHost());
}

export interface BunnyVideo {
  guid: string;
  status: number;
  availableResolutions: string | null;
  thumbnailFileName: string | null;
  length: number;
}

/** Bunny's video.status meaning "transcode complete, playable". */
export const BUNNY_STATUS_FINISHED = 4;
/** Statuses that mean the file is dead: transcode or upload failed. */
export const BUNNY_STATUS_FAILED = new Set([5, 6]);

export async function createBunnyVideo(title: string): Promise<{ guid: string }> {
  const res = await fetch(`${STREAM_API}/library/${libraryId()}/videos`, {
    method: "POST",
    headers: { AccessKey: streamKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Bunny video create failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { guid: body.guid };
}

export async function getBunnyVideo(guid: string): Promise<BunnyVideo> {
  const res = await fetch(`${STREAM_API}/library/${libraryId()}/videos/${guid}`, {
    headers: { AccessKey: streamKey() },
  });
  if (!res.ok) throw new Error(`Bunny video fetch failed: ${res.status}`);
  return await res.json();
}

/**
 * The TUS presigned authorization, per Bunny's contract:
 * sha256_hex(library_id + api_key + expiration_unix_seconds + video_guid).
 *
 * Scoped twice over: it expires, and it only opens the single video object the
 * server just minted for this authenticated user — a leaked signature cannot
 * write anyone else's video or mint new ones.
 */
export function bunnyTusAuth(videoGuid: string, opts: { now?: () => Date; ttlSeconds?: number } = {}) {
  const now = (opts.now ?? (() => new Date()))();
  const expire = Math.floor(now.getTime() / 1000) + (opts.ttlSeconds ?? 6 * 60 * 60);
  const signature = createHash("sha256")
    .update(`${libraryId()}${streamKey()}${expire}${videoGuid}`)
    .digest("hex");
  return {
    endpoint: BUNNY_TUS_ENDPOINT,
    headers: {
      AuthorizationSignature: signature,
      // A string because it travels as an HTTP header verbatim.
      AuthorizationExpire: String(expire),
      VideoId: videoGuid,
      LibraryId: libraryId(),
    },
  };
}

/** The MP4-fallback rendition ladder, best first. Bunny caps fallback at 720p. */
const MP4_LADDER = ["720p", "480p", "360p", "240p"] as const;

/**
 * The best MP4 URL that actually exists for this video, from Bunny's own
 * availableResolutions (e.g. "360p,720p") — never assumed. Null means no MP4
 * rendition exists, which is a video we must not publish a player URL for.
 */
export function bestBunnyMp4Url(video: Pick<BunnyVideo, "guid" | "availableResolutions">): string | null {
  const have = new Set(
    (video.availableResolutions ?? "").split(",").map(s => s.trim()).filter(Boolean),
  );
  for (const res of MP4_LADDER) {
    if (have.has(res)) return `https://${bunnyStreamHost()}/${video.guid}/play_${res}.mp4`;
  }
  return null;
}

export function bunnyThumbnailUrl(guid: string, thumbnailFileName?: string | null): string {
  return `https://${bunnyStreamHost()}/${guid}/${thumbnailFileName || "thumbnail.jpg"}`;
}

/** The guid inside one of our Bunny delivery URLs, or null for any other URL. */
export function bunnyGuidFromUrl(url: string | null | undefined): string | null {
  const m = (url ?? "").match(/^https?:\/\/vz-[^/]+\.b-cdn\.net\/([0-9a-f-]{36})\//i);
  return m ? m[1] : null;
}

/**
 * What "publish" may mean for this video right now. A Bunny video that has not
 * finished transcoding publishes as "processing" — the webhook completes the
 * promotion — because a published player pointing at a rendition that does not
 * exist yet is a broken page with the creator's name on it. Anything that is
 * not a Bunny URL (legacy Cloudinary, external) publishes immediately, and if
 * Bunny cannot be reached we publish optimistically: a rare brief 404 beats a
 * video stuck unpublishable by an outage, since no webhook would ever rescue it.
 */
export async function bunnyPublishGate(videoUrl: string | null | undefined): Promise<"published" | "processing"> {
  const guid = bunnyGuidFromUrl(videoUrl);
  if (!guid) return "published";
  try {
    const video = await getBunnyVideo(guid);
    return video.status === BUNNY_STATUS_FINISHED ? "published" : "processing";
  } catch (err) {
    console.warn(`[Bunny] publish gate could not check ${guid}, publishing optimistically:`, err);
    return "published";
  }
}

export async function deleteBunnyVideo(guid: string): Promise<void> {
  const res = await fetch(`${STREAM_API}/library/${libraryId()}/videos/${guid}`, {
    method: "DELETE",
    headers: { AccessKey: streamKey() },
  });
  // 404 is success for a delete: the file is gone, which is what was asked.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Bunny video delete failed: ${res.status}`);
  }
}
