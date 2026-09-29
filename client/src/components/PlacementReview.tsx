/**
 * Placement Review: the step between AI detection and the live carousel.
 *
 * The client's prototype (mtrlzd-object-detection) is the design: a queue
 * ranked by confidence, the actual frame with the product's box drawn on it,
 * a placement sequence on the video's timeline, and an inspector where each
 * placement is accepted, deleted or sent back to pending. Nothing reaches the
 * carousel until someone accepts it; the server enforces that
 * (server/placementReview.ts), this is where a person does it.
 *
 * The frame is the real video seeked to the placement's clearest moment, not
 * a server-extracted still, so it can also be scrubbed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, Undo2, Loader2, Package, ScanSearch, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { videoDeliveryUrl } from "@shared/videoDelivery";
import {
  STATUS_LABEL, assignLanes, formatTime, matchPercent, nextPendingId, segment,
  type Placement, type ReviewJob, type ReviewStatus,
} from "@/lib/placementReview";

interface PlacementReviewProps {
  videoId: string;
  videoUrl: string;
  /** Called after accepted placements are added, with how many were. */
  onImported?: (count: number) => void;
}

const STATUS_TONE: Record<ReviewStatus, string> = {
  pending: "bg-amber-500",
  accepted: "bg-primary",
  rejected: "bg-muted-foreground/35",
};

export function PlacementReview({ videoId, videoUrl, onImported }: PlacementReviewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/videos", videoId, "detections"];

  const { data: job, isLoading } = useQuery<ReviewJob>({
    queryKey: key,
    refetchInterval: (q) => {
      const s = (q.state.data as ReviewJob | undefined)?.status;
      return s === "queued" || s === "processing" ? 2000 : false;
    },
  });
  const queue = job?.results ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (queue.length && !queue.some((p) => p.id === selectedId)) setSelectedId(queue[0].id);
  }, [queue, selectedId]);
  const selected = queue.find((p) => p.id === selectedId) ?? null;

  // ── The stage: the real video, seeked to the placement's clearest frame ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState(9 / 16);
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !selected) return;
    const t = Number(selected.frameTimestamp) || 0;
    const seek = () => { v.pause(); v.currentTime = Math.min(t, (v.duration || t) - 0.05); };
    if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
  }, [selected?.id, selected?.frameTimestamp]);
  const showBox = selected?.boundingBox && Math.abs(playhead - Number(selected.frameTimestamp)) < 0.6;

  // ── Timing edits for the selected placement ──
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  useEffect(() => {
    setStart(selected?.startTime ?? "");
    setEnd(selected?.endTime ?? "");
  }, [selected?.id, selected?.startTime, selected?.endTime]);
  const timingChanged = !!selected && (start !== (selected.startTime ?? "") || end !== (selected.endTime ?? ""));

  const review = useMutation({
    mutationFn: async (vars: { id: string; status: ReviewStatus; startTime?: string; endTime?: string }) => {
      const { id, ...body } = vars;
      const res = await apiRequest("PATCH", `/api/videos/${videoId}/detections/${id}`, body);
      return res.json();
    },
    onSuccess: async (_d, vars) => {
      // Move on to the next placement still waiting, like working a queue.
      const after = queue.map((p) => (p.id === vars.id ? { ...p, reviewStatus: vars.status } : p));
      if (vars.status !== "pending") setSelectedId(nextPendingId(after, vars.id));
      await qc.invalidateQueries({ queryKey: key });
    },
    onError: async (err: any) => {
      let detail = "";
      try { detail = (await err?.response?.json?.())?.error ?? ""; } catch { /* generic */ }
      toast({ title: "Could not save that", description: detail || err?.message, variant: "destructive" });
    },
  });

  const decide = (status: ReviewStatus) => {
    if (!selected) return;
    review.mutate({
      id: selected.id,
      status,
      ...(timingChanged && start !== "" && end !== "" ? { startTime: start, endTime: end } : {}),
    });
  };

  const addToCarousel = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/videos/${videoId}/overlays/import-detections`, { position: "bottom" });
      return (await res.json()) as unknown[];
    },
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["/api/videos", videoId, "overlays"] });
      toast({
        title: created.length === 1 ? "1 product added to the carousel" : `${created.length} products added to the carousel`,
      });
      onImported?.(created.length);
    },
    onError: () => toast({ title: "Could not add them to the carousel", variant: "destructive" }),
  });

  // Keyboard: A accept, D delete, P back to pending, arrows move. Not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || !selected || review.isPending) return;
      const i = queue.findIndex((p) => p.id === selected.id);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const n = queue[Math.min(queue.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (n) { setSelectedId(n.id); e.preventDefault(); }
        return;
      }
      if (selected.importedAt) return;
      const k = e.key.toLowerCase();
      if (k === "a") decide("accepted");
      else if (k === "d") decide("rejected");
      else if (k === "p" && selected.reviewStatus !== "pending") decide("pending");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const counts = job?.counts ?? { pending: 0, accepted: 0, rejected: 0, readyToImport: 0 };
  const videoLength = duration || Math.max(0, ...queue.map((p) => Number(p.endTime) || 0));
  const src = useMemo(() => videoDeliveryUrl(videoUrl, "preview"), [videoUrl]);
  const { lanes, count: laneCount } = useMemo(() => assignLanes(queue), [queue]);
  const LANE = 14; // px per lane; bars are 10px with 4px between

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading placements
      </div>
    );
  }
  if (!job || job.status === "none" || (job.status !== "processing" && job.status !== "queued" && queue.length === 0)) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-10 text-center" data-testid="placement-review-empty">
        <ScanSearch className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No AI placements to review</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {job?.status === "failed"
            ? "The scan did not finish. You can still add products by hand under Timeline Overlays."
            : "The scan found no products from the tagged brands. Add them by hand under Timeline Overlays."}
        </p>
      </div>
    );
  }
  if (job.status === "processing" || job.status === "queued") {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" data-testid="placement-review-scanning">
        <Loader2 className="h-4 w-4 animate-spin" /> Still scanning the video
      </div>
    );
  }

  return (
    <div className="placement-review space-y-4" data-testid="placement-review">
      {/* Header: what is left, and the one action that changes the carousel */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Placement review</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.pending > 0
              ? `${counts.pending} of ${queue.length} still to review. Nothing goes on the carousel until you accept it.`
              : "All reviewed. Add the accepted ones to the carousel."}
          </p>
        </div>
        <Button
          onClick={() => addToCarousel.mutate()}
          disabled={counts.readyToImport === 0 || addToCarousel.isPending}
          className="shrink-0 gap-1.5"
          data-testid="button-add-accepted"
        >
          {addToCarousel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {counts.readyToImport === 0
            ? "Add accepted to carousel"
            : `Add ${counts.readyToImport} to carousel`}
        </Button>
      </div>

      {/* Grid areas: phones read frame, inspector, sequence, queue (so Accept is
          near the frame); desktop puts the frame and sequence left, the rest right. */}
      <div className="placement-grid">
        <div className="placement-grid__stage min-w-0">
          {/* Sized from the video's own aspect ratio (width follows the height cap),
              so the element IS the picture and the normalized box lands on it. */}
          <div
            className="placement-stage relative mx-auto overflow-hidden rounded-xl bg-neutral-950"
            style={{ aspectRatio: aspect, width: `min(100%, calc(var(--placement-stage-h) * ${aspect.toFixed(4)}))` }}
          >
            <video
              ref={videoRef}
              src={src}
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
                if (Number.isFinite(v.duration)) setDuration(v.duration);
              }}
              onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
              onSeeked={(e) => setPlayhead(e.currentTarget.currentTime)}
              data-testid="placement-video"
            />
            {showBox && selected?.boundingBox && (() => {
              const b = selected.boundingBox;
              const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
              // The label sits outside the box, anchored on the side with more
              // room and capped to the frame, so it is never cut off.
              const anchorRight = b.x + b.width / 2 > 0.5;
              const below = b.y < 0.08;
              return (
                <>
                  <div
                    className="placement-box pointer-events-none absolute"
                    style={{ left: pct(b.x), top: pct(b.y), width: pct(b.width), height: pct(b.height) }}
                    data-testid="placement-box"
                  />
                  <span
                    className="placement-box__tag pointer-events-none absolute"
                    style={{
                      ...(anchorRight
                        ? { right: pct(1 - (b.x + b.width)), maxWidth: `calc(${pct(b.x + b.width)} - 8px)` }
                        : { left: pct(b.x), maxWidth: `calc(${pct(1 - b.x)} - 8px)` }),
                      ...(below
                        ? { top: `calc(${pct(b.y + b.height)} + 6px)` }
                        : { bottom: `calc(${pct(1 - b.y)} + 6px)` }),
                    }}
                    data-testid="placement-box-tag"
                  >
                    {selected.product?.name ?? "Product"} · {matchPercent(selected.confidence)}%
                  </span>
                </>
              );
            })()}
            <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11px] text-white/90 backdrop-blur">
              {formatTime(playhead)}
              {selected && !selected.boundingBox && <span className="ml-1.5 text-white/60">no box for this match</span>}
            </div>
          </div>


        </div>
        <div className="placement-grid__seq min-w-0">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-semibold uppercase tracking-[0.08em]">Placement sequence</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" />To review</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-primary" />Accepted</span>
            </span>
          </div>
          <div
            className="placement-sequence relative mt-2 rounded-lg bg-muted"
            style={{ height: laneCount * LANE + 10 }}
            data-testid="placement-sequence"
          >
            {queue.map((p) => {
              const seg = segment(p.startTime, p.endTime, videoLength);
              if (!seg) return null;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  title={`${p.product?.name ?? "Product"}, ${formatTime(p.startTime)} to ${formatTime(p.endTime)}`}
                  aria-label={`${p.product?.name ?? "Product"} at ${formatTime(p.startTime)}`}
                  className={cn(
                    "placement-sequence__seg absolute h-2.5 rounded-full transition-opacity",
                    STATUS_TONE[p.reviewStatus],
                    p.reviewStatus === "rejected" && "opacity-60",
                    p.id === selectedId ? "ring-2 ring-foreground ring-offset-1 ring-offset-muted" : "opacity-80 hover:opacity-100",
                  )}
                  style={{ left: `${seg.left}%`, width: `${seg.width}%`, top: 6 + (lanes.get(p.id) ?? 0) * LANE }}
                />
              );
            })}
            {videoLength > 0 && (
              <span
                className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
                style={{ left: `${Math.min(100, (playhead / videoLength) * 100)}%` }}
              />
            )}
          </div>
        </div>

        {selected && (
          <div className="placement-grid__insp rounded-xl border bg-card p-4" data-testid="placement-inspector">
            <div className="flex items-start gap-3">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted">
                {selected.product?.imageUrl
                  ? <img src={selected.product.imageUrl} alt="" className="h-full w-full object-cover" />
                  : <Package className="m-auto mt-4 h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{selected.product?.name ?? "Unknown product"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[selected.brandName, selected.product?.price && `$${selected.product.price}`].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-1 text-xs"><span className="font-semibold tabular-nums">{matchPercent(selected.confidence)}%</span> <span className="text-muted-foreground">match</span></p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="placement-start" className="text-xs">Shows from (s)</Label>
                <Input id="placement-start" type="number" inputMode="decimal" min={0} step={0.1} value={start}
                  disabled={!!selected.importedAt} onChange={(e) => setStart(e.target.value)} data-testid="input-placement-start" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="placement-end" className="text-xs">Until (s)</Label>
                <Input id="placement-end" type="number" inputMode="decimal" min={0} step={0.1} value={end}
                  disabled={!!selected.importedAt} onChange={(e) => setEnd(e.target.value)} data-testid="input-placement-end" />
              </div>
            </div>

            {selected.importedAt ? (
              <p className="mt-4 text-xs text-muted-foreground" data-testid="placement-on-carousel">
                On the carousel. Edit or remove it under Timeline Overlays.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" className="gap-1.5" onClick={() => decide("accepted")} disabled={review.isPending} data-testid="button-accept-placement">
                  <Check className="h-4 w-4" /> {selected.reviewStatus === "accepted" && timingChanged ? "Save timing" : "Accept"}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => decide("rejected")} disabled={review.isPending} data-testid="button-delete-placement">
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
                {selected.reviewStatus !== "pending" && (
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => decide("pending")} disabled={review.isPending} data-testid="button-pending-placement">
                    <Undo2 className="h-4 w-4" /> Back to pending
                  </Button>
                )}
              </div>
            )}
            <p className="mt-3 hidden text-[11px] text-muted-foreground lg:block">Keys: A accept · D delete · ↑↓ move</p>
          </div>
        )}

        <ul className="placement-grid__queue placement-queue max-h-[22rem] divide-y overflow-y-auto rounded-xl border bg-card" data-testid="placement-queue">
          {queue.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-current={p.id === selectedId ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                  p.id === selectedId && "bg-primary/[0.07]",
                )}
                data-testid={`placement-row-${p.id}`}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_TONE[p.reviewStatus])} aria-hidden="true" />
                <span className={cn("min-w-0 flex-1", p.reviewStatus === "rejected" && "opacity-55")}>
                  <span className={cn("block truncate text-sm font-medium", p.reviewStatus === "rejected" && "line-through")}>
                    {p.product?.name ?? "Unknown product"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.brandName ?? "Unknown brand"} · {formatTime(p.startTime)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-semibold tabular-nums">{matchPercent(p.confidence)}%</span>
                  <span className="block text-[11px] text-muted-foreground">{p.importedAt ? "On carousel" : STATUS_LABEL[p.reviewStatus]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
