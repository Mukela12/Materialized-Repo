/**
 * Pin products to moments in a video.
 *
 * ── Why this is a component and not markup in two places ─────────────────────
 * This started life inside VideoDetailSheet, reachable only after a video was
 * published: upload, publish, find the video, open it, scroll. The client makes
 * sample shoppable videos by hand — "add URLS manually to quickly churn out
 * sample videos shoppable" — so that ordering put the one step she repeats
 * behind the one step she only does once.
 *
 * The upload flow needed the same fields. Copying them would have been two
 * forms writing the same rows, drifting the first time either changed — the
 * same mistake the embed made when two call sites hand-rolled their own
 * transformation strings with different widths.
 *
 * ── It needs a saved video ───────────────────────────────────────────────────
 * Overlays are rows against a videoId, so this can only appear once the draft
 * exists. In the upload flow that is true from the carousel step onward, which
 * is where it is mounted; before that there is nothing to attach to.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ImageDropField } from "@/components/ImageDropField";
import { Layers, Plus, Clock, Trash2, ExternalLink } from "lucide-react";
import type { VideoProductOverlay } from "@shared/schema";

const POSITIONS = [
  { value: "bottom", label: "Bottom Center" },
  { value: "top", label: "Top Center" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "bottom-right", label: "Bottom Right" },
  { value: "top-left", label: "Top Left" },
  { value: "top-right", label: "Top Right" },
];

export function OverlayComposer({
  videoId,
  enabled = true,
  /** Open the form on mount — the upload flow is here to add one. */
  startExpanded = false,
}: {
  videoId: string;
  enabled?: boolean;
  startExpanded?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(startExpanded);
  const [oName, setOName] = useState("");
  const [oUrl, setOUrl] = useState("");
  const [oImageUrl, setOImageUrl] = useState("");
  const [oPrice, setOPrice] = useState("");
  const [oBrandName, setOBrandName] = useState("");
  const [oPosition, setOPosition] = useState("bottom");
  const [oStartTime, setOStartTime] = useState("0");
  const [oEndTime, setOEndTime] = useState("");

  const { data: overlays = [] } = useQuery<VideoProductOverlay[]>({
    queryKey: ["/api/videos", videoId, "overlays"],
    enabled: !!videoId && enabled,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/videos", videoId, "overlays"] });

  const addOverlay = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/videos/${videoId}/overlays`, {
        name: oName.trim(),
        productUrl: oUrl.trim() || null,
        imageUrl: oImageUrl.trim() || null,
        price: oPrice.trim() || null,
        brandName: oBrandName.trim() || null,
        position: oPosition,
        startTime: parseFloat(oStartTime) || 0,
        endTime: oEndTime.trim() ? parseFloat(oEndTime) : null,
        source: "manual",
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Overlay Added", description: "Product overlay added to timeline." });
      setOName(""); setOUrl(""); setOImageUrl(""); setOPrice(""); setOBrandName("");
      setOPosition("bottom"); setOStartTime("0"); setOEndTime("");
      // Stay open when the point of being here is adding several.
      setShowAdd(startExpanded);
    },
    onError: () => toast({ title: "Error", description: "Failed to add overlay.", variant: "destructive" }),
  });

  const removeOverlay = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/videos/${videoId}/overlays/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Removed", description: "Overlay removed." }); },
    onError: () => toast({ title: "Error", description: "Failed to remove overlay.", variant: "destructive" }),
  });

  const importDetections = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/videos/${videoId}/overlays/import-detections`, { position: "bottom" }),
    onSuccess: () => { invalidate(); toast({ title: "Imported", description: "AI-detected products added as overlays." }); },
    onError: () => toast({ title: "Error", description: "Failed to import detections.", variant: "destructive" }),
  });

  return (
    <div className="space-y-3 border border-border rounded-xl p-4 bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold">Timeline Overlays</Label>
          {overlays.length > 0 && (
            <Badge variant="secondary" className="text-xs">{overlays.length}</Badge>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
            onClick={() => importDetections.mutate()}
            disabled={importDetections.isPending}
            data-testid="button-import-detections"
            title="Import AI-detected products as overlays"
          >
            {importDetections.isPending ? "Importing…" : "Import AI"}
          </Button>
          <Button
            variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
            onClick={() => setShowAdd((p) => !p)}
            data-testid="button-toggle-add-overlay"
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Pin products to specific timestamps and screen positions. Different from carousel links — overlays control exact timing.
      </p>

      {showAdd && (
        <div className="space-y-2 border border-border rounded-lg p-3 bg-background">
          <div className="space-y-1">
            <Label className="text-xs">Product Name *</Label>
            <Input data-testid="input-overlay-name" placeholder="e.g. Summer Dress" value={oName} onChange={(e) => setOName(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Product URL</Label>
            <Input data-testid="input-overlay-url" placeholder="https://shop.example.com/product" value={oUrl} onChange={(e) => setOUrl(e.target.value)} className="h-8 text-sm" />
          </div>
          {/* Drag and drop, per the client — a product photo is on her desktop,
              not at a public address. Pasting a URL is still possible behind a
              smaller control, because brands do keep images on their own CDN. */}
          <ImageDropField value={oImageUrl} onChange={setOImageUrl} />
          <div className="space-y-1">
            <Label className="text-xs">Price</Label>
            <Input data-testid="input-overlay-price" placeholder="49.99" value={oPrice} onChange={(e) => setOPrice(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Brand Name</Label>
            <Input data-testid="input-overlay-brand" placeholder="e.g. Zara" value={oBrandName} onChange={(e) => setOBrandName(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Screen Position</Label>
            <Select value={oPosition} onValueChange={setOPosition}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-overlay-position">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Clock className="h-3 w-3" />Start (seconds)</Label>
              <Input data-testid="input-overlay-start" type="number" min={0} step={0.5} placeholder="0" value={oStartTime} onChange={(e) => setOStartTime(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Clock className="h-3 w-3" />End (seconds)</Label>
              <Input data-testid="input-overlay-end" type="number" min={0} step={0.5} placeholder="Always visible" value={oEndTime} onChange={(e) => setOEndTime(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm" className="h-7 text-xs flex-1"
              onClick={() => addOverlay.mutate()}
              disabled={!oName.trim() || addOverlay.isPending}
              data-testid="button-save-overlay"
            >
              {addOverlay.isPending ? "Adding…" : "Add Overlay"}
            </Button>
            {!startExpanded && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {overlays.length > 0 ? (
        <div className="space-y-2">
          {overlays.map((o) => {
            const posLabel = POSITIONS.find((p) => p.value === o.position)?.label ?? o.position;
            return (
              <div key={o.id} className="flex items-start gap-2 p-2 rounded-lg bg-background border border-border" data-testid={`overlay-item-${o.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium truncate">{o.name}</p>
                    <Badge variant="outline" className="text-xs shrink-0">{posLabel}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {parseFloat(o.startTime ?? "0").toFixed(1)}s
                    {o.endTime ? ` → ${parseFloat(o.endTime).toFixed(1)}s` : " → end"}
                  </p>
                  {o.productUrl && (
                    <a href={o.productUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate flex items-center gap-1 mt-0.5">
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{o.productUrl}</span>
                    </a>
                  )}
                </div>
                <button
                  data-testid={`button-remove-overlay-${o.id}`}
                  onClick={() => removeOverlay.mutate(o.id as number)}
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        !showAdd && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No overlays yet. Add one or import from AI detections.
          </p>
        )
      )}
    </div>
  );
}
