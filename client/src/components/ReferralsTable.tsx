import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Send, Clock, CheckCircle, XCircle, Mail, Building } from "lucide-react";
import { format } from "date-fns";
import type { BrandReferral } from "@shared/schema";
import { useTableControls } from "@/hooks/useTableControls";
import { exportToCsv } from "@/lib/exportCsv";
import { TableToolbar, SortableHeader } from "@/components/TableToolbar";

interface ReferralsTableProps {
  referrals: BrandReferral[];
  isLoading?: boolean;
  onResend?: (referral: BrandReferral) => void;
  resendingId?: string;
}

export function ReferralsTable({ referrals, isLoading, onResend, resendingId }: ReferralsTableProps) {
  const statusConfig = {
    pending: {
      icon: Clock,
      color: "bg-yellow-500/20 text-yellow-600",
      label: "Pending",
    },
    sent: {
      icon: Mail,
      color: "bg-blue-500/20 text-blue-600",
      label: "Sent",
    },
    accepted: {
      icon: CheckCircle,
      color: "bg-green-500/20 text-green-600",
      label: "Accepted",
    },
    declined: {
      icon: XCircle,
      color: "bg-red-500/20 text-red-600",
      label: "Declined",
    },
  };

  const { query, setQuery, sortKey, sortDir, toggleSort, rows } = useTableControls(referrals, {
    searchFields: (r) => [r.brandName, r.prContactName, r.prContactEmail, r.productCategory],
    sortAccessors: {
      brandName: (r) => r.brandName,
      productCategory: (r) => r.productCategory,
      createdAt: (r) => r.createdAt,
      status: (r) => r.status,
    },
  });

  const handleExport = () =>
    exportToCsv("referrals", rows, [
      { header: "Brand", value: (r) => r.brandName },
      { header: "Contact Name", value: (r) => r.prContactName },
      { header: "Contact Email", value: (r) => r.prContactEmail },
      { header: "Category", value: (r) => r.productCategory },
      { header: "Status", value: (r) => r.status },
      { header: "Referred On", value: (r) => r.createdAt },
    ]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Your Brand Referrals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <CardTitle className="text-lg font-semibold">Your Brand Referrals</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Track the status of brands you've referred to the platform
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <TableToolbar
            query={query}
            onQueryChange={setQuery}
            onExport={handleExport}
            exportDisabled={rows.length === 0}
            searchPlaceholder="Search brand / contact…"
            data-testid="referrals-toolbar"
          />
          <Badge variant="secondary" className="text-sm shrink-0">
            {referrals.length} Total
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHeader label="Brand" sortKey="brandName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-[200px]" />
              <TableHead>Contact</TableHead>
              <SortableHeader label="Category" sortKey="productCategory" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableHeader label="Referred On" sortKey="createdAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableHeader label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Building className="h-8 w-8 opacity-50" />
                    <p>{referrals.length === 0 ? "No referrals yet" : "No referrals match your search"}</p>
                    <p className="text-sm">Refer brands while uploading videos to grow the network</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((referral) => {
                const status = statusConfig[referral.status as keyof typeof statusConfig] || statusConfig.pending;
                const StatusIcon = status.icon;

                return (
                  <TableRow key={referral.id} data-testid={`row-referral-${referral.id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                          <Building className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <span>{referral.brandName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{referral.prContactName}</p>
                        <p className="text-sm text-muted-foreground">{referral.prContactEmail}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {referral.productCategory ? (
                        <Badge variant="secondary">{referral.productCategory}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {referral.createdAt ? format(new Date(referral.createdAt), "MMM d, yyyy") : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge className={status.color} variant="secondary">
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {referral.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          disabled={resendingId === referral.id}
                          onClick={() => onResend?.(referral)}
                          data-testid={`button-resend-referral-${referral.id}`}
                        >
                          <Send className="h-3 w-3" />
                          {resendingId === referral.id ? "Sending…" : "Resend"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
