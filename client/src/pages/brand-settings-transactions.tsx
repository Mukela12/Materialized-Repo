import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, ArrowDownUp } from "lucide-react";
import { format } from "date-fns";
import type { BrandBillingRecord } from "@shared/schema";
import { useTableControls } from "@/hooks/useTableControls";
import { exportToCsv } from "@/lib/exportCsv";
import { TableToolbar } from "@/components/TableToolbar";


function TypeIcon({ type }: { type: string }) {
  if (type === "payout")  return <ArrowUpRight   className="h-4 w-4 text-green-500" />;
  if (type === "payment") return <ArrowDownLeft  className="h-4 w-4 text-blue-500" />;
  return                         <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    failed:  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${map[status] ?? map["pending"]}`}>
      {status}
    </span>
  );
}

export default function BrandSettingsTransactions() {
  const { data: records = [], isLoading } = useQuery<BrandBillingRecord[]>({
    queryKey: ["/api/brand/billing-records"],
  });

  const { query, setQuery, sortKey, sortDir, toggleSort, rows: display } = useTableControls(records, {
    searchFields: (r) => [r.description, r.reference, r.type, r.status],
    initialSort: { key: "createdAt", dir: "desc" },
    sortAccessors: {
      description: (r) => r.description,
      type: (r) => r.type,
      amount: (r) => r.amount,
      status: (r) => r.status,
      createdAt: (r) => r.createdAt,
    },
  });

  const handleExport = () =>
    exportToCsv("transactions", display, [
      { header: "Type", value: (r) => r.type },
      { header: "Description", value: (r) => r.description },
      { header: "Reference", value: (r) => r.reference },
      { header: "Amount", value: (r) => r.amount },
      { header: "Currency", value: (r) => r.currency },
      { header: "Status", value: (r) => r.status },
      { header: "Date", value: (r) => r.createdAt },
    ]);

  return (
    <div className="space-y-6 max-w-2xl pb-12">
      <div className="flex items-center gap-3">
        <Link href="/brand/settings">
          <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transaction History</h1>
          <p className="text-muted-foreground text-sm">All payouts and payments on your account</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-col gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" /> All Transactions
          </CardTitle>
          {records.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <Select
                value={sortKey ?? "createdAt"}
                onValueChange={(v) => { if (v !== sortKey) toggleSort(v); }}
              >
                <SelectTrigger className="w-[140px]" data-testid="select-transactions-sort">
                  <div className="flex items-center gap-2">
                    <ArrowDownUp className="h-3.5 w-3.5" />
                    <SelectValue placeholder="Sort by" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt">Date</SelectItem>
                  <SelectItem value="amount">Amount</SelectItem>
                  <SelectItem value="type">Type</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="description">Description</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => sortKey && toggleSort(sortKey)}
                data-testid="button-transactions-sort-dir"
                title={sortDir === "asc" ? "Ascending" : "Descending"}
              >
                <ArrowDownUp className={`h-4 w-4 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} />
              </Button>
              <TableToolbar
                query={query}
                onQueryChange={setQuery}
                onExport={handleExport}
                exportDisabled={display.length === 0}
                searchPlaceholder="Search transactions…"
                data-testid="transactions-toolbar"
              />
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
            </div>
          ) : display.length === 0 ? (
            <p className="text-center text-muted-foreground py-12 text-sm">
              {records.length === 0 ? "No transactions yet" : "No transactions match your search"}
            </p>
          ) : (
            display.map((r, i) => (
              <div
                key={r.id}
                className={`flex items-center gap-3 px-4 py-3.5 ${i !== display.length - 1 ? "border-b border-border" : ""}`}
                data-testid={`row-transaction-${r.id}`}
              >
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <TypeIcon type={r.type} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                    {r.type} · {r.reference} · {r.createdAt ? format(new Date(r.createdAt), "d MMM yyyy") : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusPill status={r.status} />
                  <p className={`text-sm font-semibold tabular-nums ${r.type === "payout" ? "text-green-600" : ""}`}>
                    {r.type === "payout" ? "+" : "-"}{r.currency === "EUR" ? "€" : "$"}{Number(r.amount).toFixed(2)}
                  </p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
