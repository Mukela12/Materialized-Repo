/**
 * Admin: invite campaigns (server/inviteCampaigns.ts). The client's list of
 * creators and brands with no MTRLZD account, invited a set number a day,
 * each with their own free pass and an unsubscribe link. Whoever signs up
 * joins their email journey like any new account.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, Mail, Pause, Play, Plus, RefreshCw, Search, Send, Trash2, Upload } from "lucide-react";
import { apiRequest, serverMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FIRST_NAME_HEADERS, LAST_NAME_HEADERS, NAME_HEADERS, isCsvFile, parseContactCsv } from "@/lib/csvImport";
import { exportToCsv } from "@/lib/exportCsv";
import { CsvFormatHint } from "@/components/CsvFormatHint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type ContactType = "creator" | "brand";
interface Settings {
  name: string; fromName: string | null; replyTo: string | null;
  creatorSubject: string; creatorBody: string; brandSubject: string; brandBody: string; ctaLabel: string;
  creatorFreeDays: number; brandFreeDays: number; useWithinDays: number; dailyLimit: number; postalAddress: string | null;
}
interface Campaign extends Settings {
  id: string; startedAt: string | null; pausedAt: string | null; createdAt: string;
  totals: { contacts: number; waiting: number; sent: number; joined: number; unsubscribed: number; failed: number; skipped: number; sentToday: number };
  byType: Record<ContactType, number>;
  state: "draft" | "sending" | "paused" | "finished";
  nextSendAt: string | null;
  daysLeft: number;
}
interface Overview {
  campaigns: Campaign[]; fromAddress: string; emailConfigured: boolean;
  window: { from: number; to: number }; maxDailyLimit: number;
  journeysOn: { creators: boolean; brands: boolean };
}
interface ContactRow {
  id: number; position: number; email: string; name: string; company: string | null; type: ContactType;
  status: "queued" | "sending" | "sent" | "failed" | "skipped"; reason: string | null;
  sentAt: string | null; optedOutAt: string | null; code: string | null; joinedAt: string | null;
}
interface UploadResult { added: number; added_by_type: Record<ContactType, number>; skipped: { email: string; reason: string; detail: string }[] }

const KEY = ["/api/admin/invite-campaigns"];
const contactsKey = (id: string) => ["/api/admin/invite-campaigns", id, "contacts"];

const STATE: Record<Campaign["state"], { label: string; className: string }> = {
  draft: { label: "Not started", className: "" },
  sending: { label: "Sending", className: "bg-emerald-600 hover:bg-emerald-600 text-white border-transparent" },
  paused: { label: "Paused", className: "bg-amber-500 hover:bg-amber-500 text-white border-transparent" },
  finished: { label: "Finished", className: "" },
};

function contactStatus(c: ContactRow): string {
  if (c.optedOutAt) return "Unsubscribed";
  if (c.joinedAt) return `Joined ${format(new Date(c.joinedAt), "d MMM")}`;
  if (c.status === "sent") return `Sent ${c.sentAt ? format(new Date(c.sentAt), "d MMM") : ""}`.trim();
  if (c.status === "sending") return "Sending";
  if (c.status === "failed") return "Didn't send, will retry";
  if (c.status === "skipped") return c.reason === "unsubscribed" ? "Unsubscribed" : "Has an account now";
  return "Waiting";
}

/** The sending window, in the viewer's own time, e.g. "9am to 5pm". */
function windowLabel(w: { from: number; to: number }): string {
  const at = (h: number) => format(new Date(Date.UTC(2026, 0, 15, h)), "haaa");
  return `${at(w.from)} to ${at(w.to)}`;
}

export function AdminInviteCampaigns() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<Overview>({ queryKey: KEY });
  const [open, setOpen] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/invite-campaigns", {})).json(),
    onSuccess: (c: Campaign) => { setOpen(c.id); qc.invalidateQueries({ queryKey: KEY }); },
    onError: (err) => toast({ title: "Couldn't make the campaign", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });

  return (
    <section className="space-y-3" data-testid="invite-campaigns">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Mail className="h-4 w-4" /> Invite campaigns</h2>
          <p className="text-sm text-muted-foreground">
            For people who don't have an MTRLZD account yet. Each person on the list gets one email with their own free pass,
            a set number a day{data ? `, sent between ${windowLabel(data.window)} your time` : ""}, with an unsubscribe link.
            Whoever signs up with their pass joins their email journey.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 rounded-full" onClick={() => create.mutate()} disabled={create.isPending} data-testid="button-new-campaign">
          <Plus className="h-3.5 w-3.5" /> New campaign
        </Button>
      </div>
      {isError && !data ? (
        <p className="text-sm text-muted-foreground">Campaigns couldn't be loaded. <button className="underline" onClick={() => refetch()}>Try again</button></p>
      ) : isLoading || !data ? (
        <div className="flex justify-center py-6"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : data.campaigns.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No campaigns yet. Make one, upload the list, check the emails, then start it.</p>
      ) : (
        data.campaigns.map((c) => (
          <CampaignCard key={c.id} c={c} data={data} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
        ))
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 p-2 text-center">
      <p className="text-base sm:text-lg font-semibold tabular-nums leading-tight">{value.toLocaleString("en-US")}</p>
      <p className="truncate text-[10px] sm:text-[11px] text-muted-foreground">{label}</p>
      {sub && <p className="truncate text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function statusLine(c: Campaign): string {
  const next = c.nextSendAt ? format(new Date(c.nextSendAt), "EEE d MMM, h:mmaaa") : null;
  const days = c.daysLeft === 1 ? "1 more day" : `${c.daysLeft} more days`;
  if (c.state === "draft") return c.totals.waiting ? `${c.totals.waiting} waiting. At ${c.dailyLimit} a day that's ${c.daysLeft} sending ${c.daysLeft === 1 ? "day" : "days"} once it starts.` : "Upload the list, check both emails, add the postal address, then start.";
  if (c.state === "paused") return `Paused with ${c.totals.waiting} still to invite.`;
  if (c.state === "finished") return "Everyone on the list has been invited.";
  return `${c.dailyLimit} a day, ${c.totals.sentToday} sent today. ${c.totals.waiting} to go, about ${days}.${next ? ` Next send ${next}.` : ""}`;
}

function CampaignCard({ c, data, open, onToggle }: { c: Campaign; data: Overview; open: boolean; onToggle: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<"start" | "delete" | null>(null);
  const state = useMutation({
    mutationFn: async (action: "start" | "pause" | "resume") => (await apiRequest("PUT", `/api/admin/invite-campaigns/${c.id}/state`, { action })).json(),
    onSuccess: (_r, action) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast({ title: action === "pause" ? "Paused" : "Started", description: action === "pause" ? "No more invites go until you resume." : `Invites go out ${c.dailyLimit} a day from the next sending hour.` });
    },
    onError: (err) => toast({ title: "That didn't work", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/admin/invite-campaigns/${c.id}`)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => toast({ title: "Couldn't delete it", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });
  const offJourneys = (["creator", "brand"] as const).filter((t) => c.byType[t] > 0 && !data.journeysOn[t === "brand" ? "brands" : "creators"]);

  return (
    <div className="rounded-xl border bg-card" data-testid={`campaign-${c.id}`}>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button className="min-w-0 flex-1 text-left" onClick={onToggle} data-testid="button-campaign-toggle">
            <p className="font-semibold flex items-center gap-1.5">
              {c.name} {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-campaign-status">{statusLine(c)}</p>
          </button>
          <div className="flex items-center gap-1.5">
            <Badge variant={c.state === "draft" || c.state === "finished" ? "secondary" : "default"} className={STATE[c.state].className}>{STATE[c.state].label}</Badge>
            {c.state === "draft" && (
              <Button size="sm" className="h-8 gap-1.5 rounded-full" onClick={() => setConfirm("start")} disabled={state.isPending} data-testid="button-campaign-start">
                <Play className="h-3.5 w-3.5" /> Start
              </Button>
            )}
            {c.state === "sending" && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full" onClick={() => state.mutate("pause")} disabled={state.isPending} data-testid="button-campaign-pause">
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            )}
            {c.state === "paused" && (
              <Button size="sm" className="h-8 gap-1.5 rounded-full" onClick={() => state.mutate("resume")} disabled={state.isPending} data-testid="button-campaign-resume">
                <Play className="h-3.5 w-3.5" /> Resume
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5" data-testid="campaign-totals">
          <Stat label="On the list" value={c.totals.contacts} />
          <Stat label="Invited" value={c.totals.sent} />
          <Stat label="Joined" value={c.totals.joined} />
          <Stat label="Opted out" value={c.totals.unsubscribed} />
        </div>
        {offJourneys.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="text-journey-off">
            The {offJourneys.map((t) => (t === "brand" ? "Brands" : "Creators")).join(" and ")} journey is off, so {offJourneys.map((t) => `${t}s`).join(" and ")} who sign up won't get its emails until it's switched on.
          </p>
        )}
        {!data.emailConfigured && <p className="text-xs text-destructive">Email isn't set up on this server, so nothing can be sent from here.</p>}
      </div>

      {open && (
        <div className="border-t p-4">
          <Tabs defaultValue={c.totals.contacts ? "emails" : "list"}>
            <TabsList className="mb-4">
              <TabsTrigger value="list" data-testid="tab-campaign-list">List</TabsTrigger>
              <TabsTrigger value="emails" data-testid="tab-campaign-emails">Emails</TabsTrigger>
              <TabsTrigger value="settings" data-testid="tab-campaign-settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="list"><ContactList c={c} /></TabsContent>
            <TabsContent value="emails"><EmailEditor c={c} data={data} /></TabsContent>
            <TabsContent value="settings">
              <SettingsForm c={c} data={data} />
              {c.totals.sent === 0 && (
                <div className="mt-6 border-t pt-4">
                  <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirm("delete")} data-testid="button-campaign-delete">
                    <Trash2 className="h-3.5 w-3.5" /> Delete this campaign
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? `Delete ${c.name}?` : `Start ${c.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? "Nothing has been sent, so nobody is affected. The list goes with it."
                : `${c.totals.waiting} people will be invited, ${c.dailyLimit} a day, from ${data.fromAddress}. That's about ${c.daysLeft} sending ${c.daysLeft === 1 ? "day" : "days"}. You can pause at any time.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-campaign-confirm"
              onClick={() => { if (confirm === "delete") remove.mutate(); else state.mutate("start"); setConfirm(null); }}
            >
              {confirm === "delete" ? "Delete" : "Start sending"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

function ContactList({ c }: { c: Campaign }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [defaultType, setDefaultType] = useState<ContactType>("creator");
  const [result, setResult] = useState<(UploadResult & { file: string }) | null>(null);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "waiting" | "sent" | "joined" | "unsubscribed">("all");
  const { data: contacts = [], isLoading } = useQuery<ContactRow[]>({ queryKey: contactsKey(c.id) });

  const upload = useMutation({
    mutationFn: async (v: { contacts: { name: string; email: string; type?: string; company?: string }[]; file: string }) =>
      (await apiRequest("POST", `/api/admin/invite-campaigns/${c.id}/contacts`, { contacts: v.contacts, defaultType })).json(),
    onSuccess: (r: UploadResult, v) => {
      setResult({ ...r, file: v.file });
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: contactsKey(c.id) });
    },
    onError: (err) => toast({ title: "Couldn't add that list", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });
  const removeOne = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/admin/invite-campaigns/${c.id}/contacts/${id}`)).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: contactsKey(c.id) }); },
    onError: (err) => toast({ title: "Couldn't take them off", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });

  const onFile = (file: File) => {
    if (!isCsvFile(file)) {
      toast({ title: "That isn't a CSV file", description: "In Google Sheets: File, Download, Comma-separated values (.csv).", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows, problem } = parseContactCsv(String(e.target?.result ?? ""), {
        maxRows: 5000,
        extras: {
          type: ["type", "accounttype", "role", "category", "kind", "creatororbrand"],
          company: ["company", "companyname", "organisation", "organization", "business"],
          full: NAME_HEADERS, first: FIRST_NAME_HEADERS, last: LAST_NAME_HEADERS,
        },
      });
      if (problem) { toast({ title: "Couldn't read that file", description: problem, variant: "destructive" }); return; }
      // Rows the reader flagged (no email, listed twice) still go, so the server counts them as left out.
      // Only a name the file has: the reader's fallback, made from the email
      // ("media@..." as "Media"), is no name to greet someone by.
      const realName = (x: Record<string, string>) => x.full || [x.first, x.last].filter(Boolean).join(" ");
      upload.mutate({ file: file.name, contacts: rows.map((r) => ({ name: realName(r.extras), email: r.email, type: r.extras.type, company: r.extras.company })) });
    };
    reader.readAsText(file);
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contacts.filter((x) => {
      if (show === "waiting" && !(x.status === "queued" || x.status === "failed")) return false;
      if (show === "sent" && x.status !== "sent") return false;
      if (show === "joined" && !x.joinedAt) return false;
      if (show === "unsubscribed" && !x.optedOutAt && x.reason !== "unsubscribed") return false;
      return !needle || [x.name, x.email, x.company ?? ""].some((v) => v.toLowerCase().includes(needle));
    });
  }, [contacts, q, show]);

  const exportRows = () => exportToCsv(`invites-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, rows, [
    { header: "Name", value: (x) => x.name },
    { header: "Email", value: (x) => x.email },
    { header: "Company", value: (x) => x.company ?? "" },
    { header: "Type", value: (x) => x.type },
    { header: "Status", value: (x) => contactStatus(x) },
    { header: "Sent (UTC)", value: (x) => (x.sentAt ? x.sentAt.slice(0, 16).replace("T", " ") : "") },
    { header: "Pass code", value: (x) => x.code ?? "" },
    { header: "Joined (UTC)", value: (x) => (x.joinedAt ? x.joinedAt.slice(0, 16).replace("T", " ") : "") },
  ]);

  const skippedBy = (result?.skipped ?? []).reduce<Record<string, number>>((m, s) => ({ ...m, [s.detail.startsWith("Already invited in") ? "Already invited in another campaign" : s.detail]: (m[s.detail.startsWith("Already invited in") ? "Already invited in another campaign" : s.detail] ?? 0) + 1 }), {});

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 space-y-3" data-testid="campaign-upload">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium mr-auto">Add people from a CSV</p>
          <Label htmlFor={`default-type-${c.id}`} className="text-xs text-muted-foreground">Rows with no type are</Label>
          <Select value={defaultType} onValueChange={(v) => setDefaultType(v as ContactType)}>
            <SelectTrigger id={`default-type-${c.id}`} className="h-8 w-28" data-testid="select-default-type"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="creator">Creators</SelectItem><SelectItem value="brand">Brands</SelectItem></SelectContent>
          </Select>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="input-campaign-csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full" disabled={upload.isPending} onClick={() => fileRef.current?.click()} data-testid="button-campaign-upload">
            <Upload className="h-3.5 w-3.5" /> {upload.isPending ? "Adding…" : "Upload CSV"}
          </Button>
          <CsvFormatHint
            required={["Email"]}
            optional={["Name", "Type (creator or brand)", "Company"]}
            example={["Name,Email,Type,Company", "Ana Rivera,ana@example.com,Creator,", "Sam Lee,sam@acmestudio.com,Brand,Acme Studio"]}
            note="People who already have an account, are on a campaign already, or unsubscribed before are left out. Up to 5,000 rows per file."
            testId="button-campaign-csv-hint"
          />
        </div>
        {result && (
          <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1" data-testid="campaign-upload-result">
            <p><span className="font-medium">{result.file}:</span> {result.added} added ({result.added_by_type.creator} creators, {result.added_by_type.brand} brands).</p>
            {result.skipped.length > 0 && (
              <p className="text-muted-foreground">
                {result.skipped.length} left out: {Object.entries(skippedBy).map(([why, n]) => `${n} ${why.toLowerCase()}`).join(", ")}.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or company" className="h-9 pl-9" data-testid="campaign-search" />
        </div>
        <Select value={show} onValueChange={(v) => setShow(v as typeof show)}>
          <SelectTrigger className="h-9 w-36" data-testid="campaign-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="waiting">Waiting</SelectItem>
            <SelectItem value="sent">Invited</SelectItem>
            <SelectItem value="joined">Joined</SelectItem>
            <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9" onClick={exportRows} disabled={rows.length === 0} data-testid="campaign-export">Export CSV</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="campaign-empty">No one on the list yet.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one matches that.</p>
      ) : (
        <ul className="divide-y rounded-lg border max-h-[32rem] overflow-y-auto" data-testid="campaign-contacts">
          {rows.slice(0, 1000).map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`campaign-contact-${x.id}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{x.name || x.company || x.email}{x.company && x.name ? <span className="font-normal text-muted-foreground"> · {x.company}</span> : null}</p>
                <p className="truncate text-xs text-muted-foreground">{x.email} · {x.type === "brand" ? "Brand" : "Creator"}</p>
              </div>
              <Badge variant="outline" className={cn("shrink-0 px-2 py-0 text-[11px] font-medium",
                x.joinedAt && "border-green-600/25 bg-green-500/10 text-green-700 dark:text-green-400",
                (x.optedOutAt || x.status === "skipped") && "text-muted-foreground")}>
                {contactStatus(x)}
              </Badge>
              {(x.status === "queued" || (x.status === "failed" && !x.code)) && (
                <button className="shrink-0 text-muted-foreground hover:text-destructive" title="Take off the list" aria-label={`Take ${x.email} off the list`}
                  onClick={() => removeOne.mutate(x.id)} data-testid={`button-remove-contact-${x.id}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
          {rows.length > 1000 && <li className="px-3 py-2 text-xs text-muted-foreground">And {rows.length - 1000} more. Search or export to see them.</li>}
        </ul>
      )}
    </div>
  );
}

// ── Emails and settings ──────────────────────────────────────────────────────

function settingsOf(c: Campaign): Settings {
  const { name, fromName, replyTo, creatorSubject, creatorBody, brandSubject, brandBody, ctaLabel, creatorFreeDays, brandFreeDays, useWithinDays, dailyLimit, postalAddress } = c;
  return { name, fromName, replyTo, creatorSubject, creatorBody, brandSubject, brandBody, ctaLabel, creatorFreeDays, brandFreeDays, useWithinDays, dailyLimit, postalAddress };
}

function useSave(c: Campaign) {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: Settings) => (await apiRequest("PUT", `/api/admin/invite-campaigns/${c.id}`, s)).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast({ title: "Saved" }); },
    onError: (err) => toast({ title: "Couldn't save", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });
}

function EmailEditor({ c, data }: { c: Campaign; data: Overview }) {
  const { toast } = useToast();
  const [type, setType] = useState<ContactType>("creator");
  const [draft, setDraft] = useState<Settings>(() => settingsOf(c));
  const [preview, setPreview] = useState<{ subject: string; html: string; to: { name: string; email: string } | null } | null>(null);
  const save = useSave(c);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settingsOf(c));
  const subjectKey = type === "brand" ? "brandSubject" : "creatorSubject";
  const bodyKey = type === "brand" ? "brandBody" : "creatorBody";

  const render = useMutation({
    mutationFn: async (send: boolean) => (await apiRequest("POST", `/api/admin/invite-campaigns/${c.id}/preview`, { type, settings: draft, send })).json(),
    onSuccess: (r, send) => {
      setPreview(r);
      if (send) toast({ title: "Test sent", description: `Check ${r.sentTo}. It has a sample code that won't work.` });
    },
    onError: (err) => toast({ title: "Couldn't show the email", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });
  // Re-render the preview a moment after typing stops, and when switching type.
  useEffect(() => {
    const t = setTimeout(() => render.mutate(false), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, draft]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 min-w-0">
        <div className="inline-flex rounded-full border p-0.5" role="tablist">
          {(["creator", "brand"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={type === t} onClick={() => setType(t)}
              className={cn("rounded-full px-3 py-1 text-sm", type === t ? "bg-foreground text-background" : "text-muted-foreground")}
              data-testid={`button-email-type-${t}`}>
              {t === "brand" ? `To brands (${c.byType.brand})` : `To creators (${c.byType.creator})`}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`subject-${c.id}`}>Subject</Label>
          <Input id={`subject-${c.id}`} value={draft[subjectKey]} onChange={(e) => setDraft({ ...draft, [subjectKey]: e.target.value })} data-testid="input-campaign-subject" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`body-${c.id}`}>Message</Label>
          <Textarea id={`body-${c.id}`} rows={9} value={draft[bodyKey]} onChange={(e) => setDraft({ ...draft, [bodyKey]: e.target.value })} data-testid="input-campaign-body" />
          <p className="text-xs text-muted-foreground">
            {"{{FirstName}}"} and {"{{CompanyName}}"} are filled in for each person. The pass, its button and the unsubscribe line are added under your message.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`cta-${c.id}`}>Button text</Label>
          <Input id={`cta-${c.id}`} value={draft.ctaLabel} onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })} data-testid="input-campaign-cta" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending} data-testid="button-campaign-save-emails">
            {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => render.mutate(true)} disabled={render.isPending || !data.emailConfigured} data-testid="button-campaign-test">
            <Send className="h-3.5 w-3.5" /> Send me a test
          </Button>
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>From: <span className="text-foreground">{draft.fromName || "MTRLZD"} &lt;{data.fromAddress}&gt;</span></p>
          <p>To: <span className="text-foreground">{preview?.to ? `${preview.to.name || preview.to.email} (first ${type} on the list)` : `a sample ${type}`}</span></p>
          <p>Subject: <span className="text-foreground" data-testid="text-preview-subject">{preview?.subject ?? "…"}</span></p>
        </div>
        <iframe title="Invite preview" sandbox="" srcDoc={preview?.html ?? ""} className="h-[28rem] w-full rounded-lg border bg-white" data-testid="frame-campaign-preview" />
      </div>
    </div>
  );
}

function SettingsForm({ c, data }: { c: Campaign; data: Overview }) {
  const [draft, setDraft] = useState<Settings>(() => settingsOf(c));
  const save = useSave(c);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settingsOf(c));
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: e.target.value === "" ? ("" as any) : Number(e.target.value) });
  const field = (id: string, label: string, input: React.ReactNode, hint?: string) => (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor={`${id}-${c.id}`}>{label}</Label>
      {input}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("name", "Campaign name", <Input id={`name-${c.id}`} value={draft.name} disabled={c.totals.sent > 0} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="input-campaign-name" />,
          c.totals.sent > 0 ? "Fixed now: it's on the passes already sent." : "Sign-ups show this as their source in Activity.")}
        {field("daily", "How many a day", <Input id={`daily-${c.id}`} type="number" min={1} max={data.maxDailyLimit} value={draft.dailyLimit} onChange={num("dailyLimit")} data-testid="input-campaign-daily" />,
          `Spread over ${windowLabel(data.window)} your time.`)}
        {field("from", "Sender name", <Input id={`from-${c.id}`} value={draft.fromName ?? ""} placeholder="MTRLZD" onChange={(e) => setDraft({ ...draft, fromName: e.target.value })} data-testid="input-campaign-from" />,
          `Sent from ${data.fromAddress}.`)}
        {field("reply", "Replies go to", <Input id={`reply-${c.id}`} type="email" value={draft.replyTo ?? ""} placeholder={data.fromAddress} onChange={(e) => setDraft({ ...draft, replyTo: e.target.value })} data-testid="input-campaign-reply" />,
          "Leave empty for replies to reach the sending address.")}
        {field("cdays", "Creator Pass: free days", <Input id={`cdays-${c.id}`} type="number" min={1} max={365} value={draft.creatorFreeDays} onChange={num("creatorFreeDays")} data-testid="input-campaign-creator-days" />)}
        {field("bdays", "Brand Pass: free days", <Input id={`bdays-${c.id}`} type="number" min={1} max={365} value={draft.brandFreeDays} onChange={num("brandFreeDays")} data-testid="input-campaign-brand-days" />)}
        {field("within", "Pass must be used within (days)", <Input id={`within-${c.id}`} type="number" min={1} max={365} value={draft.useWithinDays} onChange={num("useWithinDays")} data-testid="input-campaign-within" />,
          "Counted from the day their email goes. Changes apply to invites not sent yet.")}
      </div>
      {field("address", "Postal address for the foot of the email",
        <Textarea id={`address-${c.id}`} rows={2} value={draft.postalAddress ?? ""} placeholder="Company name, street, city, state ZIP" onChange={(e) => setDraft({ ...draft, postalAddress: e.target.value })} data-testid="input-campaign-address" />,
        "Required before starting: US law (CAN-SPAM) asks every commercial email to show one.")}
      <Button size="sm" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending} data-testid="button-campaign-save-settings">
        {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
      </Button>
    </div>
  );
}
