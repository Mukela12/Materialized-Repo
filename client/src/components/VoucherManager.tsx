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
import { Ticket, Copy, Ban, Check } from "lucide-react";

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
}

/** The GTM offer, prefilled — it is the reason this screen exists. */
const GTM_DEFAULTS = {
  label: "GTM — 20 creator seats",
  grantType: "free_access" as const,
  roleRestriction: "creator",
  maxRedemptions: "20",
};

export function VoucherManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...GTM_DEFAULTS, code: "", expiresAt: "" });
  const [copied, setCopied] = useState<string | null>(null);

  const { data: vouchers = [], isLoading } = useQuery<VoucherRow[]>({
    queryKey: ["/api/admin/vouchers"],
  });

  const create = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/admin/vouchers", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/vouchers"] });
      setForm({ ...GTM_DEFAULTS, code: "", expiresAt: "" });
      toast({ title: "Voucher created" });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Could not create voucher", variant: "destructive" }),
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
              <Label>How many times it can be used</Label>
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
              code: form.code || undefined,
              roleRestriction: form.roleRestriction || undefined,
              maxRedemptions: form.maxRedemptions || null,
              expiresAt: form.expiresAt || null,
            })}
            disabled={create.isPending}
            data-testid="button-create-voucher"
          >
            {create.isPending ? "Creating…" : "Create voucher"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vouchers</CardTitle>
          <p className="text-sm text-muted-foreground">
            Revoking stops new redemptions. Accounts already created with a voucher keep
            what they were given.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : vouchers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vouchers yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-vouchers">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">For</th>
                    <th className="py-2 pr-4">Seats left</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => (
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
                      <td className="py-2 pr-4">
                        <div>{v.label ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.grantType === "free_access" ? "Free access" : "Setup fee waived"}
                          {v.roleRestriction ? ` · ${v.roleRestriction}s only` : ""}
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
