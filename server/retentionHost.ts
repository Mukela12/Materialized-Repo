/**
 * Where a stored video's bytes actually live, for the retention sweep.
 *
 * The library spans two hosts since the September 2026 migration: everything
 * uploaded from now lives on Bunny, and Cloudinary keeps the pre-migration
 * originals (deliberately, as the rollback path). Each URL names its host, so
 * deletion routes by URL — and a URL neither host owns THROWS rather than
 * being silently "deleted": the row stays unstamped and loud in the failure
 * list, instead of marked reclaimed while the file sits somewhere costing
 * money.
 */
import { bunnyGuidFromUrl, deleteBunnyVideo } from "./bunnyService";
import { parseCloudinaryVideoUrl } from "./frameSampler";

export interface RetentionHostDeps {
  deleteFromBunny(guid: string): Promise<void>;
  deleteFromCloudinary(publicId: string): Promise<void>;
  parseCloudinary(url: string): { publicId: string } | null;
}

export function makeMediaHost(deps: RetentionHostDeps) {
  return {
    async deleteVideo(videoUrl: string): Promise<void> {
      const guid = bunnyGuidFromUrl(videoUrl);
      if (guid) return deps.deleteFromBunny(guid);
      const parsed = deps.parseCloudinary(videoUrl);
      if (parsed) return deps.deleteFromCloudinary(parsed.publicId);
      throw new Error(`no host owns this video URL: ${videoUrl}`);
    },
  };
}

/** The production wiring. */
export const mediaHost = makeMediaHost({
  deleteFromBunny: deleteBunnyVideo,
  deleteFromCloudinary: async (publicId) => {
    const { deleteResource } = await import("./cloudinaryService");
    await deleteResource(publicId, "video");
  },
  parseCloudinary: (url) => parseCloudinaryVideoUrl(url),
});
