import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserCircle, MapPin, Upload, Save, X, Loader2, Image as ImageIcon, Video } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { COUNTRIES } from "@shared/schema";
import type { UserProfile, User } from "@shared/schema";

const profileFormSchema = z.object({
  bio: z.string().max(100, "Bio must be 100 characters or less").optional(),
  profileMediaUrl: z.string().url().optional().or(z.literal("")),
  profileMediaType: z.enum(["image", "video"]).optional(),
  locationCity: z.string().optional(),
  locationCountry: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileFormSchema>;

export default function ProfilePage() {
  const { toast } = useToast();
  const [bioLength, setBioLength]       = useState(0);
  const [isDragging, setIsDragging]     = useState(false);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType]       = useState<"image" | "video" | null>(null);
  const [isUploading, setIsUploading]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/users/me"],
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
  });

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      bio: "",
      profileMediaUrl: "",
      profileMediaType: "image",
      locationCity: "",
      locationCountry: "",
    },
  });

  const { reset } = form;

  useState(() => {
    if (profile) {
      reset({
        bio: profile.bio || "",
        profileMediaUrl: profile.profileMediaUrl || "",
        profileMediaType: (profile.profileMediaType as "image" | "video") || "image",
        locationCity: profile.locationCity || "",
        locationCountry: profile.locationCountry || "",
      });
      setBioLength(profile.bio?.length || 0);
      if (profile.profileMediaUrl) {
        setMediaPreview(profile.profileMediaUrl);
        setMediaType((profile.profileMediaType as "image" | "video") || "image");
      }
    }
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      const response = await apiRequest("PUT", "/api/profile", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({
        title: "Profile updated",
        description: "Your personal details have been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ProfileFormData) => {
    updateProfileMutation.mutate(data);
  };

  // ── File upload helpers ────────────────────────────────────────────────────

  const uploadFile = async (file: File) => {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      toast({ title: "Unsupported file", description: "Please drop an image or video file.", variant: "destructive" });
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setMediaPreview(localPreview);
    setMediaType(isVideo ? "video" : "image");
    setIsUploading(true);

    try {
      const urlRes = await apiRequest("POST", "/api/uploads/request-url", {
        name: file.name,
        size: file.size,
        contentType: file.type,
      });
      const { uploadURL, objectPath } = await urlRes.json();
      await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const publicUrl = `/objects/${objectPath.replace(/^\//, "")}`;
      form.setValue("profileMediaUrl", publicUrl);
      form.setValue("profileMediaType", isVideo ? "video" : "image");
    } catch {
      toast({ title: "Upload failed", description: "Could not upload the file. Please try again.", variant: "destructive" });
      setMediaPreview(null);
      setMediaType(null);
    } finally {
      setIsUploading(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const clearMedia = () => {
    setMediaPreview(null);
    setMediaType(null);
    form.setValue("profileMediaUrl", "");
    form.setValue("profileMediaType", "image");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const currentPreview = mediaPreview || form.watch("profileMediaUrl") || user?.avatarUrl || "";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <UserCircle className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-[#43484D] dark:text-white">Personal Details</h1>
          <p className="text-muted-foreground">Manage your profile information</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── Profile Media card ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Profile Media</CardTitle>
            <CardDescription>
              Upload a profile photo or video from your computer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Current preview avatar */}
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 shrink-0">
                {mediaType === "video" ? (
                  <AvatarFallback className="bg-primary/10 text-primary">
                    <Video className="h-6 w-6" />
                  </AvatarFallback>
                ) : (
                  <>
                    <AvatarImage src={currentPreview} />
                    <AvatarFallback className="bg-primary/20 text-primary text-2xl">
                      {user?.displayName?.charAt(0) || "U"}
                    </AvatarFallback>
                  </>
                )}
              </Avatar>
              <div className="text-sm text-muted-foreground leading-snug">
                {isUploading
                  ? "Uploading…"
                  : mediaPreview
                  ? mediaType === "video" ? "Video ready — save to apply." : "Image ready — save to apply."
                  : "No media uploaded yet."}
              </div>
            </div>

            {/* Drag-and-drop zone */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,video/mov,video/webm"
              className="hidden"
              onChange={onFileChange}
              data-testid="input-media-file"
            />

            {!mediaPreview ? (
              <div
                data-testid="dropzone-profile-media"
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all select-none ${
                  isDragging
                    ? "border-primary bg-primary/5 scale-[1.01]"
                    : "border-border hover:border-primary/50 hover:bg-muted/30"
                }`}
              >
                {isUploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    <p className="text-sm font-medium">Uploading…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                      <Upload className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {isDragging ? "Drop to upload" : "Drag & drop your photo or video"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        JPG, PNG, WEBP or MP4 · max 50 MB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full mt-1"
                      data-testid="button-browse-media"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      Browse files
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-border">
                {mediaType === "video" ? (
                  <video
                    src={mediaPreview}
                    controls
                    className="w-full max-h-52 object-cover"
                    data-testid="preview-profile-video"
                  />
                ) : (
                  <img
                    src={mediaPreview}
                    alt="Profile preview"
                    className="w-full max-h-52 object-cover"
                    data-testid="preview-profile-image"
                  />
                )}
                <button
                  type="button"
                  onClick={clearMedia}
                  data-testid="button-remove-media"
                  className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded-full">
                  {mediaType === "video"
                    ? <Video className="h-3 w-3 text-white" />
                    : <ImageIcon className="h-3 w-3 text-white" />}
                  <span className="text-[11px] text-white font-medium capitalize">{mediaType}</span>
                </div>
              </div>
            )}

          </CardContent>
        </Card>

        {/* ── Bio card ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Bio</CardTitle>
            <CardDescription>
              Write a short bio about yourself (max 100 characters)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Textarea
                placeholder="Tell us about yourself..."
                className="resize-none"
                maxLength={100}
                {...form.register("bio", {
                  onChange: (e) => setBioLength(e.target.value.length),
                })}
                data-testid="input-bio"
              />
              <div className="text-xs text-muted-foreground text-right mt-1">
                {bioLength}/100 characters
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Location card ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Location
          </CardTitle>
          <CardDescription>
            Share your location to help brands and affiliates find you
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="locationCity">City</Label>
                <Input
                  id="locationCity"
                  placeholder="e.g., London"
                  {...form.register("locationCity")}
                  data-testid="input-location-city"
                />
              </div>

              <div>
                <Label htmlFor="locationCountry">Country</Label>
                <Select
                  value={form.watch("locationCountry") || ""}
                  onValueChange={(value) => form.setValue("locationCountry", value)}
                >
                  <SelectTrigger data-testid="select-location-country">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={updateProfileMutation.isPending || isUploading}
                data-testid="button-save-profile"
              >
                <Save className="h-4 w-4 mr-2" />
                {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
