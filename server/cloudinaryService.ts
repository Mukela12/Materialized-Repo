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

  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET!);

  return {
    signature,
    timestamp,
    folder,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${options?.resourceType || "auto"}/upload`,
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
