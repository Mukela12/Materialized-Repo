/**
 * Admin: the onboarding email journeys (server/journeys.ts). Seven audiences,
 * twelve emails each, seeded from the client's "MTRLZD DEV" doc and switched
 * off until someone has read them. Each email can be edited, previewed exactly
 * as it will arrive, and sent to yourself before its journey goes live.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft, Mail, PauseCircle, RefreshCw, Send } from "lucide-react";
import { apiRequest, serverMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Journey {
  segment: string; name: string; audience: string; enabled_at: string | null;
  enrolled: number; sent: number; unsubscribed: number;
  from_name: string | null; reply_to: string | null;
}
interface Step {
  id: string; segment: string; position: number; anchor: string; day: number; condition: string;
  subject: string; body: string; ctaLabel: string | null; ctaPath: string | null; enabled: boolean; plain: boolean;
  reviewNote: string | null; sent: number; skipped: number; failed: number;
}
interface Overview {
  journeys: Journey[];
  steps: Step[];
  partners: { partner: string; codes: number; segment: string | null }[];
  conditions: { key: string; label: string }[];
}

const KEY = ["/api/admin/journeys"];

export function timingLabel(anchor: string, day: number): string {
  if (anchor === "inactive") return `After ${day} day${day === 1 ? "" : "s"} without visiting`;
  if (anchor === "trial_end") {
    if (day === 0) return "When the free period ends";
    return day < 0 ? `${-day} day${day === -1 ? "" : "s"} before the free period ends` : `${day} day${day === 1 ? "" : "s"} after the free period ends`;
  }
  return day === 0 ? "On sign-up" : `Day ${day}`;
}

function isPaused(s: Step) {
  return !s.enabled || s.condition === "needs_feature";
}

export function AdminJourneys() {
  const { data, isLoading, isError, refetch } = useQuery<Overview>({
    queryKey: KEY,
    queryFn: async () => {
      const r = await fetch("/api/admin/journeys", { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
  });
  const [open, setOpen] = useState<string | null>(null);

  if (isError && !data) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        <p>Emails couldn't be loaded.</p>
        <button onClick={() => refetch()} className="mt-2 underline hover:text-foreground">Try again</button>
      </div>
    );
  }
  if (isLoading || !data) {
    return <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const journey = data.journeys.find((j) => j.segment === open);
  if (journey) {
    return <JourneyDetail journey={journey} data={data} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="space-y-6" data-testid="admin-journeys">
      <p className="text-sm text-muted-foreground max-w-3xl">
        Onboarding emails for each kind of member, sent on a schedule and matched to what each person has actually done.
        Every journey starts off. Read its emails, fix anything flagged, send yourself a test, then switch it on. Only
        accounts made after that are enrolled, so nobody gets a backlog. Each person gets at most one of these a day, and
        every email has an unsubscribe link.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {data.journeys.map((j) => {
          const steps = data.steps.filter((s) => s.segment === j.segment);
          const notes = steps.filter((s) => s.reviewNote).length;
          const paused = steps.filter(isPaused).length;
          return (
            <button
              key={j.segment}
              onClick={() => setOpen(j.segment)}
              className="text-left rounded-xl border bg-card p-4 hover:border-primary/50 transition-colors"
              data-testid={`journey-${j.segment}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{j.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{j.audience}</p>
                </div>
                {j.enabled_at
                  ? <Badge className="shrink-0 bg-emerald-600 hover:bg-emerald-600 text-white border-transparent">On</Badge>
                  : <Badge variant="secondary" className="shrink-0">Off</Badge>}
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-3 text-center">
                {[["Enrolled", j.enrolled], ["Sent", j.sent], ["Unsubscribed", j.unsubscribed]].map(([l, v]) => (
                  <div key={l as string} className="rounded-md bg-muted/50 py-1.5">
                    <p className="text-sm font-semibold tabular-nums">{v}</p>
                    <p className="text-[10px] text-muted-foreground">{l}</p>
                  </div>
                ))}
              </div>
              {(notes > 0 || paused > 0) && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2.5 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {[notes ? `${notes} to review` : "", paused ? `${paused} paused` : ""].filter(Boolean).join(" · ")}
                </p>
              )}
            </button>
          );
        })}
      </div>

      <PartnerMapping data={data} />
    </div>
  );
}

function JourneyDetail({ journey, data, onBack }: { journey: Journey; data: Overview; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const steps = data.steps.filter((s) => s.segment === journey.segment);
  const notes = steps.filter((s) => s.reviewNote).length;
  const [editing, setEditing] = useState<Step | null>(null);
  const [confirm, setConfirm] = useState(false);

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => (await apiRequest("PUT", `/api/admin/journeys/${journey.segment}`, { enabled })).json(),
    onSuccess: (_d, enabled) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast({ title: enabled ? `${journey.name} journey is on` : `${journey.name} journey is off` });
    },
    onError: (err) => toast({ title: "Couldn't change it", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });

  const onSwitch = (on: boolean) => {
    if (on && notes > 0) setConfirm(true);
    else toggle.mutate(on);
  };

  return (
    <div className="space-y-5" data-testid="journey-detail">
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5" data-testid="journey-back">
        <ArrowLeft className="h-4 w-4" /> All journeys
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{journey.name}</h2>
          <p className="text-sm text-muted-foreground">{journey.audience}</p>
        </div>
        <label className="flex items-center gap-3 rounded-xl border px-4 py-2.5 cursor-pointer">
          <div className="text-right">
            <p className="text-sm font-medium">{journey.enabled_at ? "On" : "Off"}</p>
            <p className="text-[11px] text-muted-foreground">
              {journey.enabled_at ? `since ${format(new Date(journey.enabled_at), "d MMM yyyy")}` : "No one gets these yet"}
            </p>
          </div>
          <Switch
            checked={!!journey.enabled_at}
            onCheckedChange={onSwitch}
            disabled={toggle.isPending}
            data-testid="journey-switch"
          />
        </label>
      </div>

      <SenderSettings journey={journey} />

      {notes > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p>
            {notes} email{notes === 1 ? "" : "s"} in this journey {notes === 1 ? "has" : "have"} a note to check before it goes out,
            mostly where the copy promises something the app doesn't do yet. Open one, fix it, and tick "Checked" when you save.
          </p>
        </div>
      )}

      <ol className="rounded-xl border divide-y" data-testid="journey-steps">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              onClick={() => setEditing(s)}
              className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex gap-3"
              data-testid={`step-${s.position}`}
            >
              <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums pt-0.5">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{timingLabel(s.anchor, s.day)}</span>
                  {s.condition !== "always" && s.condition !== "needs_feature" && (
                    <Badge variant="outline" className="font-normal text-[11px] py-0">
                      {data.conditions.find((c) => c.key === s.condition)?.label ?? s.condition}
                    </Badge>
                  )}
                  {isPaused(s) && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><PauseCircle className="h-3.5 w-3.5" /> Paused</span>
                  )}
                  {s.reviewNote && (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> Check</span>
                  )}
                </span>
                <span className={`block text-sm mt-0.5 truncate ${isPaused(s) ? "text-muted-foreground" : "font-medium"}`}>{s.subject}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums pt-0.5">
                {s.sent > 0 && <span className="block"><span className="text-foreground font-medium">{s.sent}</span> sent</span>}
                {s.failed > 0 && <span className="block text-destructive">{s.failed} failed</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {editing && <StepEditor step={editing} data={data} onClose={() => setEditing(null)} />}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch on with {notes} email{notes === 1 ? "" : "s"} still to check?</AlertDialogTitle>
            <AlertDialogDescription>
              Some emails here still have notes, mostly about promises the app can't keep yet. They will go out as written to
              everyone who joins from now on. Paused emails stay paused.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => toggle.mutate(true)} data-testid="journey-confirm-on">Switch on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The name a journey's emails come from and where replies go. Without a
 * reply-to, a recipient who replies writes to noreply@, which reaches nobody.
 */
function SenderSettings({ journey }: { journey: Journey }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [fromName, setFromName] = useState(journey.from_name ?? "");
  const [replyTo, setReplyTo] = useState(journey.reply_to ?? "");
  const dirty = fromName !== (journey.from_name ?? "") || replyTo !== (journey.reply_to ?? "");
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", `/api/admin/journeys/${journey.segment}/sender`, { fromName, replyTo })).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast({ title: "Sender saved" }); },
    onError: (err) => toast({ title: "Couldn't save", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });
  return (
    <div className="rounded-xl border p-4" data-testid="journey-sender">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 sm:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">From name</Label>
          <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="MTRLZD" maxLength={60} data-testid="sender-name" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Replies go to</Label>
          <Input type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="you@yourcompany.com" data-testid="sender-reply-to" />
        </div>
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="sender-save">
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      {!journey.reply_to && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
          No reply-to yet, so replies go to a no-reply address. Add one so people who reply reach you.
        </p>
      )}
    </div>
  );
}

const ROLES = [
  { key: "creator", label: "a creator" },
  { key: "brand", label: "a brand" },
  { key: "affiliate", label: "a publisher" },
];

function StepEditor({ step, data, onClose }: { step: Step; data: Overview; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState({
    subject: step.subject, body: step.body, ctaLabel: step.ctaLabel ?? "", ctaPath: step.ctaPath ?? "",
    day: String(step.day), anchor: step.anchor, condition: step.condition, enabled: step.enabled, plain: step.plain,
  });
  const [checked, setChecked] = useState(false);
  const [role, setRole] = useState(step.segment === "brands" ? "brand" : step.segment === "creators" ? "creator" : "affiliate");
  const [preview, setPreview] = useState<{ subject: string; html: string; fromName: string; replyTo: string | null } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const payload = useMemo(() => ({ ...draft, day: Number(draft.day) }), [draft]);

  // The preview follows the editor, a beat behind typing.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await apiRequest("POST", `/api/admin/journey-steps/${step.id}/preview`, { ...payload, role });
        setPreview(await r.json());
        setPreviewError("");
      } catch (err) {
        setPreviewError(serverMessage(err) || "Preview unavailable.");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [payload, role, step.id]);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", `/api/admin/journey-steps/${step.id}`, { ...payload, resolveNote: checked })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Saved" });
      onClose();
    },
    onError: (err) => toast({ title: "Couldn't save", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/journey-steps/${step.id}/preview`, { ...payload, role, send: true })).json(),
    onSuccess: (d: any) => toast({ title: "Test sent", description: `Check ${d.sentTo}.` }),
    onError: (err) => toast({ title: "Couldn't send", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });

  const editor = (
    <div className="space-y-4">
      {step.reviewNote && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="flex gap-2"><AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />{step.reviewNote}</p>
          <label className="flex items-center gap-2 mt-2.5 text-xs font-medium cursor-pointer">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} data-testid="step-checked" />
            Checked. Clear this note when I save.
          </label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">When</Label>
          <Select value={draft.anchor} onValueChange={(v) => set("anchor", v)}>
            <SelectTrigger data-testid="step-anchor"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="signup">Days after sign-up</SelectItem>
              <SelectItem value="trial_end">Days from end of free period</SelectItem>
              <SelectItem value="inactive">Days without visiting</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Day {draft.anchor === "trial_end" && <span className="text-muted-foreground font-normal">(−4 = 4 days before)</span>}</Label>
          <Input type="number" value={draft.day} onChange={(e) => set("day", e.target.value)} data-testid="step-day" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Only if</Label>
        <Select value={draft.condition} onValueChange={(v) => set("condition", v)}>
          <SelectTrigger data-testid="step-condition"><SelectValue /></SelectTrigger>
          <SelectContent>
            {data.conditions.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Subject</Label>
        <Input value={draft.subject} onChange={(e) => set("subject", e.target.value)} maxLength={200} data-testid="step-subject" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Message</Label>
        <Textarea value={draft.body} onChange={(e) => set("body", e.target.value)} rows={12} className="text-sm leading-relaxed" data-testid="step-body" />
        <p className="text-[11px] text-muted-foreground">
          {"{{FirstName}} and {{CompanyName}} fill in for each person. A blank line starts a new paragraph; lines starting with • make a list."}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Button</Label>
          <Input value={draft.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} maxLength={80} placeholder="No button" data-testid="step-cta-label" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Button opens</Label>
          <Input value={draft.ctaPath} onChange={(e) => set("ctaPath", e.target.value)} placeholder="{portal}" className="font-mono text-xs" data-testid="step-cta-path" />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        {"{portal} is their dashboard, {upload} where they upload, {plans} their plan page. Or any page, like /brand/inventory."}
      </p>
      <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer">
        <span>
          <span className="block text-sm">Plain email</span>
          <span className="block text-[11px] text-muted-foreground">No logo or design, like a personal email. Lands in the inbox more often.</span>
        </span>
        <Switch checked={draft.plain} onCheckedChange={(v) => set("plain", v)} data-testid="step-plain" />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer">
        <span className="text-sm">Send this email</span>
        <Switch checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} data-testid="step-enabled" />
      </label>
    </div>
  );

  const previewPane = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">As it arrives for</p>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="preview-role"><SelectValue /></SelectTrigger>
          <SelectContent>{ROLES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {previewError ? (
        <p className="text-sm text-destructive py-6 text-center">{previewError}</p>
      ) : preview ? (
        <>
          <p className="text-[11px] text-muted-foreground truncate" data-testid="preview-from">
            From {preview.fromName} · {preview.replyTo ? `replies go to ${preview.replyTo}` : "replies go nowhere (no reply-to set)"}
          </p>
          <p className="text-sm font-medium truncate" data-testid="preview-subject">{preview.subject}</p>
          <iframe
            title="Email preview"
            srcDoc={preview.html}
            sandbox=""
            className="w-full h-[520px] rounded-lg border bg-[#f6f6f6]"
            data-testid="preview-frame"
          />
        </>
      ) : (
        <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      )}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-4 sm:p-6" data-testid="step-editor">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base min-w-0"><Mail className="h-4 w-4 shrink-0" /> <span className="truncate">{step.subject}</span></DialogTitle>
          <DialogDescription>{timingLabel(draft.anchor, Number(draft.day) || 0)}</DialogDescription>
        </DialogHeader>
        <div className="flex lg:hidden rounded-lg border p-0.5 text-sm">
          {(["edit", "preview"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPane(p)}
              className={`flex-1 rounded-md py-1.5 capitalize ${pane === p ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              data-testid={`pane-${p}`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <div className={pane === "edit" ? "" : "hidden lg:block"}>{editor}</div>
          <div className={pane === "preview" ? "" : "hidden lg:block"}>{previewPane}</div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending} data-testid="step-test">
            <Send className="h-4 w-4 mr-2" /> {test.isPending ? "Sending…" : "Send me a test"}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="step-save">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PartnerMapping({ data }: { data: Overview }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: async (v: { partner: string; segment: string | null }) => (await apiRequest("PUT", "/api/admin/journey-partners", v)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => toast({ title: "Couldn't save", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });

  return (
    <Card data-testid="journey-partners">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Who gets which journey</CardTitle>
        <CardDescription>
          By default creators get Creators, brands get Brands and publishers get Media &amp; publishers. People who join with
          a partner's code can get that partner's journey instead, for example a talent agency's codes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.partners.length === 0 ? (
          <p className="text-sm text-muted-foreground">No voucher partners yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.partners.map((p) => (
              <li key={p.partner} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.partner}</p>
                  <p className="text-xs text-muted-foreground">{p.codes} code{p.codes === 1 ? "" : "s"}</p>
                </div>
                <Select
                  value={p.segment ?? "default"}
                  onValueChange={(v) => set.mutate({ partner: p.partner, segment: v === "default" ? null : v })}
                >
                  <SelectTrigger className="sm:w-56" data-testid={`partner-segment-${p.partner}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">By account type</SelectItem>
                    {data.journeys.map((j) => <SelectItem key={j.segment} value={j.segment}>{j.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
