/**
 * Bulk actions for the voucher admin: change who the codes are for, set their
 * dates, revoke, or delete, across every selected code at once. Asked for by
 * the client on 29 Sep 2026 after allocating Brooklyn's batches by hand.
 *
 * The server protects codes someone has already signed up with: their type
 * does not change, and "delete" revokes them rather than erasing them.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarClock, Ticket, Trash2, UserCog, X } from "lucide-react";
import { apiRequest, serverMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type BulkBody =
  | { action: "role"; role: "creator" | "brand" | "affiliate" }
  | { action: "dates"; activeFrom?: string | null; expiresAt?: string | null }
  | { action: "revoke" }
  | { action: "delete" }
  | { action: "passes"; passes: number | null };

interface BulkResult { updated: number; deleted: number; revoked: number; skipped: number; accountsUpdated: number }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What happened, in one sentence a person can check against what they asked for. */
export function describeBulkResult(body: BulkBody, r: BulkResult): string {
  const parts: string[] = [];
  if (body.action === "passes") {
    parts.push(`${plural(r.updated, "brand code")} now give ${body.passes == null ? "the usual number of" : body.passes} creator passes`);
    if (r.accountsUpdated) parts.push(`${plural(r.accountsUpdated, "brand")} already signed up updated too`);
  } else if (body.action === "role" || body.action === "dates") {
    parts.push(`${plural(r.updated, "code")} updated`);
    if (body.action === "role" && r.skipped) parts.push(`${plural(r.skipped, "used code")} left as they were`);
    if (r.accountsUpdated) parts.push(`${plural(r.accountsUpdated, "account")} moved to the new expiry`);
  } else {
    if (r.deleted) parts.push(`${plural(r.deleted, "code")} deleted`);
    if (r.revoked) parts.push(`${plural(r.revoked, "code")} revoked`);
    if (body.action === "delete" && r.revoked) parts.push("used codes are revoked, not deleted");
    if (!r.deleted && !r.revoked) parts.push("nothing to change");
  }
  return parts.join(", ");
}

export function VoucherBulkBar({ ids, brandIds = [], usedCount, onDone }: {
  ids: string[];
  /** The selected codes that are brand codes: creator passes apply to these. */
  brandIds?: string[];
  /** How many of the selected codes someone has already signed up with. */
  usedCount: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [datesOpen, setDatesOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "revoke" | "delete">(null);
  const [dates, setDates] = useState({ activeFrom: "", expiresAt: "" });
  const [passesOpen, setPassesOpen] = useState(false);
  const [passes, setPasses] = useState("10");

  const run = useMutation({
    mutationFn: async (body: BulkBody) => {
      // Creator passes only mean something on brand codes.
      const target = body.action === "passes" ? brandIds : ids;
      const res = await apiRequest("POST", "/api/admin/vouchers/bulk", { ids: target, ...body });
      return { body, result: (await res.json()) as BulkResult };
    },
    onSuccess: ({ body, result }) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/vouchers"] });
      toast({ title: "Done", description: describeBulkResult(body, result) });
      setDatesOpen(false);
      setPassesOpen(false);
      setConfirm(null);
      onDone();
    },
    onError: async (err: any) => {
      const detail = serverMessage(err);
      toast({ title: "Could not update the codes", description: detail || undefined, variant: "destructive" });
    },
  });

  const n = ids.length;
  const unused = n - usedCount;

  return (
    <>
      <div
        className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-2 pl-3 shadow-sm backdrop-blur"
        data-testid="voucher-bulk-bar"
      >
        <span className="mr-1 text-sm font-medium tabular-nums">{plural(n, "code")} selected</span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={run.isPending} data-testid="button-bulk-role">
              <UserCog className="h-3.5 w-3.5" /> Change type
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => run.mutate({ action: "role", role: "creator" })} data-testid="bulk-role-creator">For creators</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run.mutate({ action: "role", role: "brand" })} data-testid="bulk-role-brand">For brands</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run.mutate({ action: "role", role: "affiliate" })} data-testid="bulk-role-affiliate">For publishers</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" className="gap-1.5" disabled={run.isPending} onClick={() => setDatesOpen(true)} data-testid="button-bulk-dates">
          <CalendarClock className="h-3.5 w-3.5" /> Set dates
        </Button>
        <Button
          variant="outline" size="sm" className="gap-1.5"
          disabled={run.isPending || brandIds.length === 0}
          title={brandIds.length === 0 ? "Select some brand codes" : undefined}
          onClick={() => setPassesOpen(true)}
          data-testid="button-bulk-passes"
        >
          <Ticket className="h-3.5 w-3.5" /> Creator passes
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={run.isPending} onClick={() => setConfirm("revoke")} data-testid="button-bulk-revoke">
          <Ban className="h-3.5 w-3.5" /> Revoke
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive" disabled={run.isPending} onClick={() => setConfirm("delete")} data-testid="button-bulk-delete">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto gap-1" onClick={onDone} data-testid="button-bulk-clear">
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>

      <Dialog open={datesOpen} onOpenChange={setDatesOpen}>
        <DialogContent data-testid="dialog-bulk-dates">
          <DialogHeader>
            <DialogTitle>Dates for {plural(n, "code")}</DialogTitle>
            <DialogDescription>
              Codes work from the start of the first day through the end of the last day, New York time.
              Leave a box empty to keep what each code has. People who already signed up with a free-access
              code move to the new expiry too.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="bulk-active-from">Starts</Label>
              <Input id="bulk-active-from" type="date" value={dates.activeFrom}
                onChange={(e) => setDates((d) => ({ ...d, activeFrom: e.target.value }))} data-testid="input-bulk-active-from" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-expires-at">Last day</Label>
              <Input id="bulk-expires-at" type="date" value={dates.expiresAt}
                onChange={(e) => setDates((d) => ({ ...d, expiresAt: e.target.value }))} data-testid="input-bulk-expires-at" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDatesOpen(false)}>Cancel</Button>
            <Button
              disabled={run.isPending || (!dates.activeFrom && !dates.expiresAt)}
              onClick={() => run.mutate({
                action: "dates",
                ...(dates.activeFrom ? { activeFrom: dates.activeFrom } : {}),
                ...(dates.expiresAt ? { expiresAt: dates.expiresAt } : {}),
              })}
              data-testid="button-bulk-dates-save"
            >
              Apply to {plural(n, "code")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passesOpen} onOpenChange={setPassesOpen}>
        <DialogContent data-testid="dialog-bulk-passes">
          <DialogHeader>
            <DialogTitle>Creator passes for {plural(brandIds.length, "brand code")}</DialogTitle>
            <DialogDescription>
              How many creators each brand signing up with these codes can invite with a free pass.
              Brands that already signed up with them get the new number too. Leave it empty for the usual limit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Label htmlFor="bulk-passes">Passes per brand</Label>
            <Input id="bulk-passes" type="number" min={0} max={1000} value={passes}
              onChange={(e) => setPasses(e.target.value)} data-testid="input-bulk-passes" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPassesOpen(false)}>Cancel</Button>
            <Button
              disabled={run.isPending}
              onClick={() => run.mutate({ action: "passes", passes: passes === "" ? null : Number(passes) })}
              data-testid="button-bulk-passes-save"
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent data-testid="dialog-bulk-confirm">
          <DialogHeader>
            <DialogTitle>{confirm === "delete" ? `Delete ${plural(n, "code")}?` : `Revoke ${plural(n, "code")}?`}</DialogTitle>
            <DialogDescription>
              {confirm === "delete"
                ? usedCount > 0
                  ? `${plural(unused, "unused code")} will be deleted. ${plural(usedCount, "code")} someone already signed up with will be revoked instead, so their accounts keep working.`
                  : "They have not been used, so they will be removed completely."
                : "Nobody new can sign up with them. Accounts already created with them keep working."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant={confirm === "delete" ? "destructive" : "default"}
              disabled={run.isPending}
              onClick={() => confirm && run.mutate({ action: confirm })}
              data-testid="button-bulk-confirm"
            >
              {confirm === "delete" ? "Delete" : "Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
