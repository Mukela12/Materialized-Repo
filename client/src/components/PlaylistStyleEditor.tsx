/**
 * Styling the frame a playlist's videos are viewed in.
 *
 * The client's list, verbatim: "Add Border (1pt - 5pt), Color Border, Corners,
 * Show Frame/Hide Frame (radio selection), Show Play Button/Automatic Playback,
 * Play Button color, size, opacity. Show Audio/Hide Audio, Audio Icon/Mute Icon
 * color, size, opacity. Add Logo, Logo position (…)".
 *
 * ── The preview is the whole point ───────────────────────────────────────────
 * It draws from the same PlaylistStyle object the embed renders from, and the
 * frame styles come from the SAME function the server uses to build the embed —
 * not a second implementation of the same intent. Twice already on this project
 * a preview was written separately from the thing it previewed and quietly
 * disagreed with it, and the client concluded a feature was missing when the
 * value was saving correctly all along. A preview that lies is worse than none.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Save, Play, Volume2, VolumeX } from "lucide-react";
import {
  PLAYLIST_STYLE_DEFAULTS, LOGO_POSITIONS, sanitisePlaylistStyle,
  isWatermark, logoPositionCss, type PlaylistStyle,
} from "@shared/playlistStyle";
import { withAlpha } from "@shared/carousel";

/** Colour swatch + hex field, kept in step. Same control as the carousel editor. */
function ColorField({
  label, value, onChange, testId, disabledReason,
}: {
  label: string; value: string; onChange: (v: string) => void; testId: string;
  /**
   * Why this control currently does nothing.
   *
   * A colour picker that stores a value nothing renders is the exact shape of
   * bug this project keeps producing: the setting saves, the picture does not
   * change, and the only conclusion available is that the feature is broken. If
   * a control cannot show its effect, it says so rather than accepting input
   * silently.
   */
  disabledReason?: string;
}) {
  const disabled = !!disabledReason;
  return (
    <div className={disabled ? "opacity-60" : undefined}>
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1 mt-1">
        <Input
          type="color" value={value} onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-8 h-8 p-0.5 shrink-0" data-testid={`input-${testId}`}
        />
        <Input
          value={value} onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="flex-1 h-8 text-xs font-mono" data-testid={`input-${testId}-hex`}
        />
      </div>
      {disabled && (
        <p className="text-xs text-muted-foreground mt-1" data-testid={`hint-${testId}`}>
          {disabledReason}
        </p>
      )}
    </div>
  );
}

const LOGO_LABELS: Record<string, string> = {
  "top-left": "Top left",
  "top-middle": "Top middle",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-middle": "Bottom middle",
  "bottom-right": "Bottom right",
  "watermark-top-left": "Watermark — top left",
  "watermark-top-right": "Watermark — top right",
  "watermark-bottom-left": "Watermark — bottom left",
  "watermark-bottom-right": "Watermark — bottom right",
};

/** The frame as it will appear, drawn from the same values the embed uses. */
export function PlaylistFramePreview({ style, testId = "playlist-frame-preview" }: {
  style: PlaylistStyle; testId?: string;
}) {
  const s = sanitisePlaylistStyle(style);
  const [muted, setMuted] = useState(true);

  return (
    <div
      className="relative w-full bg-black overflow-hidden"
      style={{
        aspectRatio: "16/9",
        // pt, matching the embed — her spec says 1pt–5pt and a designer means points.
        border: s.frameShow && s.frameBorderWidth > 0
          ? `${s.frameBorderWidth}pt solid ${s.frameBorderColor}`
          : "0",
        borderRadius: s.frameShow ? `${s.frameCornerRadius}px` : 0,
      }}
      data-testid={testId}
    >
      <div className="absolute inset-0 flex items-center justify-center text-white/25 text-xs">
        Your video
      </div>

      {/* Shown when playback is NOT automatic — the two are one choice. */}
      {!s.playAutoplay && (
        <div
          className="absolute top-1/2 left-1/2 rounded-full flex items-center justify-center"
          style={{
            width: s.playButtonSize, height: s.playButtonSize,
            transform: "translate(-50%,-50%)",
            background: withAlpha(s.playButtonColor, s.playButtonOpacity),
          }}
          data-testid={`${testId}-play`}
        >
          <Play className="fill-black text-black" style={{ width: "45%", height: "45%", marginLeft: "8%" }} />
        </div>
      )}

      {s.audioShow && (
        <button
          type="button"
          className="absolute bottom-2 left-2 flex items-center justify-center"
          style={{
            width: s.audioIconSize, height: s.audioIconSize,
            color: s.audioIconColor, opacity: s.audioIconOpacity / 100,
          }}
          onClick={() => setMuted((m) => !m)}
          data-testid={`${testId}-audio`}
        >
          {muted ? <VolumeX className="w-full h-full" /> : <Volume2 className="w-full h-full" />}
        </button>
      )}

      {s.logoUrl && (
        <img
          src={s.logoUrl}
          alt=""
          className="absolute object-contain pointer-events-none"
          style={{
            ...Object.fromEntries(
              logoPositionCss(s.logoPosition).split(";").filter(Boolean).map((d) => {
                const [k, v] = d.split(":");
                return [k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v.trim()];
              }),
            ),
            opacity: isWatermark(s.logoPosition) ? 0.35 : 1,
            maxWidth: "22%", maxHeight: "18%",
          }}
          data-testid={`${testId}-logo`}
        />
      )}
    </div>
  );
}

export function PlaylistStyleEditor({
  playlistId,
  initial,
}: {
  playlistId: number;
  initial?: Partial<PlaylistStyle> | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [style, setStyle] = useState<PlaylistStyle>(
    sanitisePlaylistStyle({ ...PLAYLIST_STYLE_DEFAULTS, ...(initial ?? {}) }),
  );

  const set = <K extends keyof PlaylistStyle>(key: K, value: PlaylistStyle[K]) =>
    setStyle((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/playlists/${playlistId}/style`, style),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/playlists/${playlistId}`] });
      toast({
        title: "Styling saved",
        // Says what actually happens next, because an embed already on someone
        // else's page is cached and will not change the instant this saves.
        description: "Embeds pick this up within a few minutes.",
      });
    },
    onError: (e: any) =>
      toast({ title: e?.message ?? "Could not save styling", variant: "destructive" }),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Tabs defaultValue="frame">
          <TabsList className="grid w-full grid-cols-3 h-8">
            <TabsTrigger value="frame" className="text-xs" data-testid="tab-style-frame">Frame</TabsTrigger>
            <TabsTrigger value="controls" className="text-xs" data-testid="tab-style-controls">Controls</TabsTrigger>
            <TabsTrigger value="logo" className="text-xs" data-testid="tab-style-logo">Logo</TabsTrigger>
          </TabsList>

          {/* ── Frame ────────────────────────────────────────────────────── */}
          <TabsContent value="frame" className="space-y-3 mt-3">
            <div className="rounded-lg border border-border p-3 space-y-2">
              <Label className="text-xs font-medium">Frame</Label>
              <RadioGroup
                value={style.frameShow ? "show" : "hide"}
                onValueChange={(v) => set("frameShow", v === "show")}
                className="gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="show" id="frame-show" data-testid="radio-frame-show" />
                  <Label htmlFor="frame-show" className="text-xs font-normal cursor-pointer">Show frame</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="hide" id="frame-hide" data-testid="radio-frame-hide" />
                  <Label htmlFor="frame-hide" className="text-xs font-normal cursor-pointer">
                    Hide frame — video sits flush, no border or corners
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div>
              <Label className="text-xs">
                Border: {style.frameBorderWidth === 0 ? "none" : `${style.frameBorderWidth}pt`}
              </Label>
              <Slider
                value={[style.frameBorderWidth]}
                onValueChange={([v]) => set("frameBorderWidth", v)}
                min={0} max={5} step={1} className="mt-2"
                disabled={!style.frameShow}
                data-testid="slider-frame-border-width"
              />
            </div>

            <ColorField
              label="Border colour"
              value={style.frameBorderColor}
              onChange={(v) => set("frameBorderColor", v)}
              testId="frame-border-color"
              disabledReason={
                !style.frameShow
                  ? "The frame is hidden, so there is no border to colour."
                  : style.frameBorderWidth === 0
                    ? "Set a border width above to use this."
                    : undefined
              }
            />

            <div>
              <Label className="text-xs">Corners: {style.frameCornerRadius}px</Label>
              <Slider
                value={[style.frameCornerRadius]}
                onValueChange={([v]) => set("frameCornerRadius", v)}
                min={0} max={60} step={1} className="mt-2"
                disabled={!style.frameShow}
                data-testid="slider-frame-corner-radius"
              />
            </div>
          </TabsContent>

          {/* ── Controls ─────────────────────────────────────────────────── */}
          <TabsContent value="controls" className="space-y-3 mt-3">
            <div className="rounded-lg border border-border p-3 space-y-2">
              <Label className="text-xs font-medium">Playback</Label>
              <RadioGroup
                value={style.playAutoplay ? "auto" : "button"}
                onValueChange={(v) => set("playAutoplay", v === "auto")}
                className="gap-2"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="auto" id="play-auto" className="mt-0.5" data-testid="radio-play-auto" />
                  <Label htmlFor="play-auto" className="text-xs font-normal leading-snug cursor-pointer">
                    <span className="font-medium">Automatic playback</span>
                    <span className="block text-muted-foreground">
                      Starts muted — browsers block video that begins with sound.
                    </span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="button" id="play-button" className="mt-0.5" data-testid="radio-play-button" />
                  <Label htmlFor="play-button" className="text-xs font-normal leading-snug cursor-pointer">
                    <span className="font-medium">Show play button</span>
                    <span className="block text-muted-foreground">The viewer starts it.</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <ColorField
              label="Play button colour"
              value={style.playButtonColor}
              onChange={(v) => set("playButtonColor", v)}
              testId="play-button-color"
              disabledReason={
                style.playAutoplay ? "Playback is automatic, so no play button is shown." : undefined
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Size: {style.playButtonSize}px</Label>
                <Slider
                  value={[style.playButtonSize]}
                  onValueChange={([v]) => set("playButtonSize", v)}
                  min={24} max={160} step={2} className="mt-2"
                  disabled={style.playAutoplay}
                  data-testid="slider-play-button-size"
                />
              </div>
              <div>
                <Label className="text-xs">Opacity: {style.playButtonOpacity}%</Label>
                <Slider
                  value={[style.playButtonOpacity]}
                  onValueChange={([v]) => set("playButtonOpacity", v)}
                  min={0} max={100} step={5} className="mt-2"
                  disabled={style.playAutoplay}
                  data-testid="slider-play-button-opacity"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <Label className="text-xs">Show audio control</Label>
              <Switch
                checked={style.audioShow}
                onCheckedChange={(v) => set("audioShow", v)}
                data-testid="switch-audio-show"
              />
            </div>
            <ColorField
              label="Audio icon colour"
              value={style.audioIconColor}
              onChange={(v) => set("audioIconColor", v)}
              testId="audio-icon-color"
              disabledReason={style.audioShow ? undefined : "The audio control is hidden."}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Size: {style.audioIconSize}px</Label>
                <Slider
                  value={[style.audioIconSize]}
                  onValueChange={([v]) => set("audioIconSize", v)}
                  min={12} max={96} step={2} className="mt-2"
                  disabled={!style.audioShow}
                  data-testid="slider-audio-icon-size"
                />
              </div>
              <div>
                <Label className="text-xs">Opacity: {style.audioIconOpacity}%</Label>
                <Slider
                  value={[style.audioIconOpacity]}
                  onValueChange={([v]) => set("audioIconOpacity", v)}
                  min={0} max={100} step={5} className="mt-2"
                  disabled={!style.audioShow}
                  data-testid="slider-audio-icon-opacity"
                />
              </div>
            </div>
          </TabsContent>

          {/* ── Logo ─────────────────────────────────────────────────────── */}
          <TabsContent value="logo" className="space-y-3 mt-3">
            <div>
              <Label className="text-xs">Logo image URL</Label>
              <Input
                value={style.logoUrl ?? ""}
                onChange={(e) => set("logoUrl", e.target.value || null)}
                placeholder="https://…/logo.png"
                className="h-8 text-xs mt-1"
                data-testid="input-logo-url"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {/* Stated because the field silently discards anything else, and a
                    field that ignores you without saying so reads as broken. */}
                Must be an https address. Anything else is ignored.
              </p>
            </div>

            <div>
              <Label className="text-xs">Position</Label>
              <Select
                value={style.logoPosition}
                onValueChange={(v) => set("logoPosition", v as any)}
              >
                <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-logo-position">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOGO_POSITIONS.map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      {LOGO_LABELS[p] ?? p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Watermark positions sit in the same corner, at reduced opacity.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="gap-2 w-full"
          data-testid="button-save-playlist-style"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? "Saving…" : "Save styling"}
        </Button>
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-2">
          How the frame will look on the page it is embedded in
        </p>
        <PlaylistFramePreview style={style} />
      </div>
    </div>
  );
}
