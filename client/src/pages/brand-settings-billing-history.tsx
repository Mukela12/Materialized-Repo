import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Download, Receipt, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BrandBillingRecord } from "@shared/schema";

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

export default function BrandSettingsBillingHistory() {
  const { toast } = useToast();
  const { data: records = [], isLoading } = useQuery<BrandBillingRecord[]>({
    queryKey: ["/api/brand/billing-records", "invoice"],
  });

  const display = records;

  const downloadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("GET", `/api/brand/billing-records/${id}/invoice-url`);
      return (await res.json()) as { url?: string };
    },
    onSuccess: ({ url }) => {
      if (url) {
        window.open(url, "_blank");
      } else {
        toast({ title: "No invoice available", description: "This record has no downloadable invoice.", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Couldn't open invoice", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6 max-w-2xl pb-12">
      <div className="flex items-center gap-3">
        <Link href="/brand/settings">
          <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing History</h1>
          <p className="text-muted-foreground text-sm">All invoices and payments on your account</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" /> Invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
            </div>
          ) : display.length === 0 ? (
            <p className="text-center text-muted-foreground py-12 text-sm">No invoices yet</p>
          ) : (
            display.map((r, i) => (
              <div
                key={r.id}
                className={`flex items-center gap-4 px-4 py-3.5 ${i !== display.length - 1 ? "border-b border-border" : ""}`}
                data-testid={`row-invoice-${r.id}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.reference} · {r.createdAt ? format(new Date(r.createdAt), "d MMM yyyy") : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusPill status={r.status} />
                  <p className="text-sm font-semibold tabular-nums">
                    {r.currency === "EUR" ? "€" : "$"}{Number(r.amount).toFixed(2)}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => downloadMutation.mutate(r.id)}
                    disabled={downloadMutation.isPending && downloadMutation.variables === r.id}
                    data-testid={`button-download-invoice-${r.id}`}
                  >
                    {downloadMutation.isPending && downloadMutation.variables === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
