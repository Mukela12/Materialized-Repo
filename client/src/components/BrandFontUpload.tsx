/**
 * Uploading a brand's own typeface.
 *
 * The client: "Font upload must allow for the .otf or .ttf".
 *
 * Before this, a font was one of twelve built-ins or a NAME typed in and looked
 * up on Google Fonts — so a brand with its own licensed face had no way to use
 * it, and a name Google does not publish fell back to system-ui silently. A
 * client typed "Hello", saw it save, and reported the feature as broken; she
 * was right to.
 *
 * ── What this screen has to be honest about ──────────────────────────────────
 * The server decides what a font is by reading the bytes, not the extension —
 * so a file can be refused after it uploads. The messages here say which file
 * was refused and why, rather than a generic failure, because "that .ttf is
 * actually a zip" is not something anyone guesses.
 */
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Trash2, Upload, Type } from "lucide-react";
import { MAX_FONT_BYTES } from "@shared/brandFonts";

interface BrandFontRow {
  id: string;
  key: string;
  label: string;
  fileUrl: string;
  format: string;
  sizeBytes: number | null;
}

const ACCEPT = ".otf,.ttf,.woff,.woff2";

export function BrandFontUpload() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");

  const { data: fonts = [], isLoading } = useQuery<BrandFontRow[]>({
    queryKey: ["/api/brand-fonts"],
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // The file is the request body — see the note on the route. Sending it
      // raw is what lets the server check the bytes before anything is stored.
      const qs = new URLSearchParams({
        label: label || file.name.replace(/\.[^.]+$/, ""),
        filename: file.name,
      });
      const res = await fetch(`/api/brand-fonts?${qs}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      return res.json();
    },
    onSuccess: (row: BrandFontRow) => {
      qc.invalidateQueries({ queryKey: ["/api/brand-fonts"] });
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      toast({
        title: `${row.label} uploaded`,
        description: "It's now in your font pickers.",
      });
    },
    onError: (e: any) =>
      toast({ title: "Could not upload that font", description: e?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/brand-fonts/${id}`, { method: "DELETE", credentials: "include" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/brand-fonts"] });
      toast({
        title: "Font removed",
        // Says what does NOT happen, because the obvious assumption is wrong.
        description: "Videos already published keep rendering it.",
      });
    },
  });

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FONT_BYTES) {
      toast({
        title: "That font is too large",
        description: `${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB, because every visitor to your embed downloads it.`,
        variant: "destructive",
      });
      return;
    }
    upload.mutate(file);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">Your own fonts</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Upload a licensed typeface as .otf, .ttf, .woff or .woff2. It appears
          in the font pickers alongside the built-in ones, and is embedded in
          your videos wherever they play.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Name it (optional)</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Söhne Breit"
            className="h-8 text-xs mt-1"
            data-testid="input-font-label"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Defaults to the file name. Only shown to you.
          </p>
        </div>
        <div className="flex items-end">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
            data-testid="input-font-file"
          />
          <Button
            variant="outline"
            className="w-full gap-2"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
            data-testid="button-upload-font"
          >
            <Upload className="h-4 w-4" />
            {upload.isPending ? "Uploading…" : "Choose a font file"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : fonts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No uploaded fonts yet.</p>
      ) : (
        <div className="space-y-2">
          {fonts.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5"
              data-testid={`brand-font-${f.id}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Type className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm truncate">{f.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.format.toUpperCase()}
                    {f.sizeBytes ? ` · ${(f.sizeBytes / 1024).toFixed(0)} KB` : ""}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove.mutate(f.id)}
                data-testid={`button-remove-font-${f.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The uploaded fonts, shaped for a picker that also lists the built-ins. */
export function useBrandFontOptions() {
  const { data: fonts = [] } = useQuery<BrandFontRow[]>({ queryKey: ["/api/brand-fonts"] });
  return fonts.map((f) => ({ value: f.key, label: f.label }));
}
