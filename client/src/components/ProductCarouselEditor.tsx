import { useState } from "react";
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

export interface CarouselSettings {
  position: typeof CAROUSEL_POSITION_OPTIONS[number];
  positionOffsetX: number;
  positionOffsetY: number;
  delayUntilEnd: boolean;
  cornerRadius: number;
  backgroundOpacity: number;
  showThumbnail: boolean;
  showButton: boolean;
  showPrice: boolean;
  showTitle: boolean;
  buttonLabel: typeof BUTTON_LABEL_OPTIONS[number];
  buttonColor: string;
  buttonTextColor: string;
  buttonFont: string;
  titleFont: string;
  titleFontSize: number;
  priceFontSize: number;
  buttonFontSize: number;
}

interface ProductCarouselEditorProps {
  settings: CarouselSettings;
  onChange: (settings: CarouselSettings) => void;
  onReset?: () => void;
  onSaveDraft?: () => void;
  compact?: boolean;
  videoUrl?: string;
}

const defaultSettings: CarouselSettings = {
  position: "bottom",
  positionOffsetX: 0,
  positionOffsetY: 0,
  delayUntilEnd: false,
  cornerRadius: 16,
  backgroundOpacity: 55,
  showThumbnail: true,
  showButton: true,
  showPrice: true,
  showTitle: true,
  buttonLabel: "BUY NOW",
  buttonColor: "#677A67",
  buttonTextColor: "#FFFFFF",
  buttonFont: "system",
  titleFont: "system",
  titleFontSize: 100,
  priceFontSize: 100,
  buttonFontSize: 100,
};

const getFontFamily = (font: string): string => {
  const fontMap: Record<string, string> = {
    "system": "system-ui, -apple-system, sans-serif",
    "public-pixel": "'Public Pixel', monospace",
    "inter": "'Inter', sans-serif",
    "roboto": "'Roboto', sans-serif",
    "poppins": "'Poppins', sans-serif",
    "montserrat": "'Montserrat', sans-serif",
    "playfair": "'Playfair Display', serif",
    "oswald": "'Oswald', sans-serif",
  };
  return fontMap[font] || fontMap["system"];
};

export function ProductCarouselEditor({
  settings,
  onChange,
  onReset,
  onSaveDraft,
  compact = false,
  videoUrl,
}: ProductCarouselEditorProps) {
  const [showPreview, setShowPreview] = useState(true);

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

  const getPositionStyles = () => {
    const base: React.CSSProperties = {
      position: 'absolute',
      zIndex: 10,
    };
    
    const offsetX = settings.positionOffsetX;
    const offsetY = settings.positionOffsetY;
    
    switch (settings.position) {
      case 'top':
        return { ...base, top: `${8 + offsetY}px`, left: '50%', transform: 'translateX(-50%)' };
      case 'bottom':
        return { ...base, bottom: `${8 - offsetY}px`, left: '50%', transform: 'translateX(-50%)' };
      case 'left':
        return { ...base, left: `${8 + offsetX}px`, top: '50%', transform: 'translateY(-50%)' };
      case 'right':
        return { ...base, right: `${8 - offsetX}px`, top: '50%', transform: 'translateY(-50%)' };
      case 'top-left':
        return { ...base, top: `${8 + offsetY}px`, left: `${8 + offsetX}px` };
      case 'top-right':
        return { ...base, top: `${8 + offsetY}px`, right: `${8 - offsetX}px` };
      case 'bottom-left':
        return { ...base, bottom: `${8 - offsetY}px`, left: `${8 + offsetX}px` };
      case 'bottom-right':
        return { ...base, bottom: `${8 - offsetY}px`, right: `${8 - offsetX}px` };
      default:
        return { ...base, bottom: '8px', left: '50%', transform: 'translateX(-50%)' };
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
        <div className="relative bg-muted rounded-lg overflow-hidden aspect-video">
          {videoUrl ? (
            <video
              src={videoUrl}
              className="absolute inset-0 w-full h-full object-cover"
              autoPlay
              muted
              loop
              playsInline
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
              Video Preview
            </div>
          )}
          
          <div 
            className="p-2 flex items-center gap-2 max-w-[200px]"
            style={{
              ...getPositionStyles(),
              backgroundColor: `rgba(0,0,0,${settings.backgroundOpacity / 100})`,
              borderRadius: `${settings.cornerRadius}px`,
            }}
            data-testid="carousel-preview-element"
          >
            {settings.showThumbnail && (
              <div className="w-8 h-8 bg-background/50 rounded flex items-center justify-center flex-shrink-0">
                <div className="w-5 h-5 bg-primary/20 rounded" />
              </div>
            )}
            <div className="flex-1 text-white min-w-0">
              {settings.showTitle && (
                <p 
                  className="font-medium truncate"
                  style={{ 
                    fontFamily: getFontFamily(settings.titleFont),
                    fontSize: `${12 * (settings.titleFontSize / 100)}px`,
                  }}
                >
                  Product
                </p>
              )}
              {settings.showPrice && (
                <p 
                  className="opacity-80"
                  style={{ fontSize: `${10 * (settings.priceFontSize / 100)}px` }}
                >
                  $99
                </p>
              )}
            </div>
            {settings.showButton && (
              <button 
                className="rounded-full px-2 py-1 flex-shrink-0 font-medium"
                style={{
                  backgroundColor: settings.buttonColor,
                  color: settings.buttonTextColor,
                  fontFamily: getFontFamily(settings.buttonFont),
                  fontSize: `${9 * (settings.buttonFontSize / 100)}px`,
                }}
                data-testid="button-preview-cta"
              >
                {settings.buttonLabel}
              </button>
            )}
          </div>
        </div>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Corner Radius: {settings.cornerRadius}px</Label>
              <Slider
                value={[settings.cornerRadius]}
                onValueChange={(val) => updateSetting("cornerRadius", val[0])}
                max={24}
                step={1}
                className="mt-2"
                data-testid="slider-corner-radius"
              />
            </div>

            <div>
              <Label className="text-xs">Opacity: {settings.backgroundOpacity}%</Label>
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
              <Label className="text-xs">Button Color</Label>
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
              <Label className="text-xs">Text Color</Label>
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
