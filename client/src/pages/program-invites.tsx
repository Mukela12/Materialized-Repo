/**
 * Invite your network: a producer (or any account an admin switched on)
 * invites its designers and influencers in one go. Add people from a CSV or
 * by hand, write one message with {first_name}, see the exact email, send.
 * Each person gets their own free code by email; the Sent tab shows who
 * joined. Asked for by the client on 7 Oct 2026, so Fashion Week producers
 * no longer have to email voucher codes out themselves.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Mail, Plus, Send, Trash2, Upload, Users } from "lucide-react";
import { apiRequest, serverMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { parseContactCsv, isCsvFile } from "@/lib/csvImport";
import { CsvFormatHint } from "@/components/CsvFormatHint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useProgram } from "@/hooks/useProgram";

type Seat = "brand" | "creator";
const WORD: Record<Seat, string> = { brand: "Designer", creator: "Influencer" };

interface Row { key: number; name: string; email: string; type: Seat | ""; error?: string }
interface SendResult { email: string; name?: string; type?: string; status: "sent" | "skipped" | "failed"; reason?: string }
interface SentInvite { id: string; name: string; email: string; type: Seat; sentAt: string; joined: boolean }

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const seatOf = (raw?: string): Seat | "" => {
  const v = (raw ?? "").trim().toLowerCase();
  if (/^(designer|designers|brand|brands|label|labels|house)$/.test(v)) return "brand";
  if (/^(influencer|influencers|creator|creators|talent|model|models)$/.test(v)) return "creator";
  return "";
};

export default function ProgramInvites() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me, isLoading } = useProgram();
  const { data: sent = [] } = useQuery<SentInvite[]>({ queryKey: ["/api/program/invites"], enabled: !!me?.enabled });

  const [rows, setRows] = useState<Row[]>([]);
  const nextKey = useRef(1);
  const [defaultType, setDefaultType] = useState<Seat>("brand");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Start from the program's wording once it arrives.
  useEffect(() => {
    if (me?.enabled) {
      setSubject((s) => s || me.defaultSubject || "");
      setMessage((m) => m || me.defaultMessage || "");
      const open = (["brand", "creator"] as Seat[]).find((t) => !me.seats?.[t].problem);
      if (open) setDefaultType(open);
    }
  }, [me?.enabled]);

  const check = (r: Row, all: Row[]): string | undefined => {
    if (!EMAIL.test(r.email.trim())) return "Email doesn't look right";
    if (!r.type) return "Choose designer or influencer";
    const dup = all.find((o) => o.key !== r.key && o.email.trim().toLowerCase() === r.email.trim().toLowerCase());
    if (dup && dup.key < r.key) return "Listed twice";
    if (sent.some((s) => s.email === r.email.trim().toLowerCase())) return "Already invited";
    const seat = me?.seats?.[r.type];
    if (seat?.problem) return seat.problem;
    return undefined;
  };
  const checked = useMemo(() => rows.map((r) => ({ ...r, error: check(r, rows) })), [rows, sent, me]);
  const ready = checked.filter((r) => !r.error);
  const count = (t: Seat) => ready.filter((r) => r.type === t).length;
  const over = (["brand", "creator"] as Seat[]).filter((t) => me?.seats && count(t) > me.seats[t].remaining);

  const addRows = (list: { name: string; email: string; type?: string }[]) =>
    setRows((prev) => [...prev, ...list.map((r) => ({ key: nextKey.current++, name: r.name, email: r.email, type: seatOf(r.type) || defaultType }))]);

  const onFile = (file: File) => {
    if (!isCsvFile(file)) {
      toast({ title: "That isn't a CSV file", description: "Save your spreadsheet as CSV first. Tap the (i) for how.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows: parsed, problem } = parseContactCsv(String(e.target?.result ?? ""), {
        extras: { type: ["type", "role", "kind", "seat", "category", "designerorinfluencer"] },
        maxRows: me?.maxRecipients ?? 200,
      });
      if (problem) { toast({ title: "Couldn't read that file", description: problem, variant: "destructive" }); return; }
      addRows(parsed.map((r) => ({ name: r.name, email: r.email, type: r.extras.type })));
      toast({ title: `${parsed.length} ${parsed.length === 1 ? "person" : "people"} added` });
    };
    reader.readAsText(file);
  };

  const insertField = (field: string) => {
    const el = messageRef.current;
    if (!el) { setMessage((m) => m + field); return; }
    const { selectionStart: a, selectionEnd: b } = el;
    setMessage((m) => m.slice(0, a) + field + m.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + field.length, a + field.length); });
  };

  // The preview is the real email, rendered by the server, for the first person on the list.
  const sample = ready[0] ?? checked[0];
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  useEffect(() => {
    if (!me?.enabled) return;
    const t = setTimeout(async () => {
      try {
        const res = await apiRequest("POST", "/api/program/preview", {
          subject, message,
          recipient: sample ? { name: sample.name, email: sample.email, type: sample.type || defaultType } : undefined,
        });
        setPreview(await res.json());
      } catch { /* keep the last preview */ }
    }, 350);
    return () => clearTimeout(t);
  }, [me?.enabled, subject, message, sample?.name, sample?.email, sample?.type, defaultType]);

  const send = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/program/invites", {
        subject, message, recipients: ready.map((r) => ({ name: r.name, email: r.email, type: r.type })),
      });
      return (await res.json()) as { sent: number; results: SendResult[] };
    },
    onSuccess: (data) => {
      setConfirming(false);
      setResults(data.results);
      const sentEmails = new Set(data.results.filter((r) => r.status === "sent").map((r) => r.email));
      setRows((prev) => prev.filter((r) => !sentEmails.has(r.email.trim().toLowerCase())));
      qc.invalidateQueries({ queryKey: ["/api/program/me"] });
      qc.invalidateQueries({ queryKey: ["/api/program/invites"] });
      toast({ title: data.sent === 1 ? "1 invite sent" : `${data.sent} invites sent` });
    },
    onError: (err) => {
      setConfirming(false);
      toast({ title: "Couldn't send the invites", description: serverMessage(err) || "Please try again.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 py-24 justify-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>;
  }
  if (!me?.enabled) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center space-y-3" data-testid="program-not-enabled">
        <Users className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">Invite your network</h1>
        <p className="text-sm text-muted-foreground">
          This lets event and program partners invite their designers and influencers with free access.
          It isn't switched on for your account yet. Ask the MTRLZD team to set it up.
        </p>
      </div>
    );
  }

  const seats = me.seats!;
  return (
    <div className="space-y-6 pb-24 md:pb-8" data-testid="program-invites">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Invite your network</h1>
        <p className="mt-1 text-muted-foreground">
          {me.programName}: invite your designers and influencers. Each person gets their own free code by email, and you can see who joins.
        </p>
      </div>

      {/* Two tiles that only show numbers: side by side at every width, compact
          on a phone, so they don't push the list and message down the screen. */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {(["brand", "creator"] as Seat[]).map((t) => (
          <div key={t} className="min-w-0 rounded-xl border bg-card p-3 sm:p-4" data-testid={`seat-${t}`}>
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{WORD[t]}s</p>
            {seats[t].problem ? (
              <p className="mt-1 text-xs sm:text-sm leading-snug text-muted-foreground">{seats[t].problem}</p>
            ) : (
              <>
                <p className="mt-0.5 text-xl sm:text-2xl font-semibold tabular-nums leading-tight">
                  {seats[t].remaining}
                  <span className="text-xs sm:text-sm font-normal text-muted-foreground"> of {seats[t].limit}<span className="hidden sm:inline"> invites</span> left</span>
                </p>
                <p className="mt-0.5 text-[11px] sm:text-xs leading-snug text-muted-foreground">{seats[t].offer}</p>
              </>
            )}
          </div>
        ))}
      </div>

      {!me.emailReady && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Email sending isn't set up on the server yet, so invites can't go out. Ask the MTRLZD team to finish setting it up.
        </p>
      )}

      <Tabs defaultValue="send">
        <TabsList>
          <TabsTrigger value="send" data-testid="tab-send">Send invites</TabsTrigger>
          <TabsTrigger value="sent" data-testid="tab-sent">Sent {sent.length > 0 && <span className="ml-1.5 tabular-nums opacity-70">{sent.length}</span>}</TabsTrigger>
        </TabsList>

        <TabsContent value="send" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-6 min-w-0">
              {/* 1. People */}
              <section className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">1. Who to invite</h2>
                  <div className="flex items-center gap-1">
                    <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="input-program-csv"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
                    <Button size="sm" variant="outline" className="gap-1.5 rounded-full" onClick={() => fileRef.current?.click()} data-testid="button-upload-csv">
                      <Upload className="h-3.5 w-3.5" /> Upload CSV
                    </Button>
                    <CsvFormatHint
                      required={["Name", "Email"]}
                      optional={["Type (designer or influencer)"]}
                      example={["Name,Email,Type", "Ava Laurent,ava@laurentstudio.com,designer", "Jordan Ellis,jordan@ellis.co,influencer"]}
                      note="Rows without a type use the choice below."
                      testId="button-program-csv-hint"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">People without a type are</span>
                  <Select value={defaultType} onValueChange={(v) => setDefaultType(v as Seat)}>
                    <SelectTrigger className="h-8 w-36" data-testid="select-default-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="brand">Designers</SelectItem>
                      <SelectItem value="creator">Influencers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {checked.length > 0 && (
                  <ul className="divide-y rounded-lg border max-h-[22rem] overflow-y-auto" data-testid="program-rows">
                    {checked.map((r) => (
                      <li key={r.key} className="px-2 py-2" data-testid="program-row">
                        {/* The fields on one line, a problem on the line under them, so an
                            error never squeezes the name and email into "Bad R" and "not-an-e". */}
                        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                        <Input value={r.name} placeholder="Name" aria-label="Name" className="h-8 min-w-0 flex-1 basis-32"
                          onChange={(e) => setRows((p) => p.map((x) => x.key === r.key ? { ...x, name: e.target.value } : x))} />
                        <Input value={r.email} placeholder="Email" aria-label="Email" inputMode="email" className="h-8 min-w-0 flex-[1.4] basis-44"
                          onChange={(e) => setRows((p) => p.map((x) => x.key === r.key ? { ...x, email: e.target.value } : x))} />
                        <Select value={r.type || undefined} onValueChange={(v) => setRows((p) => p.map((x) => x.key === r.key ? { ...x, type: v as Seat } : x))}>
                          <SelectTrigger className="h-8 w-32" aria-label="Type"><SelectValue placeholder="Type" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="brand">Designer</SelectItem>
                            <SelectItem value="creator">Influencer</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Remove"
                          onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        </div>
                        {r.error && <p className="mt-1 px-1 text-xs text-destructive" data-testid="row-error">{r.error}</p>}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => addRows([{ name: "", email: "", type: defaultType }])} data-testid="button-add-person">
                    <Plus className="h-4 w-4" /> Add a person
                  </Button>
                  {rows.length > 0 && (
                    <p className="text-xs text-muted-foreground" data-testid="program-counts">
                      {count("brand")} designer{count("brand") === 1 ? "" : "s"}, {count("creator")} influencer{count("creator") === 1 ? "" : "s"} ready
                      {checked.length - ready.length > 0 && `, ${checked.length - ready.length} to fix`}
                    </p>
                  )}
                </div>
              </section>

              {/* 2. Message */}
              <section className="rounded-xl border bg-card p-4 space-y-3">
                <h2 className="font-semibold">2. Your message</h2>
                <div className="space-y-1.5">
                  <Label htmlFor="program-subject">Subject</Label>
                  <Input id="program-subject" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} data-testid="input-program-subject" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="program-message">Message</Label>
                    <div className="flex gap-1">
                      {["{first_name}", "{name}"].map((f) => (
                        <button key={f} type="button" onClick={() => insertField(f)}
                          className="rounded-full border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted"
                          data-testid={`insert-${f.replace(/[{}]/g, "")}`}>
                          + {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Textarea id="program-message" ref={messageRef} value={message} rows={9} maxLength={3000}
                    onChange={(e) => setMessage(e.target.value)} data-testid="input-program-message" />
                  <p className="text-xs text-muted-foreground">
                    {"{first_name}"} becomes each person's first name. Their free code and a Join button are added under your message.
                  </p>
                </div>
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <Button className="gap-2 rounded-full" disabled={ready.length === 0 || over.length > 0 || !message.trim() || !me.emailReady}
                  onClick={() => setConfirming(true)} data-testid="button-send-invites">
                  <Send className="h-4 w-4" /> {ready.length > 0 ? `Send ${ready.length} invite${ready.length === 1 ? "" : "s"}` : "Send invites"}
                </Button>
                {over.map((t) => (
                  <p key={t} className="text-xs text-destructive" data-testid="over-limit">
                    {count(t)} {WORD[t].toLowerCase()}s listed, {seats[t].remaining} invites left. Remove {count(t) - seats[t].remaining}.
                  </p>
                ))}
              </div>

              {results && (
                <section className="rounded-xl border bg-card p-4 space-y-2" data-testid="send-results">
                  <h2 className="font-semibold">Last send</h2>
                  <ul className="space-y-1 text-sm">
                    {results.map((r, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                        <span className={cn("font-medium", r.status === "sent" ? "text-green-700 dark:text-green-400" : r.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                          {r.status === "sent" ? "Sent" : r.status === "failed" ? "Failed" : "Skipped"}
                        </span>
                        <span className="min-w-0 truncate">{r.name ? `${r.name}, ` : ""}{r.email}</span>
                        {r.reason && <span className="text-xs text-muted-foreground">{r.reason}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {/* Preview: the real email */}
            <section className="min-w-0 space-y-2 lg:sticky lg:top-4 lg:self-start" data-testid="program-preview">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Preview{sample?.name ? ` for ${sample.name}` : ""}
              </p>
              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium" data-testid="preview-subject">{preview?.subject ?? "…"}</span>
                </div>
                {preview ? (
                  <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="block h-[34rem] w-full border-0 bg-[#f6f6f6]" data-testid="preview-frame" />
                ) : (
                  <div className="flex h-[34rem] items-center justify-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
                )}
              </div>
            </section>
          </div>
        </TabsContent>

        <TabsContent value="sent" className="mt-4">
          {sent.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No invites sent yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card" data-testid="sent-list">
              {sent.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.email} · {WORD[s.type]} · {new Date(s.sentAt).toLocaleDateString()}</p>
                  </div>
                  {s.joined
                    ? <Badge className="gap-1 border-0 bg-green-500/15 text-green-700 dark:text-green-400"><CheckCircle2 className="h-3 w-3" /> Joined</Badge>
                    : <Badge variant="secondary">Invited</Badge>}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirming} onOpenChange={(o) => !send.isPending && setConfirming(o)}>
        <AlertDialogContent data-testid="dialog-confirm-send">
          <AlertDialogHeader>
            <AlertDialogTitle>Send {ready.length} invite{ready.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {count("brand")} designer{count("brand") === 1 ? "" : "s"} and {count("creator")} influencer{count("creator") === 1 ? "" : "s"} will
              each get your message and their own free code. Replies come to your email.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={send.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={send.isPending} onClick={(e) => { e.preventDefault(); send.mutate(); }} data-testid="button-confirm-send">
              {send.isPending ? "Sending…" : "Send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
