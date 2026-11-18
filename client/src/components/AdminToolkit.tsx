/**
 * Admin > Homepage (client, 18 Nov 2026): edit the Creator Toolkit on the
 * creator homepage (two partner tool cards, the Creator Challenge card and
 * the Creator Film Awards banner) and see how it is doing: clicks per tool,
 * Film Awards registrations, and the month's challenge entries ranked.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Save } from "lucide-react";
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
import { monthKey, type CreatorToolkit, type ToolCard } from "@shared/creatorToolkit";

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
        <div className="sm:col-span-2"><Field label="Cover image link (optional)"><Input value={tool.posterUrl} onChange={f("posterUrl")} placeholder="https://…/cover.jpg" /></Field></div>
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

  return (
    <div className="space-y-6" data-testid="admin-toolkit">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Creator homepage</h2>
          <p className="text-sm text-muted-foreground">The Creator Toolkit every creator sees under their numbers: two partner tools, the Creator Challenge and the Film Awards.</p>
        </div>
        <Button className="gap-2 rounded-full" onClick={() => save.mutate({ ...draft, awards: { ...draft.awards, highlights: draft.awards.highlights.map((h) => h.trim()).filter(Boolean) } })} disabled={save.isPending} data-testid="button-save-toolkit">
          <Save className="h-4 w-4" />{save.isPending ? "Saving…" : "Save homepage"}
        </Button>
      </div>

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
  );
}
