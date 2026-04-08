import { useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

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
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
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
