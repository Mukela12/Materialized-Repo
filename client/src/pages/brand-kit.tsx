import { useState, useEffect, useRef } from "react";
import { BrandFontUpload, useBrandFontOptions } from "@/components/BrandFontUpload";
import { carouselFromBrandScan, type AppliedChange } from "@shared/brandScan";
import { CarouselMockup } from "@/components/CarouselMockup";
import { ProductCarouselEditor } from "@/components/ProductCarouselEditor";
import {
  CAROUSEL_DEFAULTS, settingsFromBrandKit, brandKitFromSettings,
  type CarouselSettings,
} from "@shared/carousel";
import { CarouselPreviewFrame } from "@/components/CarouselPreviewFrame";
import { carouselPositionStyles, isStackedPosition } from "@/lib/carouselPosition";
import { ensureGoogleFont, fontStack } from "@/lib/fonts";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, serverMessage } from "@/lib/queryClient";
import { 
  Upload, 
  Palette, 
  Type, 
  Eye, 
  Settings, 
  Plus, 
  Trash2, 
  FileText,
  Check,
  Loader2,
  Sparkles,
  Save,
  Undo2,
  ArrowRight,
} from "lucide-react";
import type { BrandKit } from "@shared/schema";
import { BUTTON_LABEL_OPTIONS, CAROUSEL_POSITION_OPTIONS } from "@shared/schema";
import { CAROUSEL_DEFAULT_BUTTON_COLOR, CAROUSEL_DEFAULT_BUTTON_TEXT_COLOR } from "@/lib/carouselDefaults";

interface ColorEntry {
  name: string;
  hex: string;
  cmyk: { c: number; m: number; y: number; k: number };
}

interface FontEntry {
  name: string;
  weight: string;
}

/** What the last scan did, for the summary under the upload box. */
interface ScanOutcome {
  fileName: string;
  found: { colors: number; fonts: number };
  applied: AppliedChange[];
  fontsToUpload: string[];
  /** The carousel as it was before the scan, for Undo. */
  previous: CarouselSettings;
  saved: boolean;
}

/** What the scanner reads. The server checks the same list. */
const SCAN_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
/** Under the server's request limit once the file is encoded for sending. */
const SCAN_MAX_BYTES = 15 * 1024 * 1024;


/**
 * The carousel mock-up, rendered from live settings state.
 *
 * Extracted so it can appear in two places at once: on the Preview tab, and
 * beside the controls on Default Carousel Settings. The client asked for the
 * second — previously you changed a color on one tab and had to switch to
 * another to find out what it did, which is not a preview so much as a memory
 * test. Both instances read the same state, so they cannot drift.
 *
 * `position` moves the strip to the top or bottom of the frame, matching where
 * it will sit over the real video.
 */
/**
 * The Brand Kit carousel preview.
 *
 * It used to honour exactly two positions — `items-start` for "top" and
 * `items-end` for everything else — so picking "bottom-right" drew the carousel
 * bottom-center and picking "left" drew it bottom-center too. The setting saved
 * correctly; only the picture was wrong. The client concluded from it that the
 * positioning options did not exist, which is a fair reading when the only way
 * to check reports no change.
 *
 * It now uses the same positioning function as the editor and the player.
 */
function CarouselPreview({
  settings,
  testId,
  videoUrl,
}: {
  settings: CarouselSettings;
  testId: string;
  /** A real video when there is one — placement against grey is guesswork. */
  videoUrl?: string | null;
}) {
  return (
    <CarouselPreviewFrame
      videoUrl={videoUrl}
      emptyLabel="Upload a video to preview against it"
      testId={`${testId}-frame`}
    >
      {/* Same renderer as the upload editor. This page used to have its own
          copy of the markup, and it drifted every time the carousel changed —
          positions, then colors. */}
      <CarouselMockup settings={settings} scale={1.15} testId={testId} />
    </CarouselPreviewFrame>
  );
}

export default function BrandKitPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("colors");
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [manualColors, setManualColors] = useState<ColorEntry[]>([]);
  const [manualFonts, setManualFonts] = useState<FontEntry[]>([]);
  const [extractedColors, setExtractedColors] = useState<ColorEntry[]>([]);
  const [extractedFonts, setExtractedFonts] = useState<FontEntry[]>([]);
  
  const [newColor, setNewColor] = useState<ColorEntry>({
    name: "",
    hex: "#1351aa",
    cmyk: { c: 0, m: 0, y: 0, k: 0 }
  });
  const [newFont, setNewFont] = useState<FontEntry>({ name: "", weight: "400" });
  const [fontChecking, setFontChecking] = useState(false);
  
  const [carouselSettings, setCarouselSettings] = useState<CarouselSettings>(CAROUSEL_DEFAULTS);

  // The last scan: what it changed on the carousel, and the settings from
  // before it so the change can be undone.
  const [scanResult, setScanResult] = useState<ScanOutcome | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Fonts this account uploaded, so a scan can use them by name.
  const uploadedFonts = useBrandFontOptions();

  const { data: brandKit, isLoading } = useQuery<BrandKit>({
    queryKey: ["/api/brand-kit"],
  });

  // Hydrate state from fetched brand kit data
  useEffect(() => {
    if (brandKit) {
      // Parse and set extracted colors/fonts
      try {
        if (brandKit.extractedColors) {
          setExtractedColors(JSON.parse(brandKit.extractedColors as string));
        }
        if (brandKit.extractedFonts) {
          setExtractedFonts(JSON.parse(brandKit.extractedFonts as string));
        }
        if (brandKit.manualColors) {
          setManualColors(JSON.parse(brandKit.manualColors as string));
        }
        if (brandKit.manualFonts) {
          setManualFonts(JSON.parse(brandKit.manualFonts as string));
        }
      } catch (e) {
        console.error("Error parsing brand kit data:", e);
      }

      /**
       * Hydrate from the row through the shared mapper.
       *
       * This was eleven hand-written lines mapping `default*` columns onto
       * settings, with the reverse written out again in the save handler. Every
       * new setting meant remembering to edit both, and the same list existed a
       * third time in the upload editor. They drifted: the preview here only
       * ever honoured two of the eight carousel positions.
       */
      setCarouselSettings(settingsFromBrandKit(brandKit));
    }
  }, [brandKit]);

  const saveBrandKitMutation = useMutation<any, Error, { data: any; carouselOnly?: boolean }>({
    mutationFn: async ({ data }) => {
      return apiRequest("POST", "/api/brand-kit", data);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-kit"] });
      if (variables.carouselOnly) {
        toast({
          title: "Carousel Defaults Saved",
          description: "Carousel saved as default for all new videos.",
        });
      } else {
        toast({
          title: "Brand Kit Saved",
          description: "Your brand settings have been updated.",
        });
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save brand kit.",
        variant: "destructive",
      });
    },
  });

  const handleSaveCarouselDefault = () => {
    saveBrandKitMutation.mutate({
      carouselOnly: true,
      // Reverse of the same mapping — one list, not two.
      data: brandKitFromSettings(carouselSettings),
    });
  };

  const applyHeroStyle = () => {
    setCarouselSettings((prev) => ({
      ...prev,
      cornerRadius: 16,
      backgroundOpacity: 55,
    }));
  };

  /**
   * Scan a brand guideline file, put what it finds on the default carousel,
   * and save it.
   *
   * The scan used to stop at listing colours and fonts on this page: the
   * carousel kept the platform's blue, and even the list was lost unless Save
   * was pressed. The client (23 Nov 2026): "ensure that it scans and applies
   * these settings to the product carousel, and holds it as a Default setting
   * which can be over-written manually by the user in their Editing Suite."
   *
   * So one upload now does all three. What changed is shown underneath with an
   * Undo, because the scan replaces colours someone may have chosen by hand.
   * A video with its own styling keeps it: only the default moves.
   */
  const scanFile = async (file: File) => {
    const type = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "");
    if (!SCAN_TYPES.includes(type)) {
      toast({ title: "That file can't be scanned", description: "Upload a PDF, PNG, JPG or WebP of your brand guidelines.", variant: "destructive" });
      return;
    }
    if (file.size > SCAN_MAX_BYTES) {
      toast({ title: "That file is too big", description: "The limit is 15 MB. Export a smaller PDF, or just the colour and font pages.", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setIsAnalyzing(true);

    try {
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("The file could not be read"));
        reader.readAsDataURL(file);
      });

      const response = await apiRequest("POST", "/api/analyze-brand-guidelines", { fileData, mimeType: type });
      const result = await response.json();
      const analysis = result?.analysis ?? {};
      const colors = analysis.colors || {};
      const fonts = analysis.fonts || {};

      const safeHexToCmyk = (hex: string | undefined | null) => {
        if (!hex || typeof hex !== "string" || !hex.startsWith("#") || hex.length < 7) {
          return { c: 0, m: 0, y: 0, k: 0 };
        }
        return hexToCmyk(hex);
      };

      const newExtractedColors: ColorEntry[] = [];
      const named: [string, unknown][] = [
        ["Primary", colors.primary], ["Secondary", colors.secondary], ["Accent", colors.accent],
        ["Background", colors.background], ["Text", colors.text],
      ];
      for (const [name, hex] of named) {
        if (hex && typeof hex === "string") newExtractedColors.push({ name, hex, cmyk: safeHexToCmyk(hex) });
      }
      if (Array.isArray(colors.additionalColors)) {
        colors.additionalColors.forEach((hex: string, index: number) => {
          if (hex && typeof hex === "string") {
            newExtractedColors.push({ name: `Additional ${index + 1}`, hex, cmyk: safeHexToCmyk(hex) });
          }
        });
      }

      const newExtractedFonts: FontEntry[] = [];
      if (fonts.headingFont && typeof fonts.headingFont === "string") {
        newExtractedFonts.push({ name: fonts.headingFont, weight: "600" });
      }
      if (fonts.bodyFont && typeof fonts.bodyFont === "string") {
        newExtractedFonts.push({ name: fonts.bodyFont, weight: "400" });
      }
      if (fonts.accentFont && typeof fonts.accentFont === "string") {
        newExtractedFonts.push({ name: fonts.accentFont, weight: "500" });
      }
      if (Array.isArray(fonts.additionalFonts)) {
        fonts.additionalFonts.forEach((fontName: string) => {
          if (fontName && typeof fontName === "string") {
            newExtractedFonts.push({ name: fontName, weight: "400" });
          }
        });
      }

      const previous = carouselSettings;
      const scan = carouselFromBrandScan(
        analysis,
        previous,
        uploadedFonts.map((f) => ({ key: f.value, label: f.label })),
      );

      if (newExtractedColors.length === 0 && newExtractedFonts.length === 0) {
        toast({
          title: "Nothing found in that file",
          description: "No brand colors or fonts could be read from it. Try the pages that show your palette and typography.",
          variant: "destructive",
        });
        return;
      }

      setExtractedColors(newExtractedColors);
      setExtractedFonts(newExtractedFonts);
      setCarouselSettings(scan.settings);

      // Held as the default: saved now, not when someone remembers to press Save.
      let saved = false;
      try {
        await apiRequest("POST", "/api/brand-kit", {
          extractedColors: JSON.stringify(newExtractedColors),
          extractedFonts: JSON.stringify(newExtractedFonts),
          ...brandKitFromSettings(scan.settings),
        });
        saved = true;
        queryClient.invalidateQueries({ queryKey: ["/api/brand-kit"] });
      } catch (saveError) {
        console.error("Saving the scanned brand kit failed:", saveError);
      }

      setScanResult({
        fileName: file.name,
        found: { colors: newExtractedColors.length, fonts: newExtractedFonts.length },
        applied: scan.applied,
        fontsToUpload: scan.fontsToUpload,
        previous,
        saved,
      });

      if (!saved) {
        toast({
          title: "Scanned, but not saved",
          description: "Your colors are on the carousel below. Press Save Brand Kit to keep them.",
          variant: "destructive",
        });
      } else if (scan.applied.length > 0) {
        toast({
          title: "Brand kit applied",
          description: "Your default carousel now uses your brand's colors and fonts.",
        });
      } else {
        toast({
          title: "Brand kit scanned",
          description: `Found ${newExtractedColors.length} colors and ${newExtractedFonts.length} fonts. None could be used on the carousel.`,
        });
      }
    } catch (error) {
      console.error("Error analyzing brand guidelines:", error);
      toast({
        title: "The scan didn't work",
        description: serverMessage(error) || "Your brand guidelines could not be read. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setIsAnalyzing(false);
    }
  };

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // So choosing the same file again scans it again.
    e.target.value = "";
    if (file) void scanFile(file);
  };

  /** Put the carousel back to what it was before the last scan, and save that. */
  const undoScan = async () => {
    if (!scanResult) return;
    setIsUndoing(true);
    try {
      await apiRequest("POST", "/api/brand-kit", brandKitFromSettings(scanResult.previous));
      setCarouselSettings(scanResult.previous);
      setScanResult(null);
      queryClient.invalidateQueries({ queryKey: ["/api/brand-kit"] });
      toast({ title: "Scan undone", description: "Your default carousel is back to how it was." });
    } catch (error) {
      toast({
        title: "Couldn't undo",
        description: serverMessage(error) || "Your default carousel was not changed back. Try again.",
        variant: "destructive",
      });
    } finally {
      setIsUndoing(false);
    }
  };

  const hexToCmyk = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    
    const k = 1 - Math.max(r, g, b);
    const c = k === 1 ? 0 : Math.round(((1 - r - k) / (1 - k)) * 100);
    const m = k === 1 ? 0 : Math.round(((1 - g - k) / (1 - k)) * 100);
    const y = k === 1 ? 0 : Math.round(((1 - b - k) / (1 - k)) * 100);
    
    return { c, m, y, k: Math.round(k * 100) };
  };

  const cmykToHex = (cmyk: { c: number; m: number; y: number; k: number }) => {
    const c = cmyk.c / 100;
    const m = cmyk.m / 100;
    const y = cmyk.y / 100;
    const k = cmyk.k / 100;
    
    const r = Math.round(255 * (1 - c) * (1 - k));
    const g = Math.round(255 * (1 - m) * (1 - k));
    const b = Math.round(255 * (1 - y) * (1 - k));
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  };

  const addManualColor = () => {
    if (!newColor.name) {
      toast({ title: "Error", description: "Please enter a color name", variant: "destructive" });
      return;
    }
    setManualColors([...manualColors, { ...newColor }]);
    setNewColor({ name: "", hex: "#1351aa", cmyk: { c: 0, m: 0, y: 0, k: 0 } });
  };

  /**
   * Add a custom font, and only accept it if it can actually render.
   *
   * This previously stored whatever name was typed. The name was then used as a
   * CSS font-family with nothing ever loading a font by that name, so it always
   * fell back silently — a font called "Hello" saved successfully and styled
   * nothing, which is indistinguishable from the feature being broken.
   *
   * Now the name is looked up on Google Fonts and verified with the browser's
   * own font check before being saved. A name Google does not publish returns a
   * stylesheet that loads fine but defines nothing, so the check is on whether
   * the FONT is usable, not on whether the request succeeded.
   */
  const addManualFont = async () => {
    const name = newFont.name.trim();
    if (!name) {
      toast({ title: "Error", description: "Please enter a font name", variant: "destructive" });
      return;
    }
    if (manualFonts.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: "Already added", description: `"${name}" is already in your brand kit.` });
      return;
    }

    setFontChecking(true);
    const available = await ensureGoogleFont(name);
    setFontChecking(false);

    if (!available) {
      toast({
        title: "Font not found",
        description: `"${name}" isn't available on Google Fonts, so it can't be applied. Check the spelling, or pick one from fonts.google.com.`,
        variant: "destructive",
      });
      return;
    }

    setManualFonts([...manualFonts, { ...newFont, name }]);
    setNewFont({ name: "", weight: "400" });
    toast({ title: "Font added", description: `"${name}" is loaded and ready to use.` });
  };

  const removeColor = (index: number, type: "extracted" | "manual") => {
    if (type === "extracted") {
      setExtractedColors(extractedColors.filter((_, i) => i !== index));
    } else {
      setManualColors(manualColors.filter((_, i) => i !== index));
    }
  };

  const removeFont = (index: number, type: "extracted" | "manual") => {
    if (type === "extracted") {
      setExtractedFonts(extractedFonts.filter((_, i) => i !== index));
    } else {
      setManualFonts(manualFonts.filter((_, i) => i !== index));
    }
  };

  const handleSave = () => {
    saveBrandKitMutation.mutate({
      data: {
        extractedFonts: JSON.stringify(extractedFonts),
        extractedColors: JSON.stringify(extractedColors),
        manualFonts: JSON.stringify(manualFonts),
        manualColors: JSON.stringify(manualColors),
        // Every carousel setting, through the one mapping. This list was
        // written out by hand and had stopped at eleven of them.
        ...brandKitFromSettings(carouselSettings),
      },
    });
  };

  const allColors = [...extractedColors, ...manualColors];
  const allFonts = [...extractedFonts, ...manualFonts];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight" data-testid="text-brand-kit-title">
            Brand Kit
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your brand colors, fonts, and default carousel styling
          </p>
        </div>
        <Button 
          onClick={handleSave}
          className="rounded-full gap-2"
          disabled={saveBrandKitMutation.isPending}
          data-testid="button-save-brand-kit"
        >
          {saveBrandKitMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Save Brand Kit
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 shrink-0" />
            Upload Brand Guidelines
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Your colors and fonts are read from the file, put on your product carousel and saved as your default.
          </p>
        </CardHeader>
        <CardContent>
          <div
            className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors sm:p-8 ${
              isDragging ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={(e) => { e.preventDefault(); if (!isAnalyzing) setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              // Without this a dropped PDF opens in the tab and the page is gone.
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file && !isAnalyzing) void scanFile(file);
            }}
            data-testid="brand-kit-drop-zone"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
              onChange={handlePdfUpload}
              className="hidden"
              id="pdf-upload"
              data-testid="input-pdf-upload"
            />
            <div className="flex flex-col items-center gap-3" aria-live="polite">
              {isAnalyzing ? (
                <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              )}
              <div>
                <p className="font-medium">
                  {isAnalyzing ? "Reading your brand guidelines" : "Drop your brand guidelines here"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {isAnalyzing
                    ? "This takes up to a minute. Keep this page open."
                    : "PDF, PNG or JPG, up to 15 MB"}
                </p>
              </div>
              {!isAnalyzing && (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-browse-pdf"
                >
                  Browse Files
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {scanResult && (
        <Card data-testid="scan-result">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
                  {scanResult.applied.length > 0
                    ? (scanResult.saved ? "Applied to your default carousel" : "On your carousel, not saved yet")
                    : "Scanned, nothing to apply"}
                </CardTitle>
                <p className="mt-1 truncate text-sm text-muted-foreground" data-testid="scan-result-source">
                  {scanResult.found.colors} {scanResult.found.colors === 1 ? "color" : "colors"} and{" "}
                  {scanResult.found.fonts} {scanResult.found.fonts === 1 ? "font" : "fonts"} found in {scanResult.fileName}
                </p>
              </div>
              {scanResult.applied.length > 0 && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full gap-2"
                    onClick={undoScan}
                    disabled={isUndoing}
                    data-testid="button-undo-scan"
                  >
                    {isUndoing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                    Undo
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full gap-2"
                    onClick={() => setActiveTab("carousel")}
                    data-testid="button-fine-tune-scan"
                  >
                    Fine-tune
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {scanResult.applied.length > 0 ? (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <ul className="grid grid-cols-2 content-start gap-2" data-testid="scan-result-changes">
                  {scanResult.applied.map((change) => (
                    <li
                      key={change.field}
                      className="flex min-w-0 items-center gap-2.5 rounded-lg border p-2.5"
                      data-testid={`scan-change-${change.field}`}
                    >
                      {change.kind === "color" ? (
                        <span
                          className="h-7 w-7 shrink-0 rounded-md border"
                          style={{ backgroundColor: change.value }}
                          aria-hidden="true"
                        />
                      ) : (
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold"
                          style={{ fontFamily: fontStack(String(carouselSettings[change.field])) }}
                          aria-hidden="true"
                        >
                          Aa
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">{change.label}</span>
                        <span className={`block truncate text-xs text-muted-foreground ${change.kind === "color" ? "font-mono" : ""}`}>
                          {change.value}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div>
                  <CarouselPreview settings={carouselSettings} testId="scan-result-preview" />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                The file's colors and fonts are listed below. None of them could be used on the carousel, so it is unchanged.
              </p>
            )}
            {scanResult.fontsToUpload.length > 0 && (
              <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="scan-result-fonts-to-upload">
                Your guidelines use {scanResult.fontsToUpload.join(" and ")}. Upload the .otf or .ttf under Fonts, then scan again to put {scanResult.fontsToUpload.length === 1 ? "it" : "them"} on the carousel.
              </p>
            )}
            {scanResult.applied.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Every video uses this default unless you have styled that video yourself. You can still change any one video in its editor.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 rounded-full">
          <TabsTrigger value="colors" className="rounded-full gap-2" data-testid="tab-colors">
            <Palette className="hidden h-4 w-4 sm:block" />
            <span className="text-xs sm:text-sm">Colors</span>
          </TabsTrigger>
          <TabsTrigger value="fonts" className="rounded-full gap-2" data-testid="tab-fonts">
            <Type className="hidden h-4 w-4 sm:block" />
            <span className="text-xs sm:text-sm">Fonts</span>
          </TabsTrigger>
          <TabsTrigger value="carousel" className="rounded-full gap-2" data-testid="tab-carousel">
            <Settings className="hidden h-4 w-4 sm:block" />
            <span className="text-xs sm:text-sm">Carousel</span>
          </TabsTrigger>
          <TabsTrigger value="preview" className="rounded-full gap-2" data-testid="tab-preview">
            <Eye className="hidden h-4 w-4 sm:block" />
            <span className="text-xs sm:text-sm">Preview</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="colors" className="mt-6 space-y-6">
          {extractedColors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Extracted Colors</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {extractedColors.map((color, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 rounded-lg border">
                      <div 
                        className="w-12 h-12 rounded-lg border"
                        style={{ backgroundColor: color.hex }}
                        data-testid={`color-swatch-extracted-${index}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{color.name}</p>
                        <p className="text-xs text-muted-foreground">{color.hex}</p>
                        <p className="text-xs text-muted-foreground">
                          C{color.cmyk.c} M{color.cmyk.m} Y{color.cmyk.y} K{color.cmyk.k}
                        </p>
                      </div>
                      <Button 
                        size="icon" 
                        variant="ghost"
                        onClick={() => removeColor(index, "extracted")}
                        data-testid={`button-remove-extracted-color-${index}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manual Colors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {manualColors.map((color, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 rounded-lg border">
                    <div 
                      className="w-12 h-12 rounded-lg border"
                      style={{ backgroundColor: color.hex }}
                      data-testid={`color-swatch-manual-${index}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{color.name}</p>
                      <p className="text-xs text-muted-foreground">{color.hex}</p>
                    </div>
                    <Button 
                      size="icon" 
                      variant="ghost"
                      onClick={() => removeColor(index, "manual")}
                      data-testid={`button-remove-manual-color-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="border-t pt-4 mt-4">
                <p className="font-medium mb-4">Add New Color</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={newColor.name}
                      onChange={(e) => setNewColor({ ...newColor, name: e.target.value })}
                      placeholder="Primary"
                      data-testid="input-color-name"
                    />
                  </div>
                  <div>
                    <Label>Hex Color</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={newColor.hex}
                        onChange={(e) => setNewColor({ 
                          ...newColor, 
                          hex: e.target.value,
                          cmyk: hexToCmyk(e.target.value)
                        })}
                        className="w-12 h-10 p-1"
                        data-testid="input-color-picker"
                      />
                      <Input
                        value={newColor.hex}
                        onChange={(e) => setNewColor({ 
                          ...newColor, 
                          hex: e.target.value,
                          cmyk: hexToCmyk(e.target.value)
                        })}
                        placeholder="#1351aa"
                        data-testid="input-color-hex"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 sm:col-span-2">
                    <div>
                      <Label>C</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={newColor.cmyk.c}
                        onChange={(e) => {
                          const cmyk = { ...newColor.cmyk, c: parseInt(e.target.value) || 0 };
                          setNewColor({ ...newColor, cmyk, hex: cmykToHex(cmyk) });
                        }}
                        data-testid="input-cmyk-c"
                      />
                    </div>
                    <div>
                      <Label>M</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={newColor.cmyk.m}
                        onChange={(e) => {
                          const cmyk = { ...newColor.cmyk, m: parseInt(e.target.value) || 0 };
                          setNewColor({ ...newColor, cmyk, hex: cmykToHex(cmyk) });
                        }}
                        data-testid="input-cmyk-m"
                      />
                    </div>
                    <div>
                      <Label>Y</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={newColor.cmyk.y}
                        onChange={(e) => {
                          const cmyk = { ...newColor.cmyk, y: parseInt(e.target.value) || 0 };
                          setNewColor({ ...newColor, cmyk, hex: cmykToHex(cmyk) });
                        }}
                        data-testid="input-cmyk-y"
                      />
                    </div>
                    <div>
                      <Label>K</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={newColor.cmyk.k}
                        onChange={(e) => {
                          const cmyk = { ...newColor.cmyk, k: parseInt(e.target.value) || 0 };
                          setNewColor({ ...newColor, cmyk, hex: cmykToHex(cmyk) });
                        }}
                        data-testid="input-cmyk-k"
                      />
                    </div>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addManualColor} className="w-full rounded-full gap-2" data-testid="button-add-color">
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fonts" className="mt-6 space-y-6">
          {/* The client's request: "Font upload must allow for the .otf or
              .ttf". Placed first, above the Google-Fonts-by-name control that
              was previously the only option — a brand's own licensed face is
              the answer they actually want. */}
          <Card>
            <CardContent className="pt-6">
              <BrandFontUpload />
            </CardContent>
          </Card>

          {extractedFonts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Extracted Fonts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {extractedFonts.map((font, index) => (
                    <div key={index} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="font-medium" style={{ fontFamily: font.name }}>{font.name}</p>
                        <p className="text-sm text-muted-foreground">Weight: {font.weight}</p>
                      </div>
                      <Button 
                        size="icon" 
                        variant="ghost"
                        onClick={() => removeFont(index, "extracted")}
                        data-testid={`button-remove-extracted-font-${index}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manual Fonts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {manualFonts.map((font, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="font-medium">{font.name}</p>
                      <p className="text-sm text-muted-foreground">Weight: {font.weight}</p>
                    </div>
                    <Button 
                      size="icon" 
                      variant="ghost"
                      onClick={() => removeFont(index, "manual")}
                      data-testid={`button-remove-manual-font-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="border-t pt-4 mt-4">
                <p className="font-medium mb-4">Add New Font</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Label>Font Name</Label>
                    <Input
                      value={newFont.name}
                      onChange={(e) => setNewFont({ ...newFont, name: e.target.value })}
                      placeholder="Inter, Montserrat, etc."
                      data-testid="input-font-name"
                    />
                  </div>
                  <div>
                    <Label>Weight</Label>
                    <Select 
                      value={newFont.weight} 
                      onValueChange={(val) => setNewFont({ ...newFont, weight: val })}
                    >
                      <SelectTrigger data-testid="select-font-weight">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="100">100 - Thin</SelectItem>
                        <SelectItem value="200">200 - Extra Light</SelectItem>
                        <SelectItem value="300">300 - Light</SelectItem>
                        <SelectItem value="400">400 - Regular</SelectItem>
                        <SelectItem value="500">500 - Medium</SelectItem>
                        <SelectItem value="600">600 - Semi Bold</SelectItem>
                        <SelectItem value="700">700 - Bold</SelectItem>
                        <SelectItem value="800">800 - Extra Bold</SelectItem>
                        <SelectItem value="900">900 - Black</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addManualFont} className="w-full rounded-full gap-2" data-testid="button-add-font">
                      <Plus className="h-4 w-4" />
                      Add Font
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="carousel" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <CardTitle>Default Carousel Settings</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    These settings will be applied to all new video uploads
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full gap-2"
                    onClick={applyHeroStyle}
                    data-testid="button-hero-style"
                  >
                    <Sparkles className="h-4 w-4" />
                    Hero Style
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-full gap-2"
                    onClick={handleSaveCarouselDefault}
                    disabled={saveBrandKitMutation.isPending}
                    data-testid="button-save-carousel-default"
                  >
                    {saveBrandKitMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save as Default
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* ── ONE set of controls, shared with the upload editor ────────
                  This page had its own copy: eleven controls, hand-written,
                  missing every setting added since. The client's sidebar sends
                  her HERE for "Product Carousel Styling", so a control added to
                  the upload editor and not to this page is a control she cannot
                  reach. Rendering the same component removes the possibility.

                  The preview beside it reads the same state, so changing a
                  color shows its effect without switching tabs — which is what
                  she asked for and why the second preview exists at all. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ProductCarouselEditor
                  settings={carouselSettings}
                  onChange={setCarouselSettings}
                  compact
                />
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Live preview</p>
                  <CarouselPreview settings={carouselSettings} testId="carousel-live-preview" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Carousel Preview</CardTitle>
              <p className="text-sm text-muted-foreground">
                Preview how your product carousel will appear on videos
              </p>
            </CardHeader>
            <CardContent>
              <CarouselPreview settings={carouselSettings} testId="carousel-preview" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
