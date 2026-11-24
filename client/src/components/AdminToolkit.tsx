/**
 * Admin > Homepage (client, 18 Nov 2026): edit the Creator Toolkit on the
 * creator homepage (two partner tool cards, the Creator Challenge card and
 * the Creator Film Awards banner) and see how it is doing: clicks per tool,
 * Film Awards registrations, and the month's challenge entries ranked.
 *
 * 24 Nov 2026: images are uploaded here (to the same Cloudinary library as
 * the rest of the app) rather than pasted as links, each card has a hover
 * line, and the announcement bar above the cards is edited at the top.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, ImagePlus, Loader2, Save, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, serverMessage } from "@/lib/queryClient";
import { exportToCsv } from "@/lib/exportCsv";
import { useUpload } from "@/hooks/use-upload";
import { AnnouncementBar } from "@/components/CreatorToolkit";
import {
  ANNOUNCEMENT_MAX, HOVER_MAX, monthKey, type CreatorToolkit, type ToolCard,
} from "@shared/creatorToolkit";

/** How many image uploads are running; Save waits for them. */
const UploadsBusy = createContext<(delta: number) => void>(() => {});

/** Card images: the formats every browser draws, up to 10 MB. */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

interface Report {
  month: string;
  window: { from: string; to: string };
  clicks: { tool_name: string; total: number; last30: number }[];
  registrations: { email: string; handle: string; created_at: string; display_name: string; role: string }[];
  entries: { id: string; title: string; creator: string; email: string; views: number; clicks: number; sales: number; reposts: number; total: number }[];
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * An uploaded image with a preview. Upload puts the file in the app's image
 * library and fills in its address; the address can still be pasted by hand.
 * Nothing changes on the homepage until Save homepage.
 */
function ImageField({ label, value, onChange, testId, hint }: { label: string; value: string; onChange: (url: string) => void; testId: string; hint?: string }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading, progress } = useUpload();
  const busy = useContext(UploadsBusy);
  // Save waits for this upload: saving mid-upload would keep the old image.
  useEffect(() => {
    if (!isUploading) return;
    busy(1);
    return () => busy(-1);
  }, [isUploading, busy]);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast({ title: "Not uploaded", description: `${file.name} isn't a JPG, PNG, WebP or GIF.`, variant: "destructive" });
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast({ title: "Not uploaded", description: `${file.name} is over 10 MB. Export a smaller copy and try again.`, variant: "destructive" });
      return;
    }
    try {
      const r = await uploadFile(file);
      onChange(r.objectUrl);
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  };
  return (
    <Field label={label} hint={hint ?? "JPG, PNG, WebP or GIF up to 10 MB. A wide image (16:9) fits the card best."}>
      <div className="flex items-start gap-3">
        <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md border bg-muted">
          {value ? <img src={value} alt="" className="h-full w-full object-cover" data-testid={`img-${testId}`} />
            : <span className="flex h-full items-center justify-center text-[11px] text-muted-foreground">No image</span>}
          {isUploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/80 text-xs font-medium tabular-nums">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />{progress}%
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isUploading} onClick={() => input.current?.click()} data-testid={`button-upload-${testId}`}>
              <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />{value ? "Replace image" : "Upload image"}
            </Button>
            {value && !isUploading && (
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => onChange("")} data-testid={`button-remove-${testId}`}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />Remove
              </Button>
            )}
          </div>
          <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="or paste an https:// image link" aria-label={`${label} link`} className="h-8 text-xs" />
          <input
            ref={input}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }}
            data-testid={`input-file-${testId}`}
          />
        </div>
      </div>
    </Field>
  );
}

/** The hover line, with a live count. */
function HoverField({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <Field label="Hover text (optional)" hint={`Rises over the image when someone hovers the card, and always shows on phones. ${value.length}/${HOVER_MAX}`}>
      <Input value={value} maxLength={HOVER_MAX} onChange={(e) => onChange(e.target.value)} placeholder="One short line, e.g. what creators get" data-testid={`input-hover-${testId}`} />
    </Field>
  );
}

function ToolEditor({ i, tool, set }: { i: number; tool: ToolCard; set: (t: ToolCard) => void }) {
  const f = (k: keyof ToolCard) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ ...tool, [k]: e.target.value });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Tool card {i + 1}</CardTitle>
        <label className="flex items-center gap-2 text-sm">
          Show
          <Switch checked={tool.enabled} onCheckedChange={(v) => set({ ...tool, enabled: v })} data-testid={`switch-tool-${i}`} />
        </label>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Field label="Tool name"><Input value={tool.name} onChange={f("name")} placeholder="Clipur" data-testid={`input-tool-name-${i}`} /></Field>
        <Field label="Button label"><Input value={tool.ctaLabel} onChange={f("ctaLabel")} placeholder="Sign up free" /></Field>
        <div className="sm:col-span-2"><Field label="One line about it"><Input value={tool.tagline} onChange={f("tagline")} placeholder="Turn long videos into shorts in a click" /></Field></div>
        <div className="sm:col-span-2">
          <Field label="Referral or sign-up link" hint="Clicks go through MTRLZD first, so each one is counted below.">
            <Input value={tool.linkUrl} onChange={f("linkUrl")} placeholder="https://partner.com/?ref=mtrlzd" data-testid={`input-tool-link-${i}`} />
          </Field>
        </div>
        <Field label="Voucher code (optional)"><Input value={tool.voucherCode} onChange={f("voucherCode")} placeholder="MTRLZD20" /></Field>
        <Field label="Explainer video link (optional)" hint="An .mp4 link, for example from your Bunny or Cloudinary library.">
          <Input value={tool.videoUrl} onChange={f("videoUrl")} placeholder="https://…/tool.mp4" />
        </Field>
        <div className="sm:col-span-2">
          <ImageField label="Card image (optional)" value={tool.posterUrl} onChange={(url) => set({ ...tool, posterUrl: url })} testId={`tool-${i}`}
            hint="Shows at the top of the card, and as the cover before the video plays. JPG, PNG, WebP or GIF up to 10 MB; 16:9 fits best." />
        </div>
        <div className="sm:col-span-2"><HoverField value={tool.hoverText} onChange={(v) => set({ ...tool, hoverText: v })} testId={`tool-${i}`} /></div>
      </CardContent>
    </Card>
  );
}

export function AdminToolkit() {
  const { toast } = useToast();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const { data, isLoading } = useQuery<{ content: CreatorToolkit; report: Report | null }>({
    queryKey: [`/api/admin/toolkit?month=${month}`],
  });
  const [draft, setDraft] = useState<CreatorToolkit | null>(null);
  const [uploading, setUploading] = useState(0);
  const onBusy = useCallback((delta: number) => setUploading((n) => Math.max(0, n + delta)), []);
  useEffect(() => { if (data && !draft) setDraft(data.content); }, [data, draft]);

  const save = useMutation({
    mutationFn: async (v: CreatorToolkit) => (await apiRequest("PUT", "/api/admin/toolkit", v)).json(),
    onSuccess: (v: CreatorToolkit) => {
      setDraft(v);
      queryClient.invalidateQueries({ queryKey: ["/api/toolkit"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/toolkit") });
      toast({ title: "Homepage saved", description: "Creators see the changes on their next visit." });
    },
    onError: (err: unknown) => toast({ title: "Not saved", description: serverMessage(err) || "Check the fields and try again.", variant: "destructive" }),
  });

  if (isLoading || !draft) return <Skeleton className="h-96 rounded-xl" />;
  const r = data?.report;
  const setTool = (i: number) => (t: ToolCard) => setDraft({ ...draft, tools: draft.tools.map((x, j) => (j === i ? t : x)) as CreatorToolkit["tools"] });
  const ch = draft.challenge;
  const aw = draft.awards;
  const an = draft.announcement;

  return (
    <UploadsBusy.Provider value={onBusy}>
    <div className="space-y-6" data-testid="admin-toolkit">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Creator homepage</h2>
          <p className="text-sm text-muted-foreground">The Creator Toolkit every creator sees under their numbers: an announcement bar, two partner tools, the Creator Challenge and the Film Awards.</p>
        </div>
        <Button className="gap-2 rounded-full" onClick={() => save.mutate({ ...draft, awards: { ...draft.awards, highlights: draft.awards.highlights.map((h) => h.trim()).filter(Boolean) } })} disabled={save.isPending || uploading > 0} data-testid="button-save-toolkit">
          <Save className="h-4 w-4" />{save.isPending ? "Saving…" : uploading > 0 ? "Uploading…" : "Save homepage"}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Announcement bar</CardTitle>
          <label className="flex items-center gap-2 text-sm">Show<Switch checked={an.enabled} onCheckedChange={(v) => setDraft({ ...draft, announcement: { ...an, enabled: v } })} data-testid="switch-announcement" /></label>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Text" hint={`One line above the cards. ${an.text.length}/${ANNOUNCEMENT_MAX}`}>
              <Input value={an.text} maxLength={ANNOUNCEMENT_MAX} onChange={(e) => setDraft({ ...draft, announcement: { ...an, text: e.target.value } })} placeholder="New in the Toolkit: book hotels for your travel shoots with WINK" data-testid="input-announcement-text" />
            </Field>
          </div>
          <Field label="Link (optional)" hint="The whole bar opens this link.">
            <Input value={an.linkUrl} onChange={(e) => setDraft({ ...draft, announcement: { ...an, linkUrl: e.target.value } })} placeholder="https://…" data-testid="input-announcement-link" />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Switch checked={an.scroll} onCheckedChange={(v) => setDraft({ ...draft, announcement: { ...an, scroll: v } })} data-testid="switch-announcement-scroll" />
            Running text
          </label>
          {an.text.trim() && (
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs">Preview</Label>
              <AnnouncementBar a={an} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ToolEditor i={0} tool={draft.tools[0]} set={setTool(0)} />
        <ToolEditor i={1} tool={draft.tools[1]} set={setTool(1)} />
      </div>
      <p className="-mt-2 text-[11px] text-muted-foreground">A tool card shows once it is switched on and has a name and a link.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Creator Challenge card</CardTitle>
            <label className="flex items-center gap-2 text-sm">Show<Switch checked={ch.enabled} onCheckedChange={(v) => setDraft({ ...draft, challenge: { ...ch, enabled: v } })} /></label>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Title"><Input value={ch.title} onChange={(e) => setDraft({ ...draft, challenge: { ...ch, title: e.target.value } })} /></Field>
            <Field label="Prize"><Input value={ch.prize} onChange={(e) => setDraft({ ...draft, challenge: { ...ch, prize: e.target.value } })} /></Field>
            <div className="sm:col-span-2">
              <Field label="How it works" hint="Entries open on the 1st and close at the end of the 15th; the winner shows as the 15th of the next month.">
                <Textarea rows={3} value={ch.body} onChange={(e) => setDraft({ ...draft, challenge: { ...ch, body: e.target.value } })} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <ImageField label="Card image (optional)" value={ch.imageUrl} onChange={(url) => setDraft({ ...draft, challenge: { ...ch, imageUrl: url } })} testId="challenge" />
            </div>
            <div className="sm:col-span-2"><HoverField value={ch.hoverText} onChange={(v) => setDraft({ ...draft, challenge: { ...ch, hoverText: v } })} testId="challenge" /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Film Awards banner</CardTitle>
            <label className="flex items-center gap-2 text-sm">Show<Switch checked={aw.enabled} onCheckedChange={(v) => setDraft({ ...draft, awards: { ...aw, enabled: v } })} /></label>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Title"><Input value={aw.title} onChange={(e) => setDraft({ ...draft, awards: { ...aw, title: e.target.value } })} /></Field>
            <Field label="Where"><Input value={aw.place} onChange={(e) => setDraft({ ...draft, awards: { ...aw, place: e.target.value } })} /></Field>
            <Field label="Dates"><Input value={aw.dates} onChange={(e) => setDraft({ ...draft, awards: { ...aw, dates: e.target.value } })} /></Field>
            <Field label="Background video link" hint="Plays muted on a loop, e.g. the mansion video.">
              <Input value={aw.videoUrl} onChange={(e) => setDraft({ ...draft, awards: { ...aw, videoUrl: e.target.value } })} placeholder="https://…/mansion.mp4" data-testid="input-awards-video" />
            </Field>
            <div className="sm:col-span-2">
              <ImageField label="Cover image (optional)" value={aw.posterUrl} onChange={(url) => setDraft({ ...draft, awards: { ...aw, posterUrl: url } })} testId="awards"
                hint="Shows beside the text, or before the background video loads. JPG, PNG, WebP or GIF up to 10 MB." />
            </div>
            <div className="sm:col-span-2">
              <Field label="Highlights, one per line (up to 6)">
                <Textarea rows={4} value={aw.highlights.join("\n")} onChange={(e) => setDraft({ ...draft, awards: { ...aw, highlights: e.target.value.split("\n").map((l) => l.trimStart()).slice(0, 6) } })} />
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Tool clicks</CardTitle></CardHeader>
          <CardContent>
            {!r || r.clicks.length === 0 ? <p className="text-sm text-muted-foreground">No clicks yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="py-1 font-medium">Tool</th><th className="py-1 text-right font-medium">Last 30 days</th><th className="py-1 text-right font-medium">All time</th></tr></thead>
                <tbody className="divide-y">{r.clicks.map((c) => <tr key={c.tool_name}><td className="py-2">{c.tool_name}</td><td className="py-2 text-right tabular-nums">{c.last30}</td><td className="py-2 text-right tabular-nums">{c.total}</td></tr>)}</tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Film Awards registrations{r ? ` (${r.registrations.length})` : ""}</CardTitle>
            {r && r.registrations.length > 0 && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportToCsv("film-awards-registrations", r.registrations, [
                { header: "Name", value: (x) => x.display_name }, { header: "Email", value: (x) => x.email }, { header: "Handle", value: (x) => x.handle },
                { header: "Account", value: (x) => (x.role === "affiliate" ? "publisher" : x.role) }, { header: "Registered", value: (x) => new Date(x.created_at).toISOString().slice(0, 10) },
              ])}><Download className="h-3.5 w-3.5" />CSV</Button>
            )}
          </CardHeader>
          <CardContent>
            {!r || r.registrations.length === 0 ? <p className="text-sm text-muted-foreground">No registrations yet.</p> : (
              <ul className="divide-y text-sm">{r.registrations.slice(0, 8).map((x) => <li key={x.email} className="flex justify-between gap-3 py-2"><span className="truncate">{x.display_name}</span><span className="shrink-0 text-muted-foreground">{x.handle}</span></li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Challenge entries</CardTitle>
            {r && <p className="mt-1 text-xs text-muted-foreground">Counted from {new Date(r.window.from).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })} to {new Date(new Date(r.window.to).getTime() - 1).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}. Total adds views, clicks, sales and reposts.</p>}
          </div>
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-[170px]" aria-label="Challenge month" data-testid="input-challenge-month" />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!r || r.entries.length === 0 ? <p className="text-sm text-muted-foreground">No entries for this month yet.</p> : (
            <table className="w-full text-sm" data-testid="table-challenge-entries">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">#</th><th className="py-1 pr-3 font-medium">Video</th><th className="py-1 pr-3 font-medium">Creator</th>
                <th className="py-1 px-2 text-right font-medium">Views</th><th className="py-1 px-2 text-right font-medium">Clicks</th><th className="py-1 px-2 text-right font-medium">Sales</th><th className="py-1 px-2 text-right font-medium">Reposts</th><th className="py-1 pl-2 text-right font-medium">Total</th>
              </tr></thead>
              <tbody className="divide-y">{r.entries.map((e, i) => (
                <tr key={e.id}>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="max-w-[240px] truncate py-2 pr-3 font-medium">{e.title}</td>
                  <td className="py-2 pr-3"><span className="block">{e.creator}</span><span className="block text-[11px] text-muted-foreground">{e.email}</span></td>
                  <td className="py-2 px-2 text-right tabular-nums">{e.views}</td><td className="py-2 px-2 text-right tabular-nums">{e.clicks}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{e.sales}</td><td className="py-2 px-2 text-right tabular-nums">{e.reposts}</td>
                  <td className="py-2 pl-2 text-right font-semibold tabular-nums">{e.total}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
    </UploadsBusy.Provider>
  );
}
