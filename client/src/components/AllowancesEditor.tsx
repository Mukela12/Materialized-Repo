/**
 * Plan allowances and the overage they produce.
 *
 * ── What this screen is for ──────────────────────────────────────────────────
 * The overage system is measurement-first: the monthly job records what each
 * subscriber went over by, and bills nothing until a plan's "Bill automatically"
 * toggle is on. So this screen is both the product decision ("what does each
 * tier include") and the dry-run review ("what would last month have cost")
 * on one page — set numbers, watch a month, flip billing.
 *
 * Empty allowances mean unlimited. The whole feature is inert until the first
 * number is typed, which is why deploying it ahead of the client's decision was
 * safe.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Gauge, RefreshCw } from "lucide-react";

interface Allowance {
  plan: string;
  includedVideos: number | null;
  includedViews: number | null;
  overagePerVideoCents: number | null;
  overagePer1000ViewsCents: number | null;
  billingEnabled: boolean;
}

interface OverageRow {
  id: string;
  userId: string;
  userName: string;
  plan: string;
  periodStart: string;
  videosUsed: number;
  viewsUsed: number;
  totalCents: number;
  status: string;
  error: string | null;
}

const PLANS: Array<{ key: string; label: string }> = [
  { key: "creator", label: "Creator ($149)" },
  { key: "starter", label: "Brand ($249)" },
  { key: "pro", label: "Publisher ($499)" },
];

const centsMoney = (c: number) => formatMoney(c / 100);

export function AllowancesEditor() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allowances = [] } = useQuery<Allowance[]>({
    queryKey: ["/api/admin/allowances"],
    queryFn: () => fetch("/api/admin/allowances", { credentials: "include" }).then(r => r.json()),
  });

  const { data: overage = [] } = useQuery<OverageRow[]>({
    queryKey: ["/api/admin/overage"],
    queryFn: () => fetch("/api/admin/overage", { credentials: "include" }).then(r => r.json()),
  });

  // Draft state per plan, seeded from the server row when editing begins.
  const [drafts, setDrafts] = useState<Record<string, Partial<Allowance>>>({});
  const draftFor = (plan: string): Partial<Allowance> =>
    drafts[plan] ?? allowances.find(a => a.plan === plan) ?? {};

  const save = useMutation({
    mutationFn: (a: Partial<Allowance> & { plan: string }) =>
      apiRequest("PATCH", `/api/admin/allowances/${a.plan}`, a),
    onSuccess: (_res, vars) => {
      toast({ title: `${vars.plan} allowances saved` });
      setDrafts(d => { const n = { ...d }; delete n[vars.plan]; return n; });
      qc.invalidateQueries({ queryKey: ["/api/admin/allowances"] });
    },
    onError: async (err: any) => {
      let detail = "";
      try { detail = (await err?.response?.json?.())?.error ?? ""; } catch { /* generic */ }
      toast({ title: "Could not save", description: detail, variant: "destructive" });
    },
  });

  const numField = (plan: string, key: keyof Allowance, label: string, hint: string) => {
    const d = draftFor(plan);
    return (
      <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        <Input
          type="number"
          min={0}
          className="h-8 text-sm"
          value={(d[key] as number | null) ?? ""}
          placeholder="unlimited"
          onChange={(e) =>
            setDrafts(prev => ({
              ...prev,
              [plan]: { ...draftFor(plan), [key]: e.target.value === "" ? null : Number(e.target.value) },
            }))
          }
          data-testid={`input-allowance-${plan}-${String(key)}`}
        />
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-none border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" /> Plan allowances & overage
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            What each tier includes per month. Empty means unlimited. Overage is
            recorded first and billed only once "Bill automatically" is on —
            review a recorded month below before switching it.
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-6">
          {PLANS.map(({ key, label }) => {
            const d = draftFor(key);
            return (
              <div key={key} className="rounded-lg border border-border p-4 space-y-3" data-testid={`allowance-card-${key}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{label}</p>
                  <label className="flex items-center gap-2 text-xs">
                    Bill automatically
                    <Switch
                      checked={!!d.billingEnabled}
                      onCheckedChange={(v) =>
                        setDrafts(prev => ({ ...prev, [key]: { ...draftFor(key), billingEnabled: v } }))
                      }
                      data-testid={`switch-billing-${key}`}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {numField(key, "includedVideos", "Included videos", "uploads / month")}
                  {numField(key, "includedViews", "Included views", "billable views / month")}
                  {numField(key, "overagePerVideoCents", "¢ per extra video", "e.g. 500 = $5.00")}
                  {numField(key, "overagePer1000ViewsCents", "¢ per extra 1k views", "per started thousand")}
                </div>
                <Button
                  size="sm"
                  onClick={() => save.mutate({ plan: key, ...draftFor(key) })}
                  disabled={save.isPending}
                  data-testid={`button-save-allowance-${key}`}
                >
                  {save.isPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Save"}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* The dry-run review, and later the billing ledger. */}
      <Card className="shadow-none border">
        <CardHeader>
          <CardTitle className="text-base">Recorded overage</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {overage.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="overage-empty">
              Nothing yet. The job runs on the 1st and records the previous month.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Subscriber</th>
                    <th className="py-2 pr-4 font-medium">Plan</th>
                    <th className="py-2 pr-4 font-medium">Month</th>
                    <th className="py-2 pr-4 font-medium">Usage</th>
                    <th className="py-2 pr-4 font-medium">Overage</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {overage.map(r => (
                    <tr key={r.id} className="border-b last:border-0" data-testid={`overage-row-${r.id}`}>
                      <td className="py-2 pr-4">{r.userName}</td>
                      <td className="py-2 pr-4 capitalize">{r.plan}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.periodStart?.slice(0, 7)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.videosUsed} videos · {r.viewsUsed} views</td>
                      <td className="py-2 pr-4 font-medium">{centsMoney(r.totalCents)}</td>
                      <td className="py-2">
                        {r.status === "billed" ? (
                          <Badge className="bg-green-500/20 text-green-600 border-0">On next invoice</Badge>
                        ) : r.status === "failed" ? (
                          <Badge className="bg-red-500/20 text-red-600 border-0" title={r.error ?? ""}>Failed</Badge>
                        ) : (
                          <Badge className="bg-amber-500/20 text-amber-600 border-0">Recorded</Badge>
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
