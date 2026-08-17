/**
 * Minting and managing vouchers.
 *
 * The offer this exists for: 20 free creator accounts, given to a brand who
 * subscribes, for a promotional period. Before this there was one shared string
 * in an environment variable — same code for everyone, uncapped, no expiry, and
 * revocable only by rotating it for everybody at once.
 *
 * The seats-remaining column is the point of the screen. "How many of my twenty
 * are left" is the question a brand asks, and it needs answering without anyone
 * running a query.
 */
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Ticket, Copy, Ban, Check, Download, Upload, CalendarClock } from "lucide-react";
import { exportToCsv } from "@/lib/exportCsv";

interface VoucherRow {
  id: string;
  code: string;
  label: string | null;
  grantType: "free_access" | "waive_setup_fee";
  roleRestriction: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  seatsRemaining: number | null;
  /** Null means usable immediately — how every code behaved before 0027. */
  activeFrom: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Groups one mint — "the 80 I gave Vogue". */
  batchId: string | null;
  /** Who it was handed to. Free text: most recipients have no account yet. */
  assignedTo: string | null;
  /** Which partner within that batch. Filled in by the organiser, not by us. */
  partner: string | null;
  /** Who actually redeemed it, once someone has. */
  redeemedBy: string | null;
}

/** The GTM offer, prefilled — it is the reason this screen exists. */
const GTM_DEFAULTS = {
  label: "GTM — creator seats",
  grantType: "free_access" as const,
  roleRestriction: "creator",
  maxRedemptions: "1",
  quantity: "20",
  assignedTo: "",
};

/**
 * "affiliate" is the database word; "Publisher" is the word the client and her
 * partners use, and the word on the signup form. Showing the internal one on a
 * screen used to hand out codes invites handing a publisher a brand code.
 */
function roleLabel(role: string | null): string {
  if (role === "affiliate") return "Publisher";
  if (role === "brand") return "Brand";
  if (role === "creator") return "Creator";
  return "Any";
}

export function VoucherManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...GTM_DEFAULTS, code: "", activeFrom: "", expiresAt: "" });
  const [editing, setEditing] = useState<Record<string, string>>({});
  /**
   * Which recipient's codes to show.
   *
   * One partner's allocation is 80 codes, and there is more than one partner.
   * An unfiltered list is several hundred rows in which "have Liverpool's
   * brands started signing up" is unanswerable by eye, and the CSV handed to a
   * partner would contain every other partner's codes.
   */
  const [recipient, setRecipient] = useState<string>("all");
  const [copied, setCopied] = useState<string | null>(null);
  const [datesOpen, setDatesOpen] = useState(false);
  const [dates, setDates] = useState({ activeFrom: "", expiresAt: "" });
  const partnerFileRef = useRef<HTMLInputElement>(null);

  const { data: vouchers = [], isLoading } = useQuery<VoucherRow[]>({
    queryKey: ["/api/admin/vouchers"],
  });

  const create = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/admin/vouchers", body),
    onSuccess: async (res: any) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/vouchers"] });
      const body = typeof res?.json === "function" ? await res.json() : res;
      setForm({ ...GTM_DEFAULTS, code: "", activeFrom: "", expiresAt: "" });
      toast({
        title: body?.count > 1 ? `${body.count} vouchers created` : "Voucher created",
        description: body?.count > 1 ? "Export them as CSV to hand to a partner." : undefined,
      });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Could not create voucher", variant: "destructive" }),
  });

  const assign = useMutation({
    mutationFn: ({ id, assignedTo }: { id: string; assignedTo: string }) =>
      apiRequest("PATCH", `/api/admin/vouchers/${id}/assignee`, { assignedTo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/vouchers"] }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/vouchers/${id}/revoke`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/vouchers"] });
      toast({ title: "Voucher revoked", description: "Accounts already created with it keep their access." });
    },
  });

  /**
   * Read the PARTNER column back out of the organiser's spreadsheet.
   *
   * Parsed in the browser and posted as rows, matching the creator-invite
   * importer — the server never sees a file, and only code+partner crosses.
   */
  const importPartners = useMutation({
    mutationFn: (entries: Array<{ code: string; partner: string }>) =>
      apiRequest("POST", "/api/admin/vouchers/partners", { entries }),
    onSuccess: async (res) => {
      const body = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/admin/vouchers"] });
      // Naming the unmatched codes matters: a spreadsheet edited by a third
      // party is exactly where a code gets mangled, and a bare count of what
      // failed gives nobody anything to act on.
      const missed: string[] = body.unmatched ?? [];
      toast({
        title: `${body.updated} code${body.updated === 1 ? "" : "s"} updated`,
        description: missed.length
          ? `${missed.length} not recognised: ${missed.slice(0, 3).join(", ")}${missed.length > 3 ? "…" : ""}`
          : undefined,
        variant: missed.length ? "destructive" : undefined,
      });
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const onPartnerFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({ title: "That is not a CSV", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = Papa.parse<Record<string, string>>(String(reader.result ?? ""), {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.toLowerCase().trim(),
      });
      if (parsed.errors.length > 0) {
        toast({ title: "Could not read that CSV", description: parsed.errors[0].message, variant: "destructive" });
        return;
      }
      const entries = parsed.data
        .map(r => ({ code: (r.code ?? "").trim(), partner: (r.partner ?? "").trim() }))
        .filter(r => r.code && r.partner);

      if (entries.length === 0) {
        toast({
          title: "Nothing to import",
          description: "The file needs a 'Code' column and a filled-in 'PARTNER' column.",
          variant: "destructive",
        });
        return;
      }
      importPartners.mutate(entries);
    };
    reader.readAsText(file);
  };

  /** Dates for a whole batch — nobody sets 81 codes one at a time. */
  const setWindow = useMutation({
    mutationFn: (vars: { assignedTo: string; activeFrom: string | null; expiresAt: string | null }) =>
      apiRequest("PATCH", "/api/admin/vouchers/window", vars),
    onSuccess: async (res) => {
      const body = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/admin/vouchers"] });
      setDatesOpen(false);
      toast({ title: `Dates set on ${body.updated} code${body.updated === 1 ? "" : "s"}` });
    },
    onError: async (err: any) => {
      let detail = "";
      try { detail = (await err?.response?.json?.())?.error ?? ""; } catch { /* keep generic */ }
      toast({ title: "Could not set dates", description: detail || undefined, variant: "destructive" });
    },
  });

  const copy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  /** Recipients that actually have codes, for the filter. */
  const recipients = Array.from(
    new Set(vouchers.map(v => v.assignedTo?.trim()).filter((x): x is string => !!x)),
  ).sort((a, b) => a.localeCompare(b));

  const shown = recipient === "all"
    ? vouchers
    : vouchers.filter(v => (v.assignedTo?.trim() ?? "") === recipient);

  /** What this allocation is made of — she orders them 50 brand / 30 publisher. */
  const tally = shown.reduce((acc, v) => {
    const k = roleLabel(v.roleRestriction);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const redeemed = shown.filter(v => v.redemptionCount > 0).length;

  const status = (v: VoucherRow) => {
    if (v.revokedAt) return <Badge variant="destructive">Revoked</Badge>;
    if (v.expiresAt && new Date(v.expiresAt) <= new Date()) return <Badge variant="secondary">Expired</Badge>;
    if (v.seatsRemaining === 0) return <Badge variant="secondary">Fully used</Badge>;
    return <Badge>Active</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Ticket className="h-4 w-4" />
            Create a voucher
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Leave the code blank to generate one. Codes avoid characters that get misread
            when read aloud, so they are safe to give out over the phone.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>What it is for</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="GTM — Nike, 20 creator seats"
                data-testid="input-voucher-label"
              />
            </div>
            <div>
              <Label>Who you are giving them to</Label>
              <Input
                value={form.assignedTo}
                onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                placeholder="Vogue, Selfridges, a partner's name…"
                data-testid="input-voucher-assignee"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Applies to every code in this batch. You can change it per code later.
              </p>
            </div>
            <div>
              <Label>Code (optional)</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="leave blank to generate"
                data-testid="input-voucher-code"
              />
            </div>
            <div>
              <Label>Grants</Label>
              <Select value={form.grantType} onValueChange={(v) => setForm({ ...form, grantType: v as any })}>
                <SelectTrigger data-testid="select-voucher-grant"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free_access">Free access (no subscription)</SelectItem>
                  <SelectItem value="waive_setup_fee">Waive the $29 setup fee</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Who can use it</Label>
              <Select
                value={form.roleRestriction || "any"}
                onValueChange={(v) => setForm({ ...form, roleRestriction: v === "any" ? "" : v })}
              >
                <SelectTrigger data-testid="select-voucher-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any account type</SelectItem>
                  <SelectItem value="creator">Creators only</SelectItem>
                  <SelectItem value="brand">Brands only</SelectItem>
                  <SelectItem value="affiliate">Publishers only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>How many codes to create</Label>
              <Input
                type="number" min={1} max={200}
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                data-testid="input-voucher-quantity"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Separate codes, one per recipient — so you can see who used which and
                revoke just one.
              </p>
            </div>
            <div>
              <Label>How many times EACH can be used</Label>
              <Input
                type="number" min={1}
                value={form.maxRedemptions}
                onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
                placeholder="blank = unlimited"
                data-testid="input-voucher-max"
              />
            </div>
            <div>
              <Label>Active from (optional)</Label>
              <Input
                type="date"
                value={form.activeFrom}
                onChange={(e) => setForm({ ...form, activeFrom: e.target.value })}
                data-testid="input-voucher-active-from-new"
              />
            </div>
            <div>
              <Label>Expires (optional)</Label>
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                data-testid="input-voucher-expiry"
              />
            </div>
          </div>

          <Button
            onClick={() => create.mutate({
              ...form,
              quantity: Number(form.quantity) || 1,
              code: form.code || undefined,
              roleRestriction: form.roleRestriction || undefined,
              maxRedemptions: form.maxRedemptions || null,
              activeFrom: form.activeFrom || null,
              expiresAt: form.expiresAt || null,
            })}
            disabled={create.isPending}
            data-testid="button-create-voucher"
          >
            {/* Says the count, because minting eighty codes should not look
                identical to minting one right up until it happens. */}
            {create.isPending
              ? "Creating…"
              : Number(form.quantity) > 1
                ? `Create ${Number(form.quantity)} vouchers`
                : "Create voucher"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base">Vouchers</CardTitle>
              {shown.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-voucher-tally">
                  {shown.length} code{shown.length === 1 ? "" : "s"}
                  {" — "}
                  {Object.entries(tally).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}
                  {redeemed > 0 && ` · ${redeemed} redeemed`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {recipients.length > 0 && (
                <Select value={recipient} onValueChange={setRecipient}>
                  <SelectTrigger className="h-9 w-[200px]" data-testid="select-voucher-recipient">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everyone ({vouchers.length})</SelectItem>
                    {recipients.map(r => (
                      <SelectItem key={r} value={r}>
                        {r} ({vouchers.filter(v => (v.assignedTo?.trim() ?? "") === r).length})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            <Button
              variant="outline" size="sm" className="gap-1.5"
              disabled={shown.length === 0}
              onClick={() => exportToCsv(
                // Name the file after whose codes are in it, so two partners'
                // spreadsheets cannot be confused for one another on a desktop.
                recipient === "all"
                  ? "mtrlzd-vouchers"
                  : `mtrlzd-vouchers-${recipient.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                shown, [
                { header: "Code", value: (v) => v.code },
                // PARTNER sits second, right beside the code, because it is the
                // column the organiser is being asked to fill in — at the far
                // right of eleven columns it is missed.
                { header: "PARTNER", value: (v) => v.partner ?? "" },
                { header: "Given to", value: (v) => v.assignedTo ?? "" },
                { header: "For", value: (v) => v.label ?? "" },
                { header: "Grants", value: (v) => v.grantType === "free_access" ? "Free access" : "Setup fee waived" },
                { header: "Who can use", value: (v) => v.roleRestriction ?? "any" },
                { header: "Uses left", value: (v) => v.seatsRemaining == null ? "unlimited" : String(v.seatsRemaining) },
                { header: "Redeemed by", value: (v) => v.redeemedBy ?? "" },
                { header: "Activation", value: (v) => v.activeFrom ? v.activeFrom.slice(0, 10) : "" },
                { header: "Expires", value: (v) => v.expiresAt ? v.expiresAt.slice(0, 10) : "" },
                { header: "Status", value: (v) => v.revokedAt ? "Revoked" : v.seatsRemaining === 0 ? "Used" : "Active" },
              ])}
              data-testid="button-export-vouchers"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>

            {/* The other half of the round-trip. Hidden input, because a bare
                file picker beside two buttons reads as a broken layout. */}
            <input
              ref={partnerFileRef}
              type="file"
              accept=".csv"
              className="hidden"
              data-testid="input-partner-csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPartnerFile(f);
                // Reset so re-picking the same filename fires change again.
                e.target.value = "";
              }}
            />
            <Button
              variant="outline" size="sm" className="gap-1.5"
              disabled={importPartners.isPending}
              onClick={() => partnerFileRef.current?.click()}
              data-testid="button-import-partners"
            >
              <Upload className="h-3.5 w-3.5" />
              {importPartners.isPending ? "Importing…" : "Import PARTNER"}
            </Button>

            {/* Dating a batch needs a batch selected — "all" is not one. */}
            <Button
              variant="outline" size="sm" className="gap-1.5"
              disabled={recipient === "all" || shown.length === 0}
              title={recipient === "all" ? "Pick a recipient first" : undefined}
              onClick={() => {
                const first = shown[0];
                setDates({
                  activeFrom: first?.activeFrom?.slice(0, 10) ?? "",
                  expiresAt: first?.expiresAt?.slice(0, 10) ?? "",
                });
                setDatesOpen(true);
              }}
              data-testid="button-set-voucher-dates"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Set dates
            </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Revoking stops new redemptions. Accounts already created with a voucher keep
            what they were given.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {vouchers.length === 0 ? "No vouchers yet." : `No codes for ${recipient}.`}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-vouchers">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Given to</th>
                    <th className="py-2 pr-4">Seats left</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((v) => (
                    <tr key={v.id} className="border-b last:border-0" data-testid={`voucher-${v.id}`}>
                      <td className="py-2 pr-4 font-mono text-xs">
                        <button
                          onClick={() => copy(v.code)}
                          className="inline-flex items-center gap-1.5 hover:underline"
                          title="Copy"
                        >
                          {v.code}
                          {copied === v.code
                            ? <Check className="h-3 w-3 text-primary" />
                            : <Copy className="h-3 w-3 opacity-50" />}
                        </button>
                      </td>
                      {/* WHAT THE CODE IS FOR. An allocation is mixed — 50 brand
                          codes and 30 publisher codes go to the same partner —
                          so without this on screen the only way to tell a brand
                          code from a publisher one is to export the CSV. Handing
                          a publisher a brand code fails at signup, in front of
                          them, days after the code was given out. */}
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <Badge variant={v.roleRestriction ? "outline" : "secondary"}>
                          {roleLabel(v.roleRestriction)}
                        </Badge>
                        <div className="text-xs text-muted-foreground mt-1">
                          {v.grantType === "free_access" ? "Free access" : "Setup fee waived"}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        {/* Free text: most recipients have no account yet, which
                            is the point of a voucher. */}
                        <Input
                          className="h-7 text-xs"
                          placeholder="brand or partner name"
                          defaultValue={v.assignedTo ?? ""}
                          onChange={(e) => setEditing({ ...editing, [v.id]: e.target.value })}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== (v.assignedTo ?? "")) assign.mutate({ id: v.id, assignedTo: val });
                          }}
                          data-testid={`input-assignee-${v.id}`}
                        />
                        <div className="text-xs text-muted-foreground mt-1">
                          {v.label ?? "—"}
                          {v.redeemedBy ? ` · used by ${v.redeemedBy}` : ""}
                        </div>
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {v.seatsRemaining == null
                          ? <span className="text-muted-foreground">unlimited</span>
                          : <span>{v.seatsRemaining} of {v.maxRedemptions}</span>}
                      </td>
                      <td className="py-2 pr-4">{status(v)}</td>
                      <td className="py-2 text-right">
                        {!v.revokedAt && (
                          <Button
                            variant="ghost" size="sm" className="gap-1.5"
                            onClick={() => revoke.mutate(v.id)}
                            data-testid={`button-revoke-${v.id}`}
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setting a window on a live batch can lock people out mid-festival, so
          the dialog states the count and what each empty field means. */}
      <Dialog open={datesOpen} onOpenChange={setDatesOpen}>
        <DialogContent data-testid="dialog-voucher-dates">
          <DialogHeader>
            <DialogTitle>Dates for {recipient}'s codes</DialogTitle>
            <DialogDescription>
              Applies to all {shown.length} code{shown.length === 1 ? "" : "s"} given to {recipient}.
              A code cannot be redeemed before its activation date or after it expires.
              Leave either blank to remove that limit.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="voucher-active-from">Active from</Label>
              <Input
                id="voucher-active-from"
                type="date"
                value={dates.activeFrom}
                onChange={(e) => setDates(d => ({ ...d, activeFrom: e.target.value }))}
                data-testid="input-voucher-active-from"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voucher-expires-at">Expires</Label>
              <Input
                id="voucher-expires-at"
                type="date"
                value={dates.expiresAt}
                onChange={(e) => setDates(d => ({ ...d, expiresAt: e.target.value }))}
                data-testid="input-voucher-expires-at"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setDatesOpen(false)} data-testid="button-cancel-dates">
              Cancel
            </Button>
            <Button
              disabled={setWindow.isPending}
              onClick={() => setWindow.mutate({
                assignedTo: recipient,
                activeFrom: dates.activeFrom || null,
                expiresAt: dates.expiresAt || null,
              })}
              data-testid="button-save-voucher-dates"
            >
              {setWindow.isPending ? "Saving…" : `Apply to ${shown.length} code${shown.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
