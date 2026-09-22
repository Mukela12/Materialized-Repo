/**
 * What happens when Bunny finishes (or fails) transcoding a video.
 *
 * ── The webhook body is a hint, not a fact ───────────────────────────────────
 * Bunny's webhook carries {VideoGuid, Status} but is not signed — anyone who
 * learns the URL could post one. The shared token in the URL gates the route,
 * and belt-and-braces: the handler treats the payload as nothing more than
 * "look at this guid" and fetches the video's ACTUAL state from the Stream API
 * before touching the database. A forged or replayed body can therefore only
 * make us re-read the truth.
 *
 * ── What "finished" changes ──────────────────────────────────────────────────
 * The row was stored with an optimistic play_720p.mp4 URL at mint time. Now
 * that availableResolutions is a fact, the URL is rewritten to the best MP4
 * that actually exists, and the real thumbnail replaces the guess. Status only
 * moves processing → published: a draft stays a draft (the creator is still
 * editing), and nothing ever un-publishes.
 */
import {
  getBunnyVideo, bestBunnyMp4Url, bunnyThumbnailUrl,
  BUNNY_STATUS_FINISHED, BUNNY_STATUS_FAILED, type BunnyVideo,
} from "./bunnyService";

export interface BunnyWebhookStore {
  findVideoByBunnyGuid(guid: string): Promise<{ id: string; status: string | null } | undefined>;
  updateVideo(id: string, data: Record<string, unknown>): Promise<unknown>;
}

export interface BunnyWebhookApi {
  getVideo(guid: string): Promise<BunnyVideo>;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleBunnyTranscodeEvent(
  store: BunnyWebhookStore,
  api: BunnyWebhookApi = { getVideo: getBunnyVideo },
  payload: { VideoGuid?: unknown },
): Promise<{ action: string }> {
  const guid = typeof payload?.VideoGuid === "string" ? payload.VideoGuid : "";
  if (!GUID.test(guid)) return { action: "ignored: no valid guid" };

  const row = await store.findVideoByBunnyGuid(guid);
  if (!row) return { action: `ignored: no video row for ${guid}` };

  const video = await api.getVideo(guid);

  if (BUNNY_STATUS_FAILED.has(video.status)) {
    // The file is dead; the record says so rather than pointing at a 404.
    await store.updateVideo(row.id, { status: "archived" });
    return { action: `failed: transcode error for ${guid}, row archived` };
  }

  if (video.status !== BUNNY_STATUS_FINISHED) {
    return { action: `ignored: status ${video.status} for ${guid}, not finished` };
  }

  const mp4 = bestBunnyMp4Url(video);
  if (!mp4) {
    // Finished but no MP4 rendition — nothing our player can serve.
    await store.updateVideo(row.id, { status: "archived" });
    return { action: `failed: no MP4 rendition for ${guid}, row archived` };
  }

  const patch: Record<string, unknown> = {
    videoUrl: mp4,
    thumbnailUrl: bunnyThumbnailUrl(guid, video.thumbnailFileName),
  };
  // Only the transcode-wait state promotes. Draft means a person is editing.
  if (row.status === "processing") patch.status = "published";
  await store.updateVideo(row.id, patch);
  return { action: `finalised ${guid}: ${mp4.split("/").pop()}${patch.status ? ", published" : ""}` };
}
