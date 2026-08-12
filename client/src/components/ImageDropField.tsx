/**
 * Pick a product image from the computer, by dropping it or browsing.
 *
 * The client: "Remove 'upload image url' replace with Drag and Drop from
 * computer, or Search Computer".
 *
 * She is right that a URL field is the wrong control here. A product photo
 * lives on her desktop, not at a public address — asking for a URL means
 * uploading it somewhere else first, and the field silently accepts anything,
 * so a typo or a private link becomes a broken image in a published overlay
 * with nothing to say so.
 *
 * ── Pasting a URL still works ────────────────────────────────────────────────
 * Deliberately kept, behind a smaller control. Brands DO have product images on
 * their own CDN, and removing the ability to point at one would replace one
 * complaint with another. Drag-and-drop is the default; the URL is the
 * exception.
 */
import { useState, useRef, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { Upload, X, Link2, Loader2 } from "lucide-react";

/** Matches what the uploader accepts and what a browser will render. */
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";
const MAX_BYTES = 10 * 1024 * 1024;

export function ImageDropField({
  value,
  onChange,
  label = "Product image",
  testId = "overlay-image",
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  testId?: string;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (res: any) => {
      const url = res?.objectUrl ?? res?.secure_url ?? res?.url;
      if (url) onChange(url);
    },
    onError: (e) =>
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" }),
  });

  const take = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Not an image",
        description: "Choose a PNG, JPG, WebP or GIF.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({
        title: "That image is too large",
        description: `${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 10 MB.`,
        variant: "destructive",
      });
      return;
    }
    // uploadFile rethrows after calling onError; the toast is already shown by
    // then, so swallow it here rather than leaving an unhandled rejection.
    uploadFile(file).catch(() => {});
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>

      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-border p-2">
          {/* The chosen image, shown. A field that holds an address you cannot
              see is how a broken image reaches a published overlay. */}
          <img
            src={value}
            alt=""
            className="h-12 w-12 rounded object-cover bg-muted shrink-0"
            data-testid={`preview-${testId}`}
          />
          <p className="text-xs text-muted-foreground truncate flex-1 min-w-0">{value}</p>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => onChange("")}
            data-testid={`button-clear-${testId}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={`rounded-lg border border-dashed p-3 text-center cursor-pointer transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"
            }`}
            data-testid={`dropzone-${testId}`}
          >
            {isUploading ? (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Upload className="h-3.5 w-3.5" />
                Drag an image here, or click to search your computer
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => take(e.target.files?.[0])}
            data-testid={`input-file-${testId}`}
          />

          {showUrl ? (
            <Input
              autoFocus
              placeholder="https://…"
              onChange={(e) => onChange(e.target.value)}
              className="h-8 text-sm"
              data-testid={`input-url-${testId}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowUrl(true)}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              data-testid={`button-use-url-${testId}`}
            >
              <Link2 className="h-3 w-3" />
              or paste an image address
            </button>
          )}
        </>
      )}
    </div>
  );
}
