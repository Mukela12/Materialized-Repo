/**
 * Admin: which accounts may send program invites (pages/program-invites.tsx),
 * for which program, how many of each, and which existing code each invite
 * copies its terms from. Paste one of the program's own codes as the
 * template, and every invite gives exactly what those codes give.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Trash2 } from "lucide-react";
import { apiRequest, serverMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Sender {
  userId: string; email: string; displayName: string | null; role: string; programName: string;
  brandLimit: number; brandTemplateCode: string | null; brandSent: number;
  creatorLimit: number; creatorTemplateCode: string | null; creatorSent: number;
  publisherLimit: number; publisherTemplateCode: string | null; publisherSent: number;
  commissionPct: number | null; commissionUntil: string | null; joined: number;
}

const empty = {
  email: "", programName: "", brandLimit: "40", brandTemplateCode: "", creatorLimit: "200", creatorTemplateCode: "",
  publisherLimit: "0", publisherTemplateCode: "", commissionPct: "", commissionUntil: "",
};

/** The deal's end is stored as the morning after its last day; show that last day. */
const lastDay = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const dealText = (s: Sender) => s.commissionPct == null ? "no commission"
  : `${s.commissionPct}% commission${s.commissionUntil ? ` until ${new Date(`${lastDay(s.commissionUntil)}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}`;

export function ProgramSendersAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: senders = [] } = useQuery<Sender[]>({ queryKey: ["/api/admin/program-senders"] });
  const [form, setForm] = useState(empty);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/admin/program-senders", {
      ...form, brandLimit: Number(form.brandLimit) || 0, creatorLimit: Number(form.creatorLimit) || 0,
      publisherLimit: Number(form.publisherLimit) || 0,
    })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/program-senders"] });
      toast({ title: "Saved", description: `${form.email} can send ${form.programName} invites.` });
      setForm(empty);
    },
    onError: (err) => toast({ title: "Couldn't save", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (userId: string) => (await apiRequest("DELETE", `/api/admin/program-senders/${userId}`)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/program-senders"] }),
  });

  return (
    <Card className="mt-6" data-testid="program-senders-admin">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><Send className="h-4 w-4" /> Partners &amp; program invites</CardTitle>
        <CardDescription>
          Let a producer or partner invite their designers, influencers and publishers from the app. Each invite emails a fresh
          single-use code with the same terms as the template code you paste here (use one of the program's own codes).
          A partner can also earn a commission on the sales of the people they bring in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {senders.length > 0 && (
          <ul className="divide-y rounded-lg border" data-testid="program-senders-list">
            {senders.map((s) => (
              <li key={s.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{s.displayName || s.email} <span className="font-normal text-muted-foreground">· {s.programName}</span></p>
                  <p className="text-xs text-muted-foreground break-words">
                    {s.email} · designers {s.brandSent}/{s.brandLimit}{s.brandTemplateCode ? ` (${s.brandTemplateCode})` : ""} · influencers {s.creatorSent}/{s.creatorLimit}{s.creatorTemplateCode ? ` (${s.creatorTemplateCode})` : ""}
                    {s.publisherLimit > 0 && ` · publishers ${s.publisherSent}/${s.publisherLimit}${s.publisherTemplateCode ? ` (${s.publisherTemplateCode})` : ""}`} · {s.joined} joined · {dealText(s)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setForm({
                  email: s.email, programName: s.programName, brandLimit: String(s.brandLimit), brandTemplateCode: s.brandTemplateCode ?? "",
                  creatorLimit: String(s.creatorLimit), creatorTemplateCode: s.creatorTemplateCode ?? "",
                  publisherLimit: String(s.publisherLimit), publisherTemplateCode: s.publisherTemplateCode ?? "",
                  commissionPct: s.commissionPct != null ? String(s.commissionPct) : "", commissionUntil: lastDay(s.commissionUntil),
                })}>Edit</Button>
                <Button size="icon" variant="ghost" aria-label="Switch off" onClick={() => remove.mutate(s.userId)}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="ps-email">Account email</Label><Input id="ps-email" value={form.email} onChange={set("email")} placeholder="producer@fashionweekbrooklyn.com" data-testid="input-ps-email" /></div>
          <div className="space-y-1.5"><Label htmlFor="ps-name">Program name (shown in the email)</Label><Input id="ps-name" value={form.programName} onChange={set("programName")} placeholder="Fashion Week Brooklyn" data-testid="input-ps-program" /></div>
          <div className="space-y-1.5"><Label htmlFor="ps-bl">Designer invites</Label><Input id="ps-bl" type="number" min={0} value={form.brandLimit} onChange={set("brandLimit")} data-testid="input-ps-brand-limit" /></div>
          <div className="space-y-1.5"><Label htmlFor="ps-bt">Designer template code</Label><Input id="ps-bt" value={form.brandTemplateCode} onChange={set("brandTemplateCode")} placeholder="A brand code from this program" className="font-mono" data-testid="input-ps-brand-template" /></div>
          <div className="space-y-1.5"><Label htmlFor="ps-cl">Influencer invites</Label><Input id="ps-cl" type="number" min={0} value={form.creatorLimit} onChange={set("creatorLimit")} data-testid="input-ps-creator-limit" /></div>
          <div className="space-y-1.5"><Label htmlFor="ps-ct">Influencer template code</Label><Input id="ps-ct" value={form.creatorTemplateCode} onChange={set("creatorTemplateCode")} placeholder="A creator code from this program" className="font-mono" data-testid="input-ps-creator-template" /></div>
          <div className="space-y-1.5"><Label htmlFor="ps-pl">Publisher invites</Label><Input id="ps-pl" type="number" min={0} value={form.publisherLimit} onChange={set("publisherLimit")} data-testid="input-ps-publisher-limit" /></div>
          <div className="space-y-1.5"><Label htmlFor="ps-pt">Publisher template code</Label><Input id="ps-pt" value={form.publisherTemplateCode} onChange={set("publisherTemplateCode")} placeholder="A publisher code, if any" className="font-mono" data-testid="input-ps-publisher-template" /></div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-3" data-testid="ps-commission">
          <div>
            <p className="text-sm font-medium">Partner commission</p>
            <p className="text-xs text-muted-foreground">
              A % of the gross sales of everyone this partner brings in (and the creators their brands invite), paid from
              MTRLZD's fee. 1 to 3%. Leave blank for none. Processing and the 3.1% floor always come first.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="ps-pct">Commission %</Label><Input id="ps-pct" type="number" min={1} max={3} step={0.5} value={form.commissionPct} onChange={set("commissionPct")} placeholder="2" data-testid="input-ps-commission-pct" /></div>
            <div className="space-y-1.5"><Label htmlFor="ps-until">Last day</Label><Input id="ps-until" type="date" value={form.commissionUntil} onChange={set("commissionUntil")} data-testid="input-ps-commission-until" /></div>
          </div>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !form.email || !form.programName} data-testid="button-ps-save">
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
