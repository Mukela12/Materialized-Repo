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
import { Layers, Plus, Clock, Trash2, ExternalLink, Pencil } from "lucide-react";
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
  /** The overlay being edited, or null when adding a new one. */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [oName, setOName] = useState("");
  const [oUrl, setOUrl] = useState("");
  const [oImageUrl, setOImageUrl] = useState("");
  const [oPrice, setOPrice] = useState("");
  const [oBrandName, setOBrandName] = useState("");
  /** Blank = use the video-wide label from the Editing Suite. */
  const [oButtonLabel, setOButtonLabel] = useState("");
  const [oPosition, setOPosition] = useState("bottom");
  const [oStartTime, setOStartTime] = useState("0");
  const [oEndTime, setOEndTime] = useState("");

  const resetForm = () => {
    setOName(""); setOUrl(""); setOImageUrl(""); setOPrice(""); setOBrandName("");
    setOButtonLabel("");
    setOPosition("bottom"); setOStartTime("0"); setOEndTime("");
    setEditingId(null);
  };

  /** Load an existing overlay into the form rather than making them retype it. */
  const beginEdit = (o: VideoProductOverlay) => {
    setEditingId(o.id as number);
    setOName(o.name ?? "");
    setOUrl(o.productUrl ?? "");
    setOImageUrl(o.imageUrl ?? "");
    setOPrice(o.price ?? "");
    setOBrandName(o.brandName ?? "");
    setOButtonLabel((o as any).buttonLabel ?? "");
    setOPosition(o.position ?? "bottom");
    setOStartTime(String(parseFloat(o.startTime ?? "0") || 0));
    setOEndTime(o.endTime == null ? "" : String(parseFloat(o.endTime)));
    setShowAdd(true);
  };

  const { data: overlays = [] } = useQuery<VideoProductOverlay[]>({
    queryKey: ["/api/videos", videoId, "overlays"],
    enabled: !!videoId && enabled,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/videos", videoId, "overlays"] });

  /** One payload for both create and update, so the two cannot drift. */
  const overlayPayload = () => ({
    name: oName.trim(),
    productUrl: oUrl.trim() || null,
    imageUrl: oImageUrl.trim() || null,
    price: oPrice.trim() || null,
    brandName: oBrandName.trim() || null,
    buttonLabel: oButtonLabel.trim() || null,
    position: oPosition,
    startTime: parseFloat(oStartTime) || 0,
    endTime: oEndTime.trim() ? parseFloat(oEndTime) : null,
  });

  const saveOverlay = useMutation({
    mutationFn: async () =>
      editingId == null
        ? apiRequest("POST", `/api/videos/${videoId}/overlays`, { ...overlayPayload(), source: "manual" })
        : apiRequest("PATCH", `/api/videos/${videoId}/overlays/${editingId}`, overlayPayload()),
    onSuccess: () => {
      invalidate();
      toast({
        title: editingId == null ? "Overlay added" : "Overlay updated",
        description: editingId == null ? "Product overlay added to timeline." : "Your changes have been saved.",
      });
      const wasEditing = editingId != null;
      resetForm();
      // Stay open when adding several; close after an edit, which is one job done.
      setShowAdd(wasEditing ? false : startExpanded);
    },
    onError: () => toast({ title: "Error", description: "Failed to save overlay.", variant: "destructive" }),
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
            <Input
              data-testid="input-overlay-name"
              placeholder="e.g. Summer Dress"
              value={oName}
              onChange={(e) => setOName(e.target.value)}
              maxLength={25}
              className="h-8 text-sm"
            />
            {/* The carousel caps at 25 characters, so the limit is enforced
                where it is typed rather than discovered as an ellipsis later. */}
            <p className="text-xs text-muted-foreground">{oName.length}/25 characters</p>
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
            {/* The client asked for this in as many words. A missing Buy button
                is indistinguishable from a broken one unless the rule is stated
                where the decision is made. */}
            <p className="text-xs text-muted-foreground" data-testid="text-price-required-note">
              A price is required for the Buy button to appear. Prices can be hidden in the Editing Suite.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Brand Name</Label>
            <Input data-testid="input-overlay-brand" placeholder="e.g. Zara" value={oBrandName} onChange={(e) => setOBrandName(e.target.value)} className="h-8 text-sm" />
          </div>
          {/* Per-product call to action. The label used to be one setting for
              the whole video, so a showroom listing and a pair of shoes had to
              share it — the client's example was APPLY NOW against BUY NOW. */}
          <div className="space-y-1">
            <Label className="text-xs">Button Text</Label>
            <Input
              data-testid="input-overlay-button-label"
              placeholder="Leave blank to use the video's setting"
              value={oButtonLabel}
              onChange={(e) => setOButtonLabel(e.target.value)}
              maxLength={24}
              className="h-8 text-sm"
            />
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
              onClick={() => saveOverlay.mutate()}
              disabled={!oName.trim() || saveOverlay.isPending}
              data-testid="button-save-overlay"
            >
              {saveOverlay.isPending
                ? "Saving…"
                : editingId == null ? "Add Overlay" : "Save changes"}
            </Button>
            {(!startExpanded || editingId != null) && (
              <Button
                size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => { resetForm(); setShowAdd(false); }}
                data-testid="button-cancel-overlay"
              >
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
                  {/* The absent Buy button, explained on the row it belongs to. */}
                  {!o.price && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5" data-testid={`text-no-price-${o.id}`}>
                      No price — no Buy button. Edit to add one.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {/* Edit, not delete-and-retype. The client had to recreate an
                      overlay from scratch to change one field. */}
                  <button
                    data-testid={`button-edit-overlay-${o.id}`}
                    onClick={() => beginEdit(o)}
                    className="text-muted-foreground hover:text-primary transition-colors"
                    title="Edit this overlay"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    data-testid={`button-remove-overlay-${o.id}`}
                    onClick={() => removeOverlay.mutate(o.id as number)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove this overlay"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
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
