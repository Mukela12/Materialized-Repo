import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Loader2,
  Wand2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { VideoProductCarousel, type CarouselConfig, type DetectedProduct } from "./VideoProductCarousel";
import type { Video, VideoDetectionJob, VideoCarouselOverride, BrandKit, VideoProductOverlay } from "@shared/schema";

interface VideoPlayerWithCarouselProps {
  video: Video;
  className?: string;
  autoPlay?: boolean;
}

interface CarouselApiData {
  products: DetectedProduct[];
  override?: {
    position?: string;
    positionOffsetX?: number;
    positionOffsetY?: number;
    cornerRadius?: number;
    backgroundOpacity?: number;
    showThumbnail?: boolean;
    showButton?: boolean;
    showPrice?: boolean;
    showTitle?: boolean;
    buttonLabel?: string;
    buttonFont?: string;
    buttonColor?: string;
    buttonTextColor?: string;
  };
}

interface BrandKitData {
  defaultPosition?: string;
  defaultCornerRadius?: number;
  defaultBackgroundOpacity?: number;
  defaultShowThumbnail?: boolean;
  defaultShowButton?: boolean;
  defaultShowPrice?: boolean;
  defaultShowTitle?: boolean;
  defaultButtonLabel?: string;
  defaultButtonFont?: string;
  defaultButtonColor?: string;
  defaultButtonTextColor?: string;
}

interface DetectionStatus {
  job: VideoDetectionJob | null;
  results: DetectedProduct[];
}

const defaultCarouselConfig: CarouselConfig = {
  position: "bottom",
  positionOffsetX: 0,
  positionOffsetY: 0,
  cornerRadius: 16,
  backgroundOpacity: 55,
  showThumbnail: true,
  showButton: true,
  showPrice: true,
  showTitle: true,
  buttonLabel: "BUY NOW",
  buttonColor: "#677A67",
  buttonTextColor: "#FFFFFF",
};

function mergeCarouselConfig(
  base: CarouselConfig,
  brandKit?: BrandKitData,
  override?: CarouselApiData["override"]
): CarouselConfig {
  const merged = { ...base };
  
  if (brandKit) {
    if (brandKit.defaultPosition) merged.position = brandKit.defaultPosition as CarouselConfig["position"];
    if (brandKit.defaultCornerRadius !== undefined) merged.cornerRadius = brandKit.defaultCornerRadius;
    if (brandKit.defaultBackgroundOpacity !== undefined) merged.backgroundOpacity = brandKit.defaultBackgroundOpacity;
    if (brandKit.defaultShowThumbnail !== undefined) merged.showThumbnail = brandKit.defaultShowThumbnail;
    if (brandKit.defaultShowButton !== undefined) merged.showButton = brandKit.defaultShowButton;
    if (brandKit.defaultShowPrice !== undefined) merged.showPrice = brandKit.defaultShowPrice;
    if (brandKit.defaultShowTitle !== undefined) merged.showTitle = brandKit.defaultShowTitle;
    if (brandKit.defaultButtonLabel) merged.buttonLabel = brandKit.defaultButtonLabel as CarouselConfig["buttonLabel"];
    if (brandKit.defaultButtonFont) merged.buttonFont = brandKit.defaultButtonFont;
    if (brandKit.defaultButtonColor) merged.buttonColor = brandKit.defaultButtonColor;
    if (brandKit.defaultButtonTextColor) merged.buttonTextColor = brandKit.defaultButtonTextColor;
  }
  
  if (override) {
    if (override.position) merged.position = override.position as CarouselConfig["position"];
    if (override.positionOffsetX !== undefined) merged.positionOffsetX = override.positionOffsetX;
    if (override.positionOffsetY !== undefined) merged.positionOffsetY = override.positionOffsetY;
    if (override.cornerRadius !== undefined) merged.cornerRadius = override.cornerRadius;
    if (override.backgroundOpacity !== undefined) merged.backgroundOpacity = override.backgroundOpacity;
    if (override.showThumbnail !== undefined) merged.showThumbnail = override.showThumbnail;
    if (override.showButton !== undefined) merged.showButton = override.showButton;
    if (override.showPrice !== undefined) merged.showPrice = override.showPrice;
    if (override.showTitle !== undefined) merged.showTitle = override.showTitle;
    if (override.buttonLabel) merged.buttonLabel = override.buttonLabel as CarouselConfig["buttonLabel"];
    if (override.buttonFont) merged.buttonFont = override.buttonFont;
    if (override.buttonColor) merged.buttonColor = override.buttonColor;
    if (override.buttonTextColor) merged.buttonTextColor = override.buttonTextColor;
  }
  
  return merged;
}

export function VideoPlayerWithCarousel({
  video,
  className,
  autoPlay = false,
}: VideoPlayerWithCarouselProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout>();

  const { data: carouselData, isLoading: isLoadingCarousel } = useQuery<CarouselApiData>({
    queryKey: ["/api/videos", video.id, "carousel"],
    enabled: !!video.id,
  });

  const { data: brandKit, isLoading: isLoadingBrandKit } = useQuery<BrandKitData>({
    queryKey: ["/api/brand-kit"],
  });

  const { data: overlays = [] } = useQuery<VideoProductOverlay[]>({
    queryKey: ["/api/videos", video.id, "overlays"],
    enabled: !!video.id,
  });

  const { data: detectionStatus, isLoading: isLoadingDetection } = useQuery<DetectionStatus>({
    queryKey: ["/api/videos", video.id, "detections"],
    enabled: !!video.id,
    refetchInterval: (query) => {
      const data = query.state.data as DetectionStatus | undefined;
      if (data?.job?.status === "processing" || data?.job?.status === "queued") {
        return 3000;
      }
      return false;
    },
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, []);

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const toggleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const products = carouselData?.products || detectionStatus?.results || [];
  const config = mergeCarouselConfig(defaultCarouselConfig, brandKit, carouselData?.override);

  // Group overlays by position for multi-carousel rendering
  function overlayToDetectedProduct(o: VideoProductOverlay): DetectedProduct {
    return {
      id: String(o.id),
      productId: o.productId ?? String(o.id),
      product: {
        id: o.productId ?? String(o.id),
        name: o.name,
        productUrl: o.productUrl,
        imageUrl: o.imageUrl,
        price: o.price,
      } as any,
      brand: o.brandName ? ({ name: o.brandName } as any) : undefined,
      confidence: 1,
      startTime: parseFloat(o.startTime ?? "0"),
      endTime: o.endTime != null ? parseFloat(o.endTime) : 999999,
    };
  }

  const overlaysByPosition = overlays.reduce<Record<string, VideoProductOverlay[]>>((acc, o) => {
    const pos = o.position ?? "bottom";
    if (!acc[pos]) acc[pos] = [];
    acc[pos].push(o);
    return acc;
  }, {});

  const getDetectionStatusBadge = () => {
    if (!detectionStatus?.job) return null;

    switch (detectionStatus.job.status) {
      case "queued":
        return (
          <Badge variant="secondary" className="gap-1 bg-yellow-500/20 text-yellow-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            Queued
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="secondary" className="gap-1 bg-blue-500/20 text-blue-600">
            <Wand2 className="h-3 w-3 animate-pulse" />
            Detecting Products...
            {(detectionStatus.job.totalFrames ?? 0) > 0 && (
              <span className="ml-1">
                {Math.round(
                  ((detectionStatus.job.processedFrames || 0) /
                    (detectionStatus.job.totalFrames ?? 1)) *
                    100
                )}
                %
              </span>
            )}
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="secondary" className="gap-1 bg-green-500/20 text-green-600">
            <CheckCircle className="h-3 w-3" />
            {products.length} Products Found
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="secondary" className="gap-1 bg-red-500/20 text-red-600">
            <AlertCircle className="h-3 w-3" />
            Detection Failed
          </Badge>
        );
      default:
        return null;
    }
  };

  if (isLoadingCarousel || isLoadingDetection || isLoadingBrandKit) {
    return (
      <Card className={className}>
        <CardContent className="p-0">
          <Skeleton className="w-full aspect-video" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`overflow-hidden ${className}`}>
      <CardContent className="p-0">
        <div
          ref={containerRef}
          className="relative aspect-video bg-black group"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => isPlaying && setShowControls(false)}
        >
          <video
            ref={videoRef}
            src={video.videoUrl}
            poster={video.thumbnailUrl || undefined}
            className="w-full h-full object-contain"
            autoPlay={autoPlay}
            playsInline
            data-testid="video-player"
          />

          {products.length > 0 && overlays.length === 0 && (
            <VideoProductCarousel
              products={products}
              config={config}
              currentTime={currentTime}
              utmCode={video.utmCode || undefined}
            />
          )}

          {Object.entries(overlaysByPosition).map(([pos, posOverlays]) => (
            <VideoProductCarousel
              key={pos}
              products={posOverlays.map(overlayToDetectedProduct)}
              config={{ ...defaultCarouselConfig, position: pos as any }}
              currentTime={currentTime}
              utmCode={video.utmCode || undefined}
            />
          ))}

          <div
            className={`absolute top-4 right-4 z-40 transition-opacity duration-300 ${
              showControls ? "opacity-100" : "opacity-0"
            }`}
          >
            {getDetectionStatusBadge()}
          </div>

          <div
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
              showControls ? "opacity-100" : "opacity-0"
            }`}
          >
            <Button
              size="icon"
              variant="ghost"
              className="h-16 w-16 bg-black/40 hover:bg-black/60 text-white rounded-full"
              onClick={togglePlay}
              data-testid="button-play-pause"
            >
              {isPlaying ? (
                <Pause className="h-8 w-8" />
              ) : (
                <Play className="h-8 w-8 ml-1" />
              )}
            </Button>
          </div>

          <div
            className={`absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity duration-300 ${
              showControls ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                className="flex-1 h-1 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                data-testid="input-video-seek"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={togglePlay}
                  data-testid="button-play-pause-bottom"
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>

                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={toggleMute}
                  data-testid="button-mute"
                >
                  {isMuted ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </Button>

                <span className="text-xs text-white tabular-nums" data-testid="text-video-time">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={toggleFullscreen}
                  data-testid="button-fullscreen"
                >
                  <Maximize className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {detectionStatus?.job?.status === "processing" && (
          <div className="p-4 border-t">
            <div className="flex items-center gap-3 mb-2">
              <Wand2 className="h-5 w-5 text-primary animate-pulse" />
              <span className="font-medium">AI Product Detection in Progress</span>
            </div>
            <Progress
              value={
                (detectionStatus.job.totalFrames ?? 0) > 0
                  ? ((detectionStatus.job.processedFrames || 0) /
                      (detectionStatus.job.totalFrames ?? 1)) *
                    100
                  : 0
              }
              className="h-2"
            />
            <p className="text-sm text-muted-foreground mt-2">
              Analyzing frame {detectionStatus.job.processedFrames || 0} of{" "}
              {detectionStatus.job.totalFrames ?? 0}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
