import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link2, Tag, Percent, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AffiliateCardProps {
  trackingId: string;
  referralCode: string;
  commissionRate: number;
}

export function AffiliateCard({ trackingId, referralCode, commissionRate }: AffiliateCardProps) {
  const { toast } = useToast();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: `${label} copied to clipboard`,
    });
  };

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold mb-2">Affiliate Links Management</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Manage your affiliate tracking links and monitor performance across all your videos
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Link2 className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" data-testid="text-tracking-id">
                {trackingId.slice(0, 8)}...
              </p>
              <p className="text-xs text-muted-foreground">Affiliate Tracking ID</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => copyToClipboard(trackingId, "Tracking ID")}
              data-testid="button-copy-tracking-id"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-2/10">
              <Tag className="h-5 w-5 text-chart-2" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" data-testid="text-referral-code">
                {referralCode}
              </p>
              <p className="text-xs text-muted-foreground">Referral Code</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => copyToClipboard(referralCode, "Referral Code")}
              data-testid="button-copy-referral-code"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-3/10">
              <Percent className="h-5 w-5 text-chart-3" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" data-testid="text-commission-rate">
                {commissionRate.toFixed(2)}%
              </p>
              <p className="text-xs text-muted-foreground">Commission Rate</p>
            </div>
            <Button variant="outline" size="sm" className="rounded-full text-xs">
              Rate
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
