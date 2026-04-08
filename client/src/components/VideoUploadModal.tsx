import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Upload, X, Check, ChevronsUpDown, Plus, Send, Loader2, Wand2,
  Save, Mail, ScanSearch, CheckCircle2, AlertCircle, Package, ArrowRight, Settings2, Lock, Zap,
} from "lucide-react";
import { Link } from "wouter";
import { Switch } from "@/components/ui/switch";
import { useUpload } from "@/hooks/use-upload";
import { ProductCarouselEditor, defaultCarouselSettings, type CarouselSettings } from "@/components/ProductCarouselEditor";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Brand } from "@shared/schema";

const videoUploadSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  brandIds: z.array(z.string()).optional(),
});

const referralSchema = z.object({
  brandName: z.string().min(1, "Brand name is required"),
  prContactName: z.string().min(1, "Contact name is required"),
  prContactEmail: z.string().email("Valid email required"),
  productCategory: z.string().optional(),
  message: z.string().optional(),
});

type VideoUploadForm = z.infer<typeof videoUploadSchema>;
type ReferralForm = z.infer<typeof referralSchema>;

type DetectionResult = {
  id: string;
  productId: string;
  brandId: string;
  confidence: string;
  product?: { name: string; category: string | null };
  brand?: { name: string };
};

type DetectionJob = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  results: DetectionResult[];
};

interface VideoUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brands: Brand[];
  onUpload: (data: VideoUploadForm & { videoUrl: string; selectedBrands: string[]; carouselSettings: CarouselSettings }) => Promise<void>;
  onReferBrand: (data: ReferralForm) => Promise<void>;
}

type Step = "upload" | "details" | "detecting" | "carousel" | "refer";

const SCAN_MESSAGES = [
  "Uploading video metadata…",
  "Scanning for brand products…",
  "Analysing product placements…",
  "Matching against inventory…",
  "Building product carousel…",
  "Finalising detections…",
];

export function VideoUploadModal({
  open,
  onOpenChange,
  brands,
  onUpload,
  onReferBrand,
}: VideoUploadModalProps) {
  const [step, setStep] = useState<Step>("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [createdVideoId, setCreatedVideoId] = useState<string | null>(null);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [brandPopoverOpen, setBrandPopoverOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [enableAiDetection, setEnableAiDetection] = useState(true);
  const [carouselSettings, setCarouselSettings] = useState<CarouselSettings>(defaultCarouselSettings);
  const [detectionJob, setDetectionJob] = useState<DetectionJob | null>(null);
  const [scanMsgIdx, setScanMsgIdx] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const scanInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  const { data: trialStatus } = useQuery<{
    hasActiveSubscription: boolean;
    videoCount: number;
    isTrialExhausted: boolean;
    trialVideosAllowed: number;
    trialMaxDurationSeconds: number;
  }>({
    queryKey: ["/api/users/me/trial-status"],
    enabled: open,
  });

  const { uploadFile, isUploading, progress } = useUpload({
    onSuccess: (response) => {
      setVideoUrl(response.objectUrl);
      setStep("details");
    },
  });

  // Draft restore
  useEffect(() => {
    if (open) {
      const savedDraft = localStorage.getItem("videoDraft");
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft);
          if (draft.videoUrl) {
            setVideoUrl(draft.videoUrl);
            setSelectedBrands(draft.selectedBrands || []);
            setCarouselSettings(draft.carouselSettings || defaultCarouselSettings);
            setEnableAiDetection(draft.enableAiDetection ?? true);
            form.setValue("title", draft.title || "");
            form.setValue("description", draft.description || "");
            setStep("details");
            toast({
              title: "Draft Restored",
              description: "Your previous draft has been restored.",
            });
          } else {
            localStorage.removeItem("videoDraft");
          }
        } catch {
          localStorage.removeItem("videoDraft");
        }
      }
    }
  }, [open]);

  // Cleanup intervals on unmount / close
  useEffect(() => {
    if (!open) {
      clearIntervals();
    }
  }, [open]);

  const clearIntervals = () => {
    if (scanInterval.current) clearInterval(scanInterval.current);
    if (pollInterval.current) clearInterval(pollInterval.current);
    scanInterval.current = null;
    pollInterval.current = null;
  };

  const form = useForm<VideoUploadForm>({
    resolver: zodResolver(videoUploadSchema),
    defaultValues: { title: "", description: "", brandIds: [] },
  });

  const referralForm = useForm<ReferralForm>({
    resolver: zodResolver(referralSchema),
    defaultValues: {
      brandName: "",
      prContactName: "",
      prContactEmail: "",
      productCategory: "",
      message: "",
    },
  });

  const getVideoDuration = (file: File): Promise<number> =>
    new Promise((resolve) => {
      const el = document.createElement("video");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        URL.revokeObjectURL(el.src);
        resolve(el.duration);
      };
      el.onerror = () => resolve(0);
      el.src = URL.createObjectURL(file);
    });

  const validateAndUpload = async (file: File) => {
    const duration = await getVideoDuration(file);
    setVideoDurationSeconds(Math.round(duration));

    // Trial restriction: max 120 seconds
    if (trialStatus && !trialStatus.hasActiveSubscription) {
      const maxSecs = trialStatus.trialMaxDurationSeconds ?? 120;
      if (duration > maxSecs) {
        toast({
          title: "Video too long for free trial",
          description: `Your free trial is limited to ${maxSecs / 60} minute${maxSecs / 60 !== 1 ? "s" : ""}. Subscribe to upload longer videos.`,
          variant: "destructive",
        });
        return;
      }
    }

    setVideoFile(file);
    await uploadFile(file);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await validateAndUpload(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("video/")) await validateAndUpload(file);
  };

  const toggleBrand = (brandId: string) => {
    setSelectedBrands((prev) =>
      prev.includes(brandId) ? prev.filter((id) => id !== brandId) : [...prev, brandId]
    );
  };

  // Create video record (draft) and start AI detection
  const startDetectionMutation = useMutation({
    mutationFn: async (formData: VideoUploadForm) => {
      // 1. Create the video record
      const createRes = await apiRequest("POST", "/api/videos", {
        title: formData.title,
        description: formData.description || "",
        videoUrl,
        brandIds: selectedBrands,
        status: "draft",
        durationSeconds: videoDurationSeconds ?? undefined,
      });
      const video = await createRes.json();
      setCreatedVideoId(video.id);

      // 2. Trigger AI detection
      const detectRes = await apiRequest("POST", `/api/videos/${video.id}/detections`, {
        brandIds: selectedBrands,
        videoTitle: formData.title,
        videoDescription: formData.description || "",
      });
      const job: DetectionJob = await detectRes.json();
      return { video, job };
    },
    onSuccess: ({ video, job }) => {
      setDetectionJob({ ...job, results: [] });
      setStep("detecting");
      startScanAnimation();
      startPolling(video.id);
    },
    onError: () => {
      toast({ title: "Detection failed", description: "Could not start AI scan. Please try again.", variant: "destructive" });
    },
  });

  const startScanAnimation = () => {
    setScanMsgIdx(0);
    setScanProgress(0);
    scanInterval.current = setInterval(() => {
      setScanMsgIdx((i) => (i + 1) % SCAN_MESSAGES.length);
      setScanProgress((p) => Math.min(p + 12, 90));
    }, 1400);
  };

  const startPolling = (videoId: string) => {
    pollInterval.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/${videoId}/detections`);
        const job: DetectionJob = await res.json();
        if (job.status === "completed" || job.status === "failed") {
          clearIntervals();
          setScanProgress(100);
          setDetectionJob(job);
          setTimeout(() => setStep("carousel"), 600);
        }
      } catch {
        // keep polling
      }
    }, 1500);
  };

  const handleDetailsSubmit = async (formData: VideoUploadForm) => {
    if (enableAiDetection && selectedBrands.length > 0) {
      startDetectionMutation.mutate(formData);
    } else {
      // Skip detection — create video and go straight to carousel
      const createRes = await apiRequest("POST", "/api/videos", {
        title: formData.title,
        description: formData.description || "",
        videoUrl,
        brandIds: selectedBrands,
        status: "draft",
        durationSeconds: videoDurationSeconds ?? undefined,
      });
      const video = await createRes.json();
      setCreatedVideoId(video.id);
      setStep("carousel");
    }
  };

  const handlePublish = async () => {
    setIsSubmitting(true);
    try {
      if (createdVideoId) {
        // PATCH existing video draft with final settings
        await apiRequest("PATCH", `/api/videos/${createdVideoId}`, {
          status: "published",
          carouselSettings: JSON.stringify(carouselSettings),
        });
        toast({ title: "Video Published!", description: "Your video with product carousel is now live." });
      } else {
        // Fallback if no video was created
        const formData = form.getValues();
        await onUpload({
          ...formData,
          videoUrl,
          selectedBrands,
          carouselSettings,
        });
      }
      localStorage.removeItem("videoDraft");
      resetAndClose();
    } catch {
      toast({ title: "Publish failed", description: "Could not publish video.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const outreachMutation = useMutation({
    mutationFn: (payload: object) => apiRequest("POST", "/api/brand-outreach", payload),
    onSuccess: () => {
      toast({ title: "Outreach Sent!", description: "Your message has been sent to the brand's PR contact." });
      setStep("details");
      referralForm.reset();
    },
    onError: () => {
      toast({ title: "Failed to Send", description: "Could not send the outreach email.", variant: "destructive" });
    },
  });

  const handleReferralSubmit = async (data: ReferralForm) => {
    if (videoUrl) {
      const videoTitle = form.getValues("title") || "Untitled Video";
      outreachMutation.mutate({
        brandName: data.brandName,
        prContactName: data.prContactName,
        prContactEmail: data.prContactEmail,
        creatorMessage: data.message,
        videoUrl,
        videoTitle,
      });
    } else {
      setIsSubmitting(true);
      try {
        await onReferBrand(data);
        setStep("details");
        referralForm.reset();
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleSaveDraft = async () => {
    if (!videoUrl) {
      toast({ title: "Cannot Save Draft", description: "Please upload a video first.", variant: "destructive" });
      return;
    }
    const formData = form.getValues();
    if (!formData.title?.trim()) {
      toast({ title: "Campaign Title Required", description: "Please enter a campaign title before saving.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const createRes = await apiRequest("POST", "/api/videos", {
        title: formData.title.trim(),
        description: formData.description || "",
        videoUrl,
        brandIds: selectedBrands,
        status: "draft",
        durationSeconds: videoDurationSeconds ?? undefined,
      });
      const video = await createRes.json();
      setCreatedVideoId(video.id);
      localStorage.removeItem("videoDraft");
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      toast({ title: "Draft Saved", description: `"${formData.title.trim()}" has been saved to your campaigns.` });
      resetAndClose();
    } catch {
      toast({ title: "Save Failed", description: "Could not save draft. Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetAndClose = () => {
    clearIntervals();
    setStep("upload");
    setVideoFile(null);
    setVideoUrl("");
    setVideoDurationSeconds(null);
    setCreatedVideoId(null);
    setSelectedBrands([]);
    setEnableAiDetection(true);
    setCarouselSettings(defaultCarouselSettings);
    setDetectionJob(null);
    setScanProgress(0);
    setScanMsgIdx(0);
    form.reset();
    referralForm.reset();
    onOpenChange(false);
  };

  const stepTitles: Record<Step, string> = {
    upload: "Upload Video",
    details: "Campaign Details",
    detecting: "AI Product Scan",
    carousel: "Carousel Settings",
    refer: videoUrl ? "Brand Outreach" : "Refer a Brand",
  };

  const stepDescriptions: Record<Step, string> = {
    upload: "Upload your video to start building a shoppable campaign",
    details: "Name your campaign, select featured brands and enable AI product detection",
    detecting: "Gemini AI is scanning your video for brand products",
    carousel: "Customise how the product carousel appears on your video",
    refer: videoUrl
      ? "Can't find a brand? Send them a direct outreach email with your video"
      : "Can't find a brand? Refer them to join the platform",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{stepTitles[step]}</DialogTitle>
          <DialogDescription>{stepDescriptions[step]}</DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        {step !== "refer" && (
          <div className="flex items-center gap-1.5 mb-2">
            {(["upload", "details", "detecting", "carousel"] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className={`h-2 w-2 rounded-full transition-colors ${
                  s === step ? "bg-primary" :
                  (["upload", "details", "detecting", "carousel"].indexOf(step) > i) ? "bg-primary/40" :
                  "bg-muted"
                }`} />
                {i < 3 && <div className="h-px w-6 bg-muted" />}
              </div>
            ))}
            <span className="text-xs text-muted-foreground ml-1 capitalize">{step}</span>
          </div>
        )}

        {/* ── STEP: UPLOAD ── */}
        {step === "upload" && (
          <>
            {/* Trial exhausted gate */}
            {trialStatus?.isTrialExhausted && !trialStatus.hasActiveSubscription ? (
              <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-8 text-center space-y-4">
                <div className="h-14 w-14 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                  <Lock className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="font-semibold text-base text-foreground">Free trial limit reached</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto leading-relaxed">
                    You've used your 1 free trial video. Subscribe to unlock unlimited uploads, longer videos, and all pro features.
                  </p>
                </div>
                <Link href="/creator/settings/subscription" onClick={() => onOpenChange(false)}>
                  <Button data-testid="button-upgrade-from-modal" className="rounded-full gap-2">
                    <Zap className="h-4 w-4" />
                    See plans & subscribe
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                {/* Trial info banner */}
                {trialStatus && !trialStatus.hasActiveSubscription && (
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs text-muted-foreground mb-1">
                    <Lock className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Free trial:</strong> 1 video allowed, max 2 minutes. Upload will be blocked if the video exceeds 2 minutes.{" "}
                      <Link href="/creator/settings/subscription" onClick={() => onOpenChange(false)} className="text-primary underline">
                        Subscribe for unlimited access.
                      </Link>
                    </span>
                  </div>
                )}
                <div
                  className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors hover:border-primary hover:bg-primary/5"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById("video-input")?.click()}
                >
                  <input
                    id="video-input"
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={handleFileSelect}
                    data-testid="input-video-file"
                  />
                  {isUploading ? (
                    <div className="space-y-4">
                      <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />
                      <p className="text-sm text-muted-foreground">Uploading… {progress}%</p>
                      <div className="w-full max-w-xs mx-auto h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="h-16 w-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                        <Upload className="h-8 w-8 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">Drop your video here or click to browse</p>
                        <p className="text-sm text-muted-foreground mt-1">MP4, MOV, WebM up to 500MB</p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── STEP: DETAILS ── */}
        {step === "details" && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleDetailsSubmit)} className="space-y-5">
              {videoFile && (
                <Card className="bg-muted/50">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Upload className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{videoFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                    <Badge variant="secondary" className="bg-green-500/20 text-green-600 text-xs">Uploaded</Badge>
                  </CardContent>
                </Card>
              )}

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Campaign Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Spring Skincare Edit, Paris Travel Vlog" {...field} data-testid="input-video-title" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe your video content — helps AI detect the right products"
                        className="min-h-[80px]"
                        {...field}
                        data-testid="input-video-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Brand selection */}
              <div className="space-y-2">
                <Label>Featured Brands</Label>
                <div className="flex flex-wrap gap-2 mb-1">
                  {selectedBrands.map((brandId) => {
                    const brand = brands.find((b) => b.id === brandId);
                    return brand ? (
                      <Badge key={brandId} variant="secondary" className="gap-1 pr-1">
                        {brand.name}
                        <button type="button" onClick={() => toggleBrand(brandId)} className="ml-1 rounded-full p-0.5 hover:bg-muted">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ) : null;
                  })}
                </div>

                <Popover open={brandPopoverOpen} onOpenChange={setBrandPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between" data-testid="button-select-brands">
                      Select brands featured in your video
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search brands…" />
                      <CommandList>
                        <CommandEmpty>
                          <div className="p-4 text-center">
                            <p className="text-sm text-muted-foreground mb-3">Brand not found?</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => { setBrandPopoverOpen(false); setStep("refer"); }}
                              className="gap-2"
                              data-testid="button-refer-brand"
                            >
                              <Plus className="h-4 w-4" />
                              Invite Brand
                            </Button>
                          </div>
                        </CommandEmpty>
                        <CommandGroup>
                          {brands.map((brand) => (
                            <CommandItem key={brand.id} value={brand.name} onSelect={() => toggleBrand(brand.id)}>
                              <Check className={`mr-2 h-4 w-4 ${selectedBrands.includes(brand.id) ? "opacity-100" : "opacity-0"}`} />
                              {brand.name}
                              {brand.category && <Badge variant="secondary" className="ml-2 text-xs">{brand.category}</Badge>}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep("refer")}
                  className="gap-2 text-muted-foreground"
                  data-testid="button-refer-new-brand"
                >
                  <Plus className="h-4 w-4" />
                  Can't find a brand? Invite them to join
                </Button>
              </div>

              {/* AI Detection toggle */}
              {selectedBrands.length > 0 && (
                <Card className="bg-gradient-to-r from-primary/5 to-chart-2/5 border-primary/20">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Wand2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">AI Product Detection</p>
                          <p className="text-xs text-muted-foreground">
                            Gemini scans your video for products from {selectedBrands.length} brand{selectedBrands.length > 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <Switch checked={enableAiDetection} onCheckedChange={setEnableAiDetection} data-testid="switch-ai-detection" />
                    </div>
                  </CardContent>
                </Card>
              )}

              <Separator />

              <div className="flex justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSaveDraft}
                  disabled={isSubmitting}
                  className="gap-2"
                  data-testid="button-save-draft"
                >
                  {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save Draft</>}
                </Button>
                <div className="flex gap-3">
                  <Button type="button" variant="ghost" onClick={resetAndClose} disabled={isSubmitting}>Cancel</Button>
                  <Button
                    type="submit"
                    disabled={startDetectionMutation.isPending || isSubmitting}
                    className="rounded-full gap-2"
                    data-testid="button-next-step"
                  >
                    {startDetectionMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</>
                    ) : enableAiDetection && selectedBrands.length > 0 ? (
                      <><ScanSearch className="h-4 w-4" /> Scan & Continue</>
                    ) : (
                      <><ArrowRight className="h-4 w-4" /> Continue</>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        )}

        {/* ── STEP: DETECTING ── */}
        {step === "detecting" && (
          <div className="space-y-8 py-4">
            {/* Animated scanner */}
            <div className="relative rounded-2xl border bg-gradient-to-br from-primary/5 via-chart-2/5 to-primary/5 p-8 overflow-hidden">
              {/* Pulse rings */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="h-32 w-32 rounded-full border-2 border-primary/20 animate-ping" style={{ animationDuration: "2.5s" }} />
              </div>

              <div className="flex flex-col items-center gap-5 relative z-10">
                <div className="relative">
                  <div className="h-20 w-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <ScanSearch className="h-10 w-10 text-primary" />
                  </div>
                  <div className="absolute -inset-2 rounded-2xl border-2 border-primary/30 animate-ping" style={{ animationDuration: "2s" }} />
                </div>

                <div className="text-center space-y-1">
                  <p className="font-semibold">{SCAN_MESSAGES[scanMsgIdx]}</p>
                  <p className="text-sm text-muted-foreground">
                    Scanning {selectedBrands.length} brand{selectedBrands.length !== 1 ? "s" : ""} — {
                      brands.filter(b => selectedBrands.includes(b.id)).map(b => b.name).join(", ")
                    }
                  </p>
                </div>

                <div className="w-full max-w-xs space-y-1.5">
                  <Progress value={scanProgress} className="h-1.5" />
                  <p className="text-xs text-center text-muted-foreground">{scanProgress}%</p>
                </div>
              </div>
            </div>

            {/* Detected product pills (rolling in) */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detected Products</p>
              {detectionJob?.results && detectionJob.results.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {detectionJob.results.map((r) => (
                    <Badge key={r.id} variant="secondary" className="gap-1.5 py-1.5 px-3">
                      <Package className="h-3 w-3" />
                      {r.product?.name || r.productId}
                      <span className="text-[10px] opacity-60">{Math.round(Number(r.confidence) * 100)}%</span>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Scanning in progress…</p>
              )}
            </div>
          </div>
        )}

        {/* ── STEP: CAROUSEL ── */}
        {step === "carousel" && (
          <div className="space-y-5">
            {/* Detection summary */}
            {detectionJob && (
              <Card className={detectionJob.status === "completed" ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20" : "border-muted"}>
                <CardContent className="p-3 flex items-start gap-3">
                  {detectionJob.status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {detectionJob.status === "completed"
                        ? `AI detected ${detectionJob.results.length} product${detectionJob.results.length !== 1 ? "s" : ""} in your video`
                        : "AI scan completed — manual carousel setup"}
                    </p>
                    {detectionJob.results.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {detectionJob.results.map((r) => (
                          <Badge key={r.id} variant="secondary" className="text-xs gap-1">
                            <Package className="h-2.5 w-2.5" />
                            {r.product?.name || r.productId}
                            <span className="opacity-60">{Math.round(Number(r.confidence) * 100)}%</span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Carousel editor */}
            <div className="rounded-xl border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/50 border-b">
                <Settings2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Carousel Customisation</span>
              </div>
              <div className="p-4">
                <ProductCarouselEditor
                  settings={carouselSettings}
                  onChange={setCarouselSettings}
                  onReset={() => setCarouselSettings(defaultCarouselSettings)}
                  videoUrl={videoUrl}
                  compact
                />
              </div>
            </div>

            <Separator />

            <div className="flex justify-between gap-3">
              <Button type="button" variant="outline" onClick={handleSaveDraft} className="gap-2" data-testid="button-save-draft-carousel">
                <Save className="h-4 w-4" />
                Save Draft
              </Button>
              <div className="flex gap-3">
                <Button type="button" variant="ghost" onClick={() => setStep("details")}>Back</Button>
                <Button
                  onClick={handlePublish}
                  disabled={isSubmitting}
                  className="rounded-full gap-2"
                  data-testid="button-publish-video"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Publish Video
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP: REFER ── */}
        {step === "refer" && (
          <Form {...referralForm}>
            <form onSubmit={referralForm.handleSubmit(handleReferralSubmit)} className="space-y-6">
              <Card className="bg-gradient-to-r from-primary/10 to-chart-2/10 border-0">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      {videoUrl ? <Mail className="h-5 w-5 text-primary" /> : <Send className="h-5 w-5 text-primary" />}
                    </div>
                    <div>
                      <p className="font-medium">{videoUrl ? "Direct Brand Outreach" : "Invite a Brand"}</p>
                      <p className="text-sm text-muted-foreground">
                        {videoUrl
                          ? "We'll email the brand's PR contact with a preview of your video and a one-click authorisation button."
                          : "Help us bring more brands to the platform. We'll send them an invitation on your behalf."}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={referralForm.control}
                    name="brandName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Brand Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Nike" {...field} data-testid="input-brand-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={referralForm.control}
                    name="productCategory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Fashion" {...field} data-testid="input-product-category" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={referralForm.control}
                    name="prContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>PR Contact Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Contact name" {...field} data-testid="input-contact-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={referralForm.control}
                    name="prContactEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>PR Contact Email</FormLabel>
                        <FormControl>
                          <Input placeholder="pr@brand.com" type="email" {...field} data-testid="input-contact-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={referralForm.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Tell the brand about your video and why it's a great fit…"
                          className="min-h-[80px]"
                          {...field}
                          data-testid="input-referral-message"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-between gap-3">
                <Button type="button" variant="ghost" onClick={() => setStep("details")}>Back</Button>
                <Button type="submit" disabled={isSubmitting || outreachMutation.isPending} className="gap-2 rounded-full" data-testid="button-send-referral">
                  {(isSubmitting || outreachMutation.isPending)
                    ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    : videoUrl ? <Mail className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  {videoUrl ? "Send Outreach" : "Send Invitation"}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

