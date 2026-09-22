import { useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import * as tus from "tus-js-client";

interface UploadResponse {
  objectUrl: string;
  publicId: string;
  thumbnailUrl?: string;
}

interface UseUploadOptions {
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
}

export function useUpload(options: UseUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const uploadFile = useCallback(async (file: File) => {
    setIsUploading(true);
    setProgress(0);
    setError(null);

    try {
      /**
       * Videos go to Bunny Stream over TUS — resumable, so a 1GB editorial on
       * hotel wifi survives a dropped connection instead of starting over.
       * Images keep the Cloudinary path below unchanged.
       */
      if (file.type.startsWith("video/")) {
        const mintRes = await apiRequest("POST", "/api/upload/bunny-video", {
          title: file.name,
          fileSize: file.size,
        });
        const mint = await mintRes.json();

        await new Promise<void>((resolve, reject) => {
          const upload = new tus.Upload(file, {
            endpoint: mint.endpoint,
            headers: mint.headers,
            metadata: { filetype: file.type, title: file.name },
            // Chunked so a resume re-sends one chunk, not the whole file.
            chunkSize: 20 * 1024 * 1024,
            retryDelays: [0, 3000, 10000, 30000],
            onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
            onSuccess: () => resolve(),
            onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
          });
          // If this same file was interrupted mid-upload, carry on from there.
          upload.findPreviousUploads().then((prev) => {
            if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
            upload.start();
          }).catch(() => upload.start());
        });

        const response: UploadResponse = {
          objectUrl: mint.playbackUrl,
          publicId: mint.guid,
          thumbnailUrl: mint.thumbnailUrl,
        };
        setProgress(100);
        options.onSuccess?.(response);
        return response;
      }

      // 1. Get signed upload params from server
      const paramsRes = await apiRequest("POST", "/api/upload/url", {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });
      const params = await paramsRes.json();

      // 2. Upload directly to Cloudinary
      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", params.apiKey);
      formData.append("timestamp", String(params.timestamp));
      formData.append("signature", params.signature);
      formData.append("folder", params.folder);

      const xhr = new XMLHttpRequest();

      const uploadPromise = new Promise<any>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
            return;
          }
          /**
           * Keep the reason. Cloudinary answers a rejected upload with
           * {"error":{"message":"File size too large. Got 469000000. Maximum is
           * 104857600."}} — the one sentence that explains the failure — and
           * this used to discard it in favour of a status code.
           */
          let detail = "";
          try { detail = JSON.parse(xhr.responseText)?.error?.message ?? ""; } catch { /* not JSON */ }
          reject(new Error(detail || `Upload failed with status ${xhr.status}`));
        });

        xhr.addEventListener("error", () => reject(new Error("Upload failed")));
        xhr.open("POST", params.uploadUrl);
        xhr.send(formData);
      });

      const cloudinaryResult = await uploadPromise;

      const response: UploadResponse = {
        objectUrl: cloudinaryResult.secure_url,
        publicId: cloudinaryResult.public_id,
        thumbnailUrl: cloudinaryResult.eager?.[0]?.secure_url,
      };

      setProgress(100);
      options.onSuccess?.(response);
      return response;
    } catch (err) {
      const uploadError = err instanceof Error ? err : new Error("Upload failed");
      setError(uploadError);
      options.onError?.(uploadError);
      throw uploadError;
    } finally {
      setIsUploading(false);
    }
  }, [options]);

  return {
    uploadFile,
    isUploading,
    progress,
    error,
  };
}
