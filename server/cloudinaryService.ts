import { v2 as cloudinary } from "cloudinary";

// Configure Cloudinary from env vars
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export interface UploadResult {
  publicId: string;
  secureUrl: string;
  format: string;
  width?: number;
  height?: number;
  bytes: number;
  duration?: number;
  thumbnailUrl?: string;
}

/**
 * Upload a video file to Cloudinary.
 * Accepts a file path, buffer, or data URI.
 */
export async function uploadVideo(
  file: string | Buffer,
  options?: { folder?: string; publicId?: string }
): Promise<UploadResult> {
  const result = await cloudinary.uploader.upload(
    typeof file === "string" ? file : `data:video/mp4;base64,${file.toString("base64")}`,
    {
      resource_type: "video",
      folder: options?.folder || "materialized/videos",
      public_id: options?.publicId,
      transformation: [{ quality: "auto", fetch_format: "auto" }],
      eager: [
        { width: 640, height: 360, crop: "fill", format: "jpg" }, // thumbnail
      ],
      eager_async: true,
    }
  );

  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
    format: result.format,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    duration: result.duration,
    thumbnailUrl: result.eager?.[0]?.secure_url,
  };
}

/**
 * Upload an image to Cloudinary.
 */
export async function uploadImage(
  file: string | Buffer,
  options?: { folder?: string; publicId?: string }
): Promise<UploadResult> {
  const result = await cloudinary.uploader.upload(
    typeof file === "string" ? file : `data:image/png;base64,${file.toString("base64")}`,
    {
      resource_type: "image",
      folder: options?.folder || "materialized/images",
      public_id: options?.publicId,
      transformation: [{ quality: "auto", fetch_format: "auto" }],
    }
  );

  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
    format: result.format,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
  };
}

/**
 * Generate a signed upload URL for client-side uploads.
 */
export function generateSignedUploadParams(options?: {
  folder?: string;
  resourceType?: "image" | "video";
  maxFileSize?: number;
}) {
  const timestamp = Math.round(Date.now() / 1000);
  const folder = options?.folder || "materialized/uploads";

  const params: Record<string, any> = {
    timestamp,
    folder,
  };

  /**
   * FAIL HERE, LOUDLY, RATHER THAN IN THE BROWSER.
   *
   * These were read with `!` and interpolated straight into the upload URL. With
   * the variables unset the function happily returned an upload URL reading
   *   https://api.cloudinary.com/v1_1/undefined/image/upload
   * and a signature computed from a missing secret. The browser then posted a
   * file to a host that does not exist and reported the only thing it knew:
   * "Load failed" in Safari, "Failed to fetch" in Chrome — with nothing in the
   * server log, because as far as the server was concerned it had succeeded.
   *
   * A misconfigured deploy is now a 500 naming the missing variable.
   */
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  const missing = [
    !cloudName && "CLOUDINARY_CLOUD_NAME",
    !apiKey && "CLOUDINARY_API_KEY",
    !apiSecret && "CLOUDINARY_API_SECRET",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Cloudinary is not configured — missing ${missing.join(", ")}`);
  }

  const signature = cloudinary.utils.api_sign_request(params, apiSecret!);

  return {
    signature,
    timestamp,
    folder,
    cloudName: cloudName!,
    apiKey: apiKey!,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${options?.resourceType || "auto"}/upload`,
  };
}

/**
 * Delete a resource from Cloudinary.
 */
export async function deleteResource(publicId: string, resourceType: "image" | "video" = "image"): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

/**
 * Get optimized video URL with transformations.
 */
export function getOptimizedVideoUrl(publicId: string, options?: {
  width?: number;
  quality?: string;
  format?: string;
}): string {
  return cloudinary.url(publicId, {
    resource_type: "video",
    secure: true,
    transformation: [
      {
        width: options?.width,
        quality: options?.quality || "auto",
        fetch_format: options?.format || "auto",
      },
    ],
  });
}

/**
 * Get video thumbnail URL.
 */
export function getVideoThumbnailUrl(publicId: string, options?: {
  width?: number;
  height?: number;
  startOffset?: string;
}): string {
  return cloudinary.url(publicId, {
    resource_type: "video",
    secure: true,
    format: "jpg",
    transformation: [
      {
        width: options?.width || 640,
        height: options?.height || 360,
        crop: "fill",
        start_offset: options?.startOffset || "0",
      },
    ],
  });
}

export function isCloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

export { cloudinary };

/**
 * Store a font file.
 *
 * `resource_type: "raw"` because Cloudinary's image and video pipelines would
 * try to transform it. A font must be delivered byte-for-byte or the browser
 * rejects it, so no transformation is requested anywhere in this call.
 *
 * The caller has ALREADY verified the bytes are a font (sniffFontFormat) — this
 * function does not re-check, and must never be reached with unverified input.
 */
export async function uploadFont(
  file: Buffer,
  options: { mime: string; ext: string; publicId?: string },
): Promise<UploadResult> {
  const result = await cloudinary.uploader.upload(
    `data:${options.mime};base64,${file.toString("base64")}`,
    {
      resource_type: "raw",
      folder: "materialized/fonts",
      public_id: options.publicId,
      // Part of the stored name, so the URL ends in a real font extension.
      // Some CDNs and proxies sniff that, and a font served as .bin is refused
      // by more of them than is worth arguing with.
      format: options.ext.replace(/^\./, ""),
    },
  );
  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
    format: result.format,
    bytes: result.bytes,
  } as UploadResult;
}
