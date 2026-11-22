/**
 * Admin > CRM (client, 22 Nov 2026): every account in one table that sorts
 * and filters, so admin can see which partners have gone quiet and which
 * accounts get views but few sales, and keep her own notes on each.
 *
 * Type, first name, company, status, notes, account created, free trial,
 * videos uploaded, sales performance, views, sales and gross revenue. The
 * numbers come from GET /api/admin/crm (server/crm.ts); the rules for Active,
 * Inactive and partner inactivity are in shared/crm.ts.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DotPill, TypePill } from "@/components/RolePill";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, serverMessage } from "@/lib/queryClient";
import { exportToCsv } from "@/lib/exportCsv";
import { cn } from "@/lib/utils";
import type { CrmReport, CrmRow, CrmStatus, CrmType, TrialProgress } from "@shared/crm";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString("en-US");
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const compactDay = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" }) : "");
const shortDay = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

const TYPE_LABEL: Record<CrmType, string> = { partner: "Partner", creator: "Creator", brand: "Brand", publisher: "Publisher" };
const STATUS: Record<CrmStatus, { label: string; dot: string }> = {
  active: { label: "Active", dot: "text-emerald-500" },
  inactive: { label: "Inactive", dot: "text-amber-500" },
  archived: { label: "Archived", dot: "text-muted-foreground" },
};

type SortKey = "firstName" | "type" | "company" | "status" | "createdAt" | "trial" | "videos" | "conversionPct" | "views" | "sales" | "grossCents";
type TypeFilter = "all" | CrmType;
type StatusFilter = "open" | CrmStatus;

/** How far through the free period, for sorting: no trial first, ended last. */
const trialRank = (t: TrialProgress) => (t.state === "none" ? -2 : t.state === "open" ? -1 : t.pct);

function sortValue(r: CrmRow, key: SortKey): string | number {
  switch (key) {
    case "trial": return trialRank(r.trial);
    case "conversionPct": return r.conversionPct ?? -1;
    case "createdAt": return new Date(r.createdAt).getTime();
    case "status": return { inactive: 0, active: 1, archived: 2 }[r.status];
    case "firstName": case "type": case "company": return (r[key] || "").toLowerCase();
    default: return r[key];
  }
}

export function trialLabel(t: TrialProgress): string {
  if (t.state === "none") return "No free trial";
  if (t.state === "open") return "Free, no end date";
  if (t.state === "ended") return `Ended ${shortDay(t.endsAt)}`;
  return `${t.daysLeft} of ${t.days} days left`;
}

/** Green while the free period runs, red once it has ended. */
function TrialBar({ trial, id }: { trial: TrialProgress; id: string }) {
  const has = trial.state === "running" || trial.state === "ended";
  return (
    <div className="min-w-[96px]" data-testid={`crm-trial-${id}`} data-state={trial.state}>
      {has && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={trial.pct} aria-label="Free trial used"
        >
          <div
            className={cn("h-full rounded-full", trial.state === "ended" ? "bg-red-500" : "bg-emerald-500")}
            style={{ width: `${Math.max(4, trial.pct)}%` }}
          />
        </div>
      )}
      <p className={cn("text-xs text-muted-foreground", has && "mt-1")}>{trialLabel(trial)}</p>
    </div>
  );
}

function partnerLine(p: NonNullable<CrmRow["partner"]>): string {
  if (p.state === "off") return `Partner status off since ${shortDay(p.deactivatedAt)}`;
  const quiet = p.daysQuiet ?? 0;
  if (p.state === "inactive") return `No activity for ${quiet} days`;
  return quiet === 0 ? "Active today" : `Last activity ${quiet} ${quiet === 1 ? "day" : "days"} ago`;
}

function SortHead({ label, k, sort, onSort, align = "left" }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  const on = sort.key === k;
  const Icon = sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th className={cn("whitespace-nowrap px-2 py-2 font-medium first:pl-4", align === "right" && "text-right")} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button" onClick={() => onSort(k)} data-testid={`crm-sort-${k}`} title={`Sort by ${label.toLowerCase().replace(".", "")}`}
        className={cn("inline-flex items-center gap-1 rounded-sm text-xs uppercase tracking-[0.06em] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "text-foreground" : "text-muted-foreground")}
      >
        {label}
        {/* The arrow shows on the sorted column only, so thirteen columns fit a laptop. */}
        {on && <Icon className="h-3 w-3" aria-hidden="true" />}
      </button>
    </th>
  );
}

export function AdminCrm() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<CrmReport>({ queryKey: ["/api/admin/crm"] });
  const [q, setQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "createdAt", dir: -1 });

  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/admin/crm"] });
  const failed = (title: string) => (e: unknown) => toast({ title, description: serverMessage(e), variant: "destructive" });

  const save = useMutation({
    mutationFn: ({ id, ...fields }: { id: string; company?: string; notes?: string; archived?: boolean }) =>
      apiRequest("PATCH", `/api/admin/crm/${id}`, fields),
    onSuccess: (_r, v) => {
      refresh();
      if (v.archived !== undefined) toast({ title: v.archived ? "Archived" : "Back in the list" });
    },
    onError: failed("Could not save"),
  });
  const partnerStatus = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiRequest("POST", `/api/admin/crm/${id}/partner-status`, { active }),
    onSuccess: (_r, v) => { refresh(); toast({ title: v.active ? "Partner status switched on" : "Partner status switched off" }); },
    onError: failed("Could not change the partner status"),
  });

  const rows = data?.rows ?? [];
  const quietPartners = rows.filter((r) => r.partner && r.status === "inactive").length;
  const counts = useMemo(() => {
    const open = rows.filter((r) => r.status !== "archived");
    return {
      all: open.length,
      partner: open.filter((r) => r.type === "partner").length,
      inactive: open.filter((r) => r.status === "inactive").length,
      archived: rows.length - open.length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) =>
      (type === "all" || r.type === type)
      && (status === "open" ? r.status !== "archived" : r.status === status)
      && (!needle || [r.name, r.email, r.company, r.notes].some((s) => s.toLowerCase().includes(needle))));
    return list.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c !== 0 ? c * sort.dir : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [rows, q, type, status, sort]);

  // Text columns start A to Z; number and date columns start with the most.
  const onSort = (k: SortKey) => setSort((s) => (s.key === k
    ? { key: k, dir: (s.dir * -1) as 1 | -1 }
    : { key: k, dir: k === "firstName" || k === "type" || k === "company" || k === "status" ? 1 : -1 }));

  const exportCsv = () => exportToCsv("mtrlzd-crm", shown, [
    { header: "Type", value: (r) => TYPE_LABEL[r.type] },
    { header: "First name", value: (r) => r.firstName },
    { header: "Name", value: (r) => r.name },
    { header: "Email", value: (r) => r.email },
    { header: "Company", value: (r) => r.company },
    { header: "Status", value: (r) => STATUS[r.status].label },
    { header: "Partner", value: (r) => (r.partner ? partnerLine(r.partner) : "") },
    { header: "Notes", value: (r) => r.notes },
    { header: "Account created", value: (r) => r.createdAt.slice(0, 10) },
    { header: "Free trial", value: (r) => trialLabel(r.trial) },
    { header: "Videos uploaded", value: (r) => r.videos },
    { header: "Sales performance %", value: (r) => (r.conversionPct == null ? "" : r.conversionPct) },
    { header: "Total views", value: (r) => r.views },
    { header: "Total sales", value: (r) => r.sales },
    { header: "Gross revenue (USD)", value: (r) => (r.grossCents / 100).toFixed(2) },
  ]);

  const statusCell = (r: CrmRow) => (
    <div className="space-y-1">
      <DotPill label={STATUS[r.status].label} dot={STATUS[r.status].dot} testId={`crm-status-${r.id}`} />
      {r.partner && (
        <>
          <p className="text-xs text-muted-foreground" data-testid={`crm-partner-line-${r.id}`}>{partnerLine(r.partner)}</p>
          <Button
            variant="ghost" size="sm" className="-ml-2 h-6 px-2 text-xs"
            disabled={partnerStatus.isPending}
            onClick={() => partnerStatus.mutate({ id: r.id, active: r.partner!.state === "off" })}
            data-testid={`crm-partner-toggle-${r.id}`}
          >
            {r.partner.state === "off" ? "Switch partner on" : "Switch partner off"}
          </Button>
        </>
      )}
    </div>
  );
  const companyInput = (r: CrmRow) => (
    <Input
      key={`${r.id}-c-${r.company}`} className="h-8 w-[112px] px-2 text-xs" placeholder="Company" defaultValue={r.company}
      aria-label={`Company for ${r.name || r.email}`}
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== r.company) save.mutate({ id: r.id, company: v }); }}
      data-testid={`crm-company-${r.id}`}
    />
  );
  const notesInput = (r: CrmRow) => (
    <Textarea
      key={`${r.id}-n-${r.notes}`} rows={1} className="min-h-8 w-[156px] resize-y px-2 py-1.5 text-xs leading-snug [field-sizing:content]" placeholder="Add a note"
      defaultValue={r.notes} aria-label={`Notes on ${r.name || r.email}`}
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== r.notes) save.mutate({ id: r.id, notes: v }); }}
      data-testid={`crm-notes-${r.id}`}
    />
  );
  const archiveButton = (r: CrmRow) => (
    <Button
      variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground"
      title={r.status === "archived" ? "Put back in the list" : "Archive"}
      aria-label={r.status === "archived" ? `Put ${r.name || r.email} back in the list` : `Archive ${r.name || r.email}`}
      onClick={() => save.mutate({ id: r.id, archived: r.status !== "archived" })}
      data-testid={`crm-archive-${r.id}`}
    >
      {r.status === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
    </Button>
  );
  const perf = (r: CrmRow) => (r.conversionPct == null ? "No views yet" : `${r.conversionPct}%`);

  return (
    <div className="space-y-4" data-testid="admin-crm">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">CRM</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every account, with your own notes. An account is Inactive after {data?.rules.inactiveDays ?? 30} days without being used.
          A partner is flagged Inactive after {data?.rules.inactiveDays ?? 30} days with no activity from them or the accounts they brought in,
          and their partner status switches off after {data?.rules.deactivateDays ?? 60}. Nothing is emailed to them. Views, sales and revenue are all time, in US dollars. Perf. is sales performance: sales per 100 views.
        </p>
      </div>

      {quietPartners > 0 && (
        <button
          type="button"
          onClick={() => { setType("partner"); setStatus("inactive"); }}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          data-testid="crm-quiet-partners"
        >
          <span>{quietPartners} {quietPartners === 1 ? "partner needs" : "partners need"} a follow-up: no activity for {data?.rules.inactiveDays ?? 30} days or more.</span>
          <span className="shrink-0 font-medium">Show</span>
        </button>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative md:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, company or notes"
            className="pl-8 text-base md:text-sm" aria-label="Search the CRM" data-testid="crm-search"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex">
          <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
            <SelectTrigger className="md:w-44" aria-label="Type" data-testid="crm-filter-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types ({counts.all})</SelectItem>
              <SelectItem value="partner">Partners ({counts.partner})</SelectItem>
              <SelectItem value="creator">Creators</SelectItem>
              <SelectItem value="brand">Brands</SelectItem>
              <SelectItem value="publisher">Publishers</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="md:w-48" aria-label="Status" data-testid="crm-filter-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Active and inactive</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive ({counts.inactive})</SelectItem>
              <SelectItem value="archived">Archived ({counts.archived})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="gap-1.5 md:ml-auto" onClick={exportCsv} disabled={shown.length === 0} data-testid="crm-export">
          <Download className="h-4 w-4" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {isError ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">The CRM could not load. Try again in a moment.</CardContent></Card>
      ) : isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : shown.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground" data-testid="crm-empty">No accounts match. Change the search or the filters.</CardContent></Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="crm-count">{shown.length} {shown.length === 1 ? "account" : "accounts"}</p>

          {/* Desktop: the sortable table. */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="crm-table">
                  <thead className="border-b text-left">
                    <tr>
                      <SortHead label="First name" k="firstName" sort={sort} onSort={onSort} />
                      <SortHead label="Type" k="type" sort={sort} onSort={onSort} />
                      <SortHead label="Company" k="company" sort={sort} onSort={onSort} />
                      <SortHead label="Status" k="status" sort={sort} onSort={onSort} />
                      <th className="px-2 py-2 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Notes</th>
                      <SortHead label="Created" k="createdAt" sort={sort} onSort={onSort} />
                      <SortHead label="Free trial" k="trial" sort={sort} onSort={onSort} />
                      <SortHead label="Videos" k="videos" sort={sort} onSort={onSort} align="right" />
                      <SortHead label="Perf." k="conversionPct" sort={sort} onSort={onSort} align="right" />
                      <SortHead label="Views" k="views" sort={sort} onSort={onSort} align="right" />
                      <SortHead label="Sales" k="sales" sort={sort} onSort={onSort} align="right" />
                      <SortHead label="Revenue" k="grossCents" sort={sort} onSort={onSort} align="right" />
                      <th className="px-1 py-2"><span className="sr-only">Archive</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {shown.map((r) => (
                      <tr key={r.id} className={cn("align-top", r.status === "archived" && "opacity-60")} data-testid={`crm-row-${r.id}`}>
                        <td className="py-2.5 pl-4 pr-2">
                          <p className="font-medium">{r.firstName || "No name"}</p>
                          <p className="max-w-[150px] truncate text-xs text-muted-foreground" title={`${r.name} ${r.email}`.trim()}>{r.name && r.name !== r.firstName ? `${r.name} · ` : ""}{r.email}</p>
                        </td>
                        <td className="px-2 py-2.5">
                          <TypePill type={r.type} />
                          {r.type === "partner" && <p className="mt-1 text-xs text-muted-foreground">{TYPE_LABEL[r.accountType]} account{r.partner?.pct != null ? `, ${r.partner.pct}%` : ""}</p>}
                          {r.partner && <p className="text-xs text-muted-foreground">{r.partner.referrals} brought in</p>}
                        </td>
                        <td className="px-2 py-2.5">{companyInput(r)}</td>
                        <td className="px-2 py-2.5">{statusCell(r)}</td>
                        <td className="px-2 py-2.5">{notesInput(r)}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted-foreground" title={day(r.createdAt)}>{compactDay(r.createdAt)}</td>
                        <td className="px-2 py-2.5"><TrialBar trial={r.trial} id={r.id} /></td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{num(r.videos)}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                          {r.conversionPct == null ? <span className="text-xs text-muted-foreground" title="No views yet">n/a</span> : `${r.conversionPct}%`}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{num(r.views)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{num(r.sales)}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{money(r.grossCents)}</td>
                        <td className="px-1 py-1.5">{archiveButton(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Phone: one card per account, the numbers side by side. */}
          <ul className="space-y-3 md:hidden" data-testid="crm-cards">
            {shown.map((r) => (
              <li key={r.id}>
                <Card className={cn(r.status === "archived" && "opacity-60")}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.firstName || "No name"}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <TypePill type={r.type} />
                          <DotPill label={STATUS[r.status].label} dot={STATUS[r.status].dot} />
                        </div>
                      </div>
                      {archiveButton(r)}
                    </div>
                    {r.partner && (
                      <div className="text-xs text-muted-foreground">
                        <p>{partnerLine(r.partner)}. {r.partner.referrals} brought in.</p>
                        <Button
                          variant="outline" size="sm" className="mt-2 h-11 w-full text-xs"
                          disabled={partnerStatus.isPending}
                          onClick={() => partnerStatus.mutate({ id: r.id, active: r.partner!.state === "off" })}
                        >
                          {r.partner.state === "off" ? "Switch partner status on" : "Switch partner status off"}
                        </Button>
                      </div>
                    )}
                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      {[["Videos", num(r.videos)], ["Views", num(r.views)], ["Sales", num(r.sales)], ["Perf.", r.conversionPct == null ? "n/a" : `${r.conversionPct}%`]].map(([l, v]) => (
                        <div key={l} className="min-w-0 rounded-lg border px-1 py-1.5">
                          <p className="truncate text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{l}</p>
                          <p className="truncate text-sm font-semibold tabular-nums">{v}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>Gross revenue <span className="font-semibold text-foreground tabular-nums">{money(r.grossCents)}</span></span>
                      <span>Created {shortDay(r.createdAt)}</span>
                    </div>
                    <TrialBar trial={r.trial} id={`m-${r.id}`} />
                    <Input
                      key={`${r.id}-mc-${r.company}`} className="h-11 text-base" placeholder="Company" defaultValue={r.company}
                      aria-label={`Company for ${r.name || r.email}`}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== r.company) save.mutate({ id: r.id, company: v }); }}
                    />
                    <Textarea
                      key={`${r.id}-mn-${r.notes}`} rows={2} className="resize-y text-base" placeholder="Add a note" defaultValue={r.notes}
                      aria-label={`Notes on ${r.name || r.email}`}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== r.notes) save.mutate({ id: r.id, notes: v }); }}
                    />
                    <p className="sr-only">Sales performance {perf(r)}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
