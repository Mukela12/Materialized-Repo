/**
 * The frame a carousel preview is drawn in.
 *
 * ── The bug this exists for ──────────────────────────────────────────────────
 * The client, verbatim: "the Preview Video was always 5X larger than the screen
 * display, and it was impossible to see how the Product Carousel was positioned
 * because the preview was not clearly visible."
 *
 * Two causes, and the second is the one that mattered.
 *
 *   THE VIDEO WAS BLOWN UP. The box was a fixed 16:9 and the video was
 *   `object-cover`. A 9:16 phone video inside a 16:9 box has to scale about
 *   3.2x to cover it, and the top and bottom are then cropped away.
 *
 *   THE CAROUSEL WAS POSITIONED AGAINST THE WRONG RECTANGLE. It was placed
 *   against the 16:9 container, not against the part of it the video actually
 *   occupied. So "bottom" was drawn at the bottom of a box whose lower third
 *   held no video, and the preview could not answer the only question anyone
 *   opens it to ask.
 *
 * The frame now takes the video's real aspect ratio, so the container IS the
 * video. Position is then exact by construction rather than by correction.
 *
 * The zoom control is the client's request, kept because a vertical video
 * shrunk to fit a wide panel is legible but small, and judging a corner
 * placement sometimes wants a closer look.
 */
import { useState, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { videoDeliveryUrl } from "@shared/videoDelivery";

/** 16:9, used until the real video reports its dimensions. */
const DEFAULT_ASPECT = 16 / 9;

const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

export function CarouselPreviewFrame({
  videoUrl,
  children,
  /** Cap on how tall the frame may get. A 9:16 video is otherwise enormous. */
  maxHeight = 420,
  emptyLabel = "Video preview",
  testId,
}: {
  videoUrl?: string | null;
  /** The carousel overlay. Positioned against this frame, which is the video. */
  children: ReactNode;
  maxHeight?: number;
  emptyLabel?: string;
  testId?: string;
}) {
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const [loading, setLoading] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const zoom = ZOOM_STEPS[zoomIndex];
  const isVertical = aspect < 1;

  return (
    <div className="space-y-2">
      {/* The scroll container. At zoom 1 nothing overflows; above it the frame
          grows and this is what lets someone pan around it. */}
      <div
        className="relative bg-muted rounded-lg overflow-auto flex items-center justify-center"
        style={{ maxHeight: maxHeight + 8 }}
        data-testid={testId}
      >
        <div
          className="relative shrink-0"
          style={{
            aspectRatio: String(aspect),
            height: maxHeight * zoom,
            // Never wider than the panel at rest, or a 16:9 video overflows
            // horizontally before anyone has asked it to.
            maxWidth: zoom === 1 ? "100%" : undefined,
          }}
        >
          {videoUrl ? (
            <>
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-20">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              )}
              <video
                ref={videoRef}
                src={videoDeliveryUrl(videoUrl, "preview")}
                // contain, not cover — the frame already matches the video's
                // shape, so there is nothing to crop and nothing to scale up.
                className="absolute inset-0 w-full h-full object-contain bg-black rounded-lg"
                autoPlay
                muted
                loop
                playsInline
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
                  setLoading(false);
                }}
                onPlaying={() => setLoading(false)}
              />
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs bg-black/20 rounded-lg">
              {emptyLabel}
            </div>
          )}

          {children}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {videoUrl
            ? `${isVertical ? "Vertical" : "Horizontal"} video, shown at its real shape — the carousel sits exactly where it will on playback.`
            : "Upload a video to see the carousel against it."}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            data-testid="button-preview-zoom-out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs tabular-nums w-8 text-center" data-testid="text-preview-zoom">
            {zoom}×
          </span>
          <Button
            variant="ghost" size="sm"
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            data-testid="button-preview-zoom-in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          {zoom !== 1 && (
            <Button
              variant="ghost" size="sm"
              onClick={() => setZoomIndex(0)}
              data-testid="button-preview-zoom-reset"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
