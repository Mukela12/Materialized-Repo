/**
 * Styling ONE video's carousel, on top of the creator's defaults.
 *
 * The client asked for both halves of this: the Brand Kit holds "Default
 * settings for this user and all of their videos", and "the user should have
 * capabilities to edit each unique video setting (for instance, they might like
 * to change their colors for the Seasons, or to match the colors of their
 * collection)".
 *
 * ── Why this saves a diff rather than the settings it is holding ─────────────
 * Saving the whole settings object is the obvious implementation and it
 * silently destroys the first half: all eighteen fields become overrides, so
 * the video is detached from the brand kit forever. She changes her palette for
 * a season, every video follows except the ones she once tweaked, and nothing
 * explains why.
 *
 * So only what actually differs is written; everything else is NULLed, which is
 * what the override table's nullable columns mean. The screen says which fields
 * are its own, because an inherited value and an overridden one look identical
 * otherwise — and that ambiguity is the reason to show it at all.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductCarouselEditor } from "@/components/ProductCarouselEditor";
import { RotateCcw, Save, Link2 } from "lucide-react";
import {
  settingsFromBrandKit, applyOverride, overrideFromSettings, overriddenKeys,
  emptyOverride, type CarouselSettings,
} from "@shared/carousel";

/** Field name -> the words on screen, so the list reads as English. */
const FIELD_LABELS: Record<string, string> = {
  position: "position",
  positionOffsetX: "horizontal nudge",
  positionOffsetY: "vertical nudge",
  delayUntilEnd: "delay until end",
  carouselBackgroundColor: "panel colour",
  backgroundOpacity: "panel opacity",
  cornerRadius: "panel corners",
  buttonColor: "button colour",
  buttonTextColor: "button text",
  buttonHoverColor: "button hover",
  buttonOpacity: "button opacity",
  buttonCornerRadius: "button corners",
  buttonLabel: "button label",
  brandTitleColor: "brand title colour",
  productTitleColor: "product title colour",
  buttonFont: "button font",
  titleFont: "title font",
  titleFontSize: "title size",
  priceFontSize: "price size",
  buttonFontSize: "button size",
  showThumbnail: "thumbnail",
  showButton: "button",
  showPrice: "price",
  showTitle: "title",
  commerceEnabled: "commerce",
};

export function VideoCarouselOverride({ videoId, videoUrl }: {
  videoId: string;
  videoUrl?: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: brandKit } = useQuery<any>({ queryKey: ["/api/brand-kit"] });
  const { data: override, isLoading } = useQuery<any>({
    queryKey: [`/api/videos/${videoId}/carousel/settings`],
  });

  /** What this video would look like with no override at all. */
  const baseline = useMemo(() => settingsFromBrandKit(brandKit), [brandKit]);
  /** What it looks like now. */
  const current = useMemo(() => applyOverride(baseline, override), [baseline, override]);

  const [draft, setDraft] = useState<CarouselSettings | null>(null);
  const settings = draft ?? current;

  // Computed from the DRAFT, so the list updates as she edits rather than only
  // after saving — otherwise she cannot tell what she is about to detach.
  const overridden = useMemo(
    () => overriddenKeys(overrideFromSettings(baseline, settings)),
    [baseline, settings],
  );

  const save = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/videos/${videoId}/carousel`, overrideFromSettings(baseline, settings)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/videos/${videoId}/carousel/settings`] });
      setDraft(null);
      toast({
        title: overridden.length ? "Saved for this video" : "Back to your defaults",
        description: overridden.length
          ? `${overridden.length} setting${overridden.length === 1 ? "" : "s"} now specific to this video. The rest still follow your Brand Kit.`
          : "This video now follows your Brand Kit for everything.",
      });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Could not save", variant: "destructive" }),
  });

  const reset = useMutation({
    mutationFn: () => apiRequest("POST", `/api/videos/${videoId}/carousel`, emptyOverride()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/videos/${videoId}/carousel/settings`] });
      setDraft(null);
      toast({ title: "Reset", description: "This video follows your Brand Kit again." });
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading styling…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">Carousel styling for this video</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Starts from your Brand Kit. Anything you change here applies to this
            video only — the rest keeps following your defaults.
          </p>
        </div>
        {overridden.length > 0 && (
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={() => reset.mutate()}
            disabled={reset.isPending}
            data-testid="button-reset-video-carousel"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Use my defaults
          </Button>
        )}
      </div>

      {/* Which fields are this video's own. Without this, an inherited value
          and an overridden one are indistinguishable — and the difference
          decides whether a later Brand Kit change reaches this video. */}
      <div className="rounded-lg border border-border p-2.5 flex items-start gap-2">
        <Link2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        {overridden.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="text-override-summary">
            Everything follows your Brand Kit. Change your defaults and this video
            changes with them.
          </p>
        ) : (
          <div className="text-xs" data-testid="text-override-summary">
            <span className="text-muted-foreground">Specific to this video:</span>{" "}
            {overridden.map((k) => (
              <Badge key={k} variant="secondary" className="mr-1 mb-1 font-normal">
                {FIELD_LABELS[k] ?? k}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <ProductCarouselEditor
        settings={settings}
        onChange={setDraft}
        videoUrl={videoUrl ?? undefined}
        compact
      />

      <Button
        onClick={() => save.mutate()}
        disabled={save.isPending || draft === null}
        className="w-full gap-2"
        data-testid="button-save-video-carousel"
      >
        <Save className="h-4 w-4" />
        {save.isPending ? "Saving…" : "Save for this video"}
      </Button>
    </div>
  );
}
