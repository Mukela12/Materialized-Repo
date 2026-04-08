import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Video, 
  Copy, 
  ExternalLink, 
  TrendingUp, 
  DollarSign, 
  MousePointerClick,
  CheckCircle2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type CampaignAffiliate = {
  id: string;
  videoId: string;
  affiliateId: string;
  commissionRate: string;
  utmCode: string;
  embedCode: string | null;
  totalClicks: number;
  totalConversions: number;
  totalRevenue: string;
  totalEarnings: string;
  createdAt: string;
};

export default function AffiliateCampaigns() {
  const { toast } = useToast();

  const { data: campaigns = [], isLoading } = useQuery<CampaignAffiliate[]>({
    queryKey: ['/api/affiliates/campaigns'],
  });

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
      });
    } catch {
      toast({
        title: "Failed to copy",
        description: "Please try again",
        variant: "destructive",
      });
    }
  };

  const totalEarnings = campaigns.reduce((acc, c) => acc + parseFloat(c.totalEarnings || "0"), 0);
  const totalClicks = campaigns.reduce((acc, c) => acc + (c.totalClicks || 0), 0);
  const totalConversions = campaigns.reduce((acc, c) => acc + (c.totalConversions || 0), 0);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
          My Campaigns
        </h1>
        <p className="text-muted-foreground">
          Manage your video campaigns and track performance
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
            <DollarSign className="w-4 h-4 text-accent-gold" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-earnings">
              ${totalEarnings.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">From all campaigns</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">Total Clicks</CardTitle>
            <MousePointerClick className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-clicks">
              {totalClicks.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Across all campaigns</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">Conversions</CardTitle>
            <CheckCircle2 className="w-4 h-4 text-chart-2" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-conversions">
              {totalConversions.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Successful purchases</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="p-12 text-center">
          <Video className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <CardTitle className="mb-2">No Active Campaigns</CardTitle>
          <CardDescription>
            Browse the Global Library to license videos and start earning commissions.
          </CardDescription>
          <Button className="mt-4" data-testid="button-browse-library">
            Browse Library
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} data-testid={`card-campaign-${campaign.id}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Video className="w-5 h-5" />
                    Campaign #{campaign.id.slice(0, 8)}
                  </CardTitle>
                  <CardDescription>
                    Commission Rate: {campaign.commissionRate}%
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  Active
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Clicks</p>
                    <p className="text-xl font-semibold">{campaign.totalClicks}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Conversions</p>
                    <p className="text-xl font-semibold">{campaign.totalConversions}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Revenue</p>
                    <p className="text-xl font-semibold">${campaign.totalRevenue}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Earnings</p>
                    <p className="text-xl font-semibold text-accent-gold">${campaign.totalEarnings}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">UTM Code</p>
                  <div className="flex gap-2">
                    <code className="flex-1 px-3 py-2 bg-muted rounded-md text-sm font-mono truncate">
                      {campaign.utmCode}
                    </code>
                    <Button 
                      size="icon" 
                      variant="outline"
                      onClick={() => copyToClipboard(campaign.utmCode || "", "UTM Code")}
                      data-testid={`button-copy-utm-${campaign.id}`}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {campaign.embedCode && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Embed Code</p>
                    <div className="flex gap-2">
                      <code className="flex-1 px-3 py-2 bg-muted rounded-md text-sm font-mono truncate">
                        {campaign.embedCode.substring(0, 60)}...
                      </code>
                      <Button 
                        size="icon" 
                        variant="outline"
                        onClick={() => copyToClipboard(campaign.embedCode || "", "Embed Code")}
                        data-testid={`button-copy-embed-${campaign.id}`}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
