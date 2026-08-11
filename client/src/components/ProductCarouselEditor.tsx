import { useState, useRef } from "react";
import { useBrandFontOptions } from "@/components/BrandFontUpload";
import { CarouselMockup } from "@/components/CarouselMockup";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  CAROUSEL_DEFAULTS, panelBackground, buttonBackground, isStackedPosition,
  type CarouselSettings,
} from "@shared/carousel";
import { CarouselPreviewFrame } from "@/components/CarouselPreviewFrame";
import { carouselPositionStyles } from "@/lib/carouselPosition";
import { videoDeliveryUrl } from "@shared/videoDelivery";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Eye,
  EyeOff,
  RotateCcw,
  Type,
  Palette,
  Layout,
  ToggleLeft,
  Save,
} from "lucide-react";
import { BUTTON_LABEL_OPTIONS, CAROUSEL_POSITION_OPTIONS, FONT_OPTIONS } from "@shared/schema";
import { fontStack } from "@/lib/fonts";
import { CAROUSEL_DEFAULT_BUTTON_COLOR, CAROUSEL_DEFAULT_BUTTON_TEXT_COLOR } from "@/lib/carouselDefaults";

/**
 * Re-exported so the many call sites that import it from here keep working.
 * The definition itself lives in shared/carousel.ts — it was declared here AND
 * in the Brand Kit page, and the two drifted until the Brand Kit preview
 * honoured two of the eight carousel positions.
 */
export type { CarouselSettings };


/** One colour control: swatch + hex field, kept in step with each other. */
function ColorField({
  label, value, onChange, testId,
}: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1 mt-1">
        <Input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 p-0.5 shrink-0"
          data-testid={`input-${testId}`}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 h-8 text-xs font-mono"
          data-testid={`input-${testId}-hex`}
        />
      </div>
    </div>
  );
}

interface ProductCarouselEditorProps {
  settings: CarouselSettings;
  onChange: (settings: CarouselSettings) => void;
  onReset?: () => void;
  onSaveDraft?: () => void;
  compact?: boolean;
  videoUrl?: string;
}

const defaultSettings = CAROUSEL_DEFAULTS;

// Stacks live in client/src/lib/fonts.ts alongside FONT_OPTIONS, so the list of
// offered fonts and the list of loadable fonts cannot drift apart again.
const getFontFamily = (font: string): string => fontStack(font);

export function ProductCarouselEditor({
  settings,
  onChange,
  onReset,
  onSaveDraft,
  compact = false,
  videoUrl,
}: ProductCarouselEditorProps) {
  const [showPreview, setShowPreview] = useState(true);
  // So the hover colour can actually be judged in the preview.
  const [hovered, setHovered] = useState(false);
  // The creator's uploaded typefaces, offered alongside the built-ins.
  const brandFonts = useBrandFontOptions();
  const [videoLoading, setVideoLoading] = useState(true);

  const updateSetting = <K extends keyof CarouselSettings>(
    key: K, 
    value: CarouselSettings[K]
  ) => {
    onChange({ ...settings, [key]: value });
  };

  const handleReset = () => {
    if (onReset) {
      onReset();
    } else {
      onChange(defaultSettings);
    }
  };


  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button 
            size="sm" 
            variant="ghost" 
            onClick={() => setShowPreview(!showPreview)}
            data-testid="button-toggle-preview"
          >
            {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="hidden sm:inline ml-1">{showPreview ? "Hide" : "Show"}</span>
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleReset}
            data-testid="button-reset-settings"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline ml-1">Reset</span>
          </Button>
          {onSaveDraft && (
            <Button 
              size="sm" 
              variant="secondary" 
              onClick={onSaveDraft}
              data-testid="button-save-carousel-draft"
            >
              <Save className="h-4 w-4" />
              <span className="ml-1">Save Draft</span>
            </Button>
          )}
        </div>
      </div>

      {showPreview && (
        <CarouselPreviewFrame videoUrl={videoUrl} testId="carousel-preview-frame">
          <CarouselMockup settings={settings} testId="carousel-preview-element" />
        </CarouselPreviewFrame>
      )}

      <Tabs defaultValue="layout" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-8">
          <TabsTrigger value="layout" className="text-xs gap-1 px-1">
            <Layout className="h-3 w-3" />
            <span className="hidden sm:inline">Layout</span>
          </TabsTrigger>
          <TabsTrigger value="style" className="text-xs gap-1 px-1">
            <Palette className="h-3 w-3" />
            <span className="hidden sm:inline">Style</span>
          </TabsTrigger>
          <TabsTrigger value="fonts" className="text-xs gap-1 px-1">
            <Type className="h-3 w-3" />
            <span className="hidden sm:inline">Fonts</span>
          </TabsTrigger>
          <TabsTrigger value="toggle" className="text-xs gap-1 px-1">
            <ToggleLeft className="h-3 w-3" />
            <span className="hidden sm:inline">Toggle</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="layout" className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Position</Label>
              <Select 
                value={settings.position} 
                onValueChange={(val) => updateSetting("position", val as any)}
              >
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-carousel-position">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAROUSEL_POSITION_OPTIONS.map((pos) => (
                    <SelectItem key={pos} value={pos} className="text-xs">
                      {pos.replace("-", " ").replace(/\b\w/g, l => l.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Button Text</Label>
              <Select 
                value={settings.buttonLabel} 
                onValueChange={(val) => updateSetting("buttonLabel", val as any)}
              >
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-button-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUTTON_LABEL_OPTIONS.map((label) => (
                    <SelectItem key={label} value={label} className="text-xs">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Offset X: {settings.positionOffsetX}px</Label>
              <Slider
                value={[settings.positionOffsetX]}
                onValueChange={(val) => updateSetting("positionOffsetX", val[0])}
                min={-50}
                max={50}
                step={1}
                className="mt-2"
                data-testid="slider-offset-x"
              />
            </div>
            <div>
              <Label className="text-xs">Offset Y: {settings.positionOffsetY}px</Label>
              <Slider
                value={[settings.positionOffsetY]}
                onValueChange={(val) => updateSetting("positionOffsetY", val[0])}
                min={-50}
                max={50}
                step={1}
                className="mt-2"
                data-testid="slider-offset-y"
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="style" className="space-y-3 mt-3">
          {/* ── The panel ─────────────────────────────────────────────────── */}
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Carousel panel</p>
          <div className="grid grid-cols-2 gap-3">
            <ColorField
              label="Carousel background"
              value={settings.carouselBackgroundColor}
              onChange={(v) => updateSetting("carouselBackgroundColor", v)}
              testId="carousel-bg-color"
            />
            <div>
              <Label className="text-xs">Carousel corners: {settings.cornerRadius}px</Label>
              <Slider
                value={[settings.cornerRadius]}
                onValueChange={(val) => updateSetting("cornerRadius", val[0])}
                max={40}
                step={1}
                className="mt-2"
                data-testid="slider-corner-radius"
              />
            </div>

            <div>
              <Label className="text-xs">Carousel opacity: {settings.backgroundOpacity}%</Label>
              <Slider
                value={[settings.backgroundOpacity]}
                onValueChange={(val) => updateSetting("backgroundOpacity", val[0])}
                max={100}
                step={5}
                className="mt-2"
                data-testid="slider-background-opacity"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Button background</Label>
              <div className="flex gap-1 mt-1">
                <Input
                  type="color"
                  value={settings.buttonColor}
                  onChange={(e) => updateSetting("buttonColor", e.target.value)}
                  className="w-8 h-8 p-0.5"
                  data-testid="input-button-color"
                />
                <Input
                  value={settings.buttonColor}
                  onChange={(e) => updateSetting("buttonColor", e.target.value)}
                  className="flex-1 h-8 text-xs"
                  data-testid="input-button-color-hex"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Button text</Label>
              <div className="flex gap-1 mt-1">
                <Input
                  type="color"
                  value={settings.buttonTextColor}
                  onChange={(e) => updateSetting("buttonTextColor", e.target.value)}
                  className="w-8 h-8 p-0.5"
                  data-testid="input-button-text-color"
                />
                <Input
                  value={settings.buttonTextColor}
                  onChange={(e) => updateSetting("buttonTextColor", e.target.value)}
                  className="flex-1 h-8 text-xs"
                  data-testid="input-button-text-color-hex"
                />
              </div>
            </div>
          </div>
        
          {/* ── The button ────────────────────────────────────────────────── */}
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground pt-1">Button</p>
          <div className="grid grid-cols-2 gap-3">
            <ColorField
              label="Button on hover"
              value={settings.buttonHoverColor}
              onChange={(v) => updateSetting("buttonHoverColor", v)}
              testId="button-hover-color"
            />
            <div>
              <Label className="text-xs">Button corners: {settings.buttonCornerRadius >= 999 ? "pill" : `${settings.buttonCornerRadius}px`}</Label>
              {/* Separate from the panel's radius. One value used to drive both,
                  so a square panel forced square buttons. 999 reads as a pill. */}
              <Slider
                value={[Math.min(settings.buttonCornerRadius, 40)]}
                onValueChange={(val) => updateSetting("buttonCornerRadius", val[0] >= 40 ? 999 : val[0])}
                max={40}
                step={1}
                className="mt-2"
                data-testid="slider-button-corner-radius"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Button opacity: {settings.buttonOpacity}%</Label>
            <Slider
              value={[settings.buttonOpacity]}
              onValueChange={(val) => updateSetting("buttonOpacity", val[0])}
              max={100}
              step={5}
              className="mt-2"
              data-testid="slider-button-opacity"
            />
          </div>

          {/* ── Text ──────────────────────────────────────────────────────── */}
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground pt-1">Text</p>
          <div className="grid grid-cols-2 gap-3">
            <ColorField
              label="Brand title"
              value={settings.brandTitleColor}
              onChange={(v) => updateSetting("brandTitleColor", v)}
              testId="brand-title-color"
            />
            <ColorField
              label="Product title"
              value={settings.productTitleColor}
              onChange={(v) => updateSetting("productTitleColor", v)}
              testId="product-title-color"
            />
          </div>
        </TabsContent>

        <TabsContent value="fonts" className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Title Font</Label>
              <Select 
                value={settings.titleFont} 
                onValueChange={(val) => updateSetting("titleFont", val)}
              >
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-title-font">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((font) => (
                    <SelectItem 
                      key={font.value} 
                      value={font.value} 
                      className="text-xs"
                      style={{ fontFamily: getFontFamily(font.value) }}
                    >
                      {font.label}
                    </SelectItem>
                  ))}
                  {/* The brand's own uploads. Listed after the built-ins and
                      labelled, so it is obvious which are theirs. */}
                  {brandFonts.length > 0 && (
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Your fonts
                    </div>
                  )}
                  {brandFonts.map((font) => (
                    <SelectItem key={font.value} value={font.value} className="text-xs">
                      {font.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Button Font</Label>
              <Select 
                value={settings.buttonFont} 
                onValueChange={(val) => updateSetting("buttonFont", val)}
              >
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-button-font">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((font) => (
                    <SelectItem 
                      key={font.value} 
                      value={font.value} 
                      className="text-xs"
                      style={{ fontFamily: getFontFamily(font.value) }}
                    >
                      {font.label}
                    </SelectItem>
                  ))}
                  {/* The brand's own uploads. Listed after the built-ins and
                      labelled, so it is obvious which are theirs. */}
                  {brandFonts.length > 0 && (
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Your fonts
                    </div>
                  )}
                  {brandFonts.map((font) => (
                    <SelectItem key={font.value} value={font.value} className="text-xs">
                      {font.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground">Font Size Scale</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Title: {settings.titleFontSize}%</Label>
                <Slider
                  value={[settings.titleFontSize]}
                  onValueChange={(val) => updateSetting("titleFontSize", val[0])}
                  min={50}
                  max={150}
                  step={5}
                  className="mt-2"
                  data-testid="slider-title-font-size"
                />
              </div>
              <div>
                <Label className="text-xs">Price: {settings.priceFontSize}%</Label>
                <Slider
                  value={[settings.priceFontSize]}
                  onValueChange={(val) => updateSetting("priceFontSize", val[0])}
                  min={50}
                  max={150}
                  step={5}
                  className="mt-2"
                  data-testid="slider-price-font-size"
                />
              </div>
              <div>
                <Label className="text-xs">Button: {settings.buttonFontSize}%</Label>
                <Slider
                  value={[settings.buttonFontSize]}
                  onValueChange={(val) => updateSetting("buttonFontSize", val[0])}
                  min={50}
                  max={150}
                  step={5}
                  className="mt-2"
                  data-testid="slider-button-font-size"
                />
              </div>
            </div>
          </div>

          <div className="p-3 bg-muted/50 rounded-md">
            <p className="text-xs text-muted-foreground mb-2">Preview:</p>
            <p 
              className="font-medium"
              style={{ 
                fontFamily: getFontFamily(settings.titleFont),
                fontSize: `${14 * (settings.titleFontSize / 100)}px`,
              }}
            >
              Title Preview
            </p>
            <p 
              className="text-muted-foreground"
              style={{ fontSize: `${12 * (settings.priceFontSize / 100)}px` }}
            >
              $99.00
            </p>
            <span 
              className="inline-block mt-2 px-2 py-0.5 rounded font-medium"
              style={{ 
                fontFamily: getFontFamily(settings.buttonFont),
                backgroundColor: settings.buttonColor,
                color: settings.buttonTextColor,
                fontSize: `${12 * (settings.buttonFontSize / 100)}px`,
              }}
            >
              {settings.buttonLabel}
            </span>
          </div>
        </TabsContent>

        <TabsContent value="toggle" className="space-y-2 mt-3">
          {/* ── Commerce on or off ────────────────────────────────────────────
              The client asked for this as a radio rather than a switch, because
              the two states are not "on" and "not on" — they are two different
              ways of showing products, and the second needs describing. */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <Label className="text-xs font-medium">Commerce</Label>
            <RadioGroup
              value={settings.commerceEnabled ? "enabled" : "disabled"}
              onValueChange={(v) => updateSetting("commerceEnabled", v === "enabled")}
              className="gap-2"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="enabled" id="commerce-on" className="mt-0.5" data-testid="radio-commerce-enabled" />
                <Label htmlFor="commerce-on" className="text-xs font-normal leading-snug cursor-pointer">
                  <span className="font-medium">Enable commerce</span>
                  <span className="block text-muted-foreground">
                    Products appear over the video while it plays, shoppable as they are shown.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="disabled" id="commerce-off" className="mt-0.5" data-testid="radio-commerce-disabled" />
                <Label htmlFor="commerce-off" className="text-xs font-normal leading-snug cursor-pointer">
                  <span className="font-medium">Disable commerce</span>
                  <span className="block text-muted-foreground">
                    Nothing over the video. A product list appears at the end of playback instead.
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between py-1">
            <Label className="text-xs">Show Thumbnail</Label>
            <Switch
              checked={settings.showThumbnail}
              onCheckedChange={(checked) => updateSetting("showThumbnail", checked)}
              data-testid="switch-show-thumbnail"
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <Label className="text-xs">Show Button</Label>
            <Switch
              checked={settings.showButton}
              onCheckedChange={(checked) => updateSetting("showButton", checked)}
              data-testid="switch-show-button"
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <Label className="text-xs">Show Price</Label>
            <Switch
              checked={settings.showPrice}
              onCheckedChange={(checked) => updateSetting("showPrice", checked)}
              data-testid="switch-show-price"
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <Label className="text-xs">Show Title</Label>
            <Switch
              checked={settings.showTitle}
              onCheckedChange={(checked) => updateSetting("showTitle", checked)}
              data-testid="switch-show-title"
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <Label className="text-xs">Delay Until End</Label>
            <Switch
              checked={settings.delayUntilEnd}
              onCheckedChange={(checked) => updateSetting("delayUntilEnd", checked)}
              data-testid="switch-delay-until-end"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export { defaultSettings as defaultCarouselSettings };

/**
 * A saved brand kit, expressed as carousel settings.
 *
 * The upload modal used to start every video from `defaultSettings`, ignoring
 * the brand kit entirely — so a brand that had chosen its colours, font and
 * button label in Brand Kit still got the generic defaults every time it
 * uploaded, and had to redo the work per video. The Brand Kit page's own copy
 * said "These settings will be applied to all new video uploads", which was
 * simply untrue.
 *
 * A brand kit only covers 11 of the 18 settings — offsets, delay, and the three
 * font sizes have no column — so anything it does not specify falls back to the
 * default rather than being blanked. Null and empty string both count as unset:
 * `default_button_color` is nullable, and empty strings have been observed in
 * this database in the equivalent video column.
 *
 * Lives here, next to CarouselSettings and defaultSettings, so that adding a
 * field to the settings type puts the mapping right under your nose.
 */
export function carouselSettingsFromBrandKit(kit: unknown): CarouselSettings {
  if (!kit || typeof kit !== "object") return defaultSettings;
  const k = kit as Record<string, unknown>;

  const str = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() !== "" ? v : fallback;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === "boolean" ? v : fallback;

  return {
    ...defaultSettings,
    buttonFont: str(k.defaultButtonFont, defaultSettings.buttonFont),
    buttonColor: str(k.defaultButtonColor, defaultSettings.buttonColor),
    buttonTextColor: str(k.defaultButtonTextColor, defaultSettings.buttonTextColor),
    cornerRadius: num(k.defaultCornerRadius, defaultSettings.cornerRadius),
    backgroundOpacity: num(k.defaultBackgroundOpacity, defaultSettings.backgroundOpacity),
    showThumbnail: bool(k.defaultShowThumbnail, defaultSettings.showThumbnail),
    showButton: bool(k.defaultShowButton, defaultSettings.showButton),
    showPrice: bool(k.defaultShowPrice, defaultSettings.showPrice),
    showTitle: bool(k.defaultShowTitle, defaultSettings.showTitle),
    buttonLabel: str(k.defaultButtonLabel, defaultSettings.buttonLabel) as CarouselSettings["buttonLabel"],
    position: str(k.defaultPosition, defaultSettings.position) as CarouselSettings["position"],
  };
}
