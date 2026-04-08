import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Users, 
  ArrowUpDown, 
  TrendingUp,
  MousePointer,
  DollarSign,
  Percent
} from "lucide-react";

type AffiliatePublisher = {
  id: string;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  totalClicks: number;
  totalConversions: number;
  totalRevenue: string;
  totalEarnings: string;
  campaignCount: number;
};

type SortField = "earnings" | "clicks" | "conversions" | "revenue" | "conversionRate";

interface AffiliatePublishersTableProps {
  formatMoney?: (usd: number) => string;
}

export function AffiliatePublishersTable({ formatMoney }: AffiliatePublishersTableProps = {}) {
  const fmtMoney = formatMoney || ((v: number) => `$${v.toFixed(2)}`);
  const [sortBy, setSortBy] = useState<SortField>("earnings");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const { data: publishers = [], isLoading } = useQuery<AffiliatePublisher[]>({
    queryKey: ["/api/analytics/affiliate-publishers", { sortBy, order: sortOrder }],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/affiliate-publishers?sortBy=${sortBy}&order=${sortOrder}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
  };

  const getConversionRate = (clicks: number, conversions: number) => {
    if (clicks === 0) return "0.00";
    return ((conversions / clicks) * 100).toFixed(2);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Affiliate Publishers
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortField)}>
            <SelectTrigger className="w-[180px]" data-testid="select-sort-field">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="earnings">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Earnings
                </div>
              </SelectItem>
              <SelectItem value="clicks">
                <div className="flex items-center gap-2">
                  <MousePointer className="h-4 w-4" />
                  Clicks
                </div>
              </SelectItem>
              <SelectItem value="conversions">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Conversions
                </div>
              </SelectItem>
              <SelectItem value="revenue">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Revenue
                </div>
              </SelectItem>
              <SelectItem value="conversionRate">
                <div className="flex items-center gap-2">
                  <Percent className="h-4 w-4" />
                  Conversion Rate
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            size="icon" 
            onClick={toggleSortOrder}
            data-testid="button-toggle-sort"
          >
            <ArrowUpDown className={`h-4 w-4 transition-transform ${sortOrder === "asc" ? "rotate-180" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {publishers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No affiliate publishers yet</p>
            <p className="text-sm">Affiliate performance data will appear here</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Publisher</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Conversions</TableHead>
                <TableHead className="text-right">Conv. Rate</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Earnings</TableHead>
                <TableHead className="text-right">Campaigns</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {publishers.map((publisher, index) => (
                <TableRow key={publisher.id} data-testid={`row-publisher-${publisher.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                        {publisher.affiliateName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium">{publisher.affiliateName}</p>
                        <p className="text-xs text-muted-foreground">{publisher.affiliateEmail}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-medium">{publisher.totalClicks.toLocaleString()}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-medium">{publisher.totalConversions.toLocaleString()}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">
                      {getConversionRate(publisher.totalClicks, publisher.totalConversions)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-medium">{fmtMoney(parseFloat(publisher.totalRevenue))}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-medium text-chart-2">{fmtMoney(parseFloat(publisher.totalEarnings))}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">{publisher.campaignCount}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
