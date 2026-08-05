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
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ticket, Copy, Ban, Check, Download } from "lucide-react";
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
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Groups one mint — "the 80 I gave Vogue". */
  batchId: string | null;
  /** Who it was handed to. Free text: most recipients have no account yet. */
  assignedTo: string | null;
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
  const [form, setForm] = useState({ ...GTM_DEFAULTS, code: "", expiresAt: "" });
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

  const { data: vouchers = [], isLoading } = useQuery<VoucherRow[]>({
    queryKey: ["/api/admin/vouchers"],
  });

  const create = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/admin/vouchers", body),
    onSuccess: async (res: any) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/vouchers"] });
      const body = typeof res?.json === "function" ? await res.json() : res;
      setForm({ ...GTM_DEFAULTS, code: "", expiresAt: "" });
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
                { header: "Given to", value: (v) => v.assignedTo ?? "" },
                { header: "For", value: (v) => v.label ?? "" },
                { header: "Grants", value: (v) => v.grantType === "free_access" ? "Free access" : "Setup fee waived" },
                { header: "Who can use", value: (v) => v.roleRestriction ?? "any" },
                { header: "Uses left", value: (v) => v.seatsRemaining == null ? "unlimited" : String(v.seatsRemaining) },
                { header: "Redeemed by", value: (v) => v.redeemedBy ?? "" },
                { header: "Expires", value: (v) => v.expiresAt ? v.expiresAt.slice(0, 10) : "" },
                { header: "Status", value: (v) => v.revokedAt ? "Revoked" : v.seatsRemaining === 0 ? "Used" : "Active" },
              ])}
              data-testid="button-export-vouchers"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
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
    </div>
  );
}
