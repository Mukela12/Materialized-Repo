import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gift, Coins, ArrowUpRight, CheckCircle2, Clock, Sparkles } from "lucide-react";
import { format } from "date-fns";
import type { CreatorReward } from "@shared/schema";

export default function RewardsPage() {
  const { data: rewards = [], isLoading: rewardsLoading } = useQuery<CreatorReward[]>({
    queryKey: ["/api/rewards"],
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<{
    totalCredits: number;
    availableCredits: number;
    redeemedCredits: number;
    euroValue: number;
  }>({
    queryKey: ["/api/rewards/summary"],
  });

  const isLoading = rewardsLoading || summaryLoading;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "credited":
        return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1" /> Available</Badge>;
      case "redeemed":
        return <Badge variant="secondary"><ArrowUpRight className="w-3 h-3 mr-1" /> Redeemed</Badge>;
      case "pending":
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRewardTypeLabel = (type: string) => {
    switch (type) {
      case "brand_referral":
        return "Brand Referral Bonus";
      case "bonus":
        return "Bonus Reward";
      case "promotional":
        return "Promotional Credit";
      default:
        return type;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Gift className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-[#43484D] dark:text-white">My Rewards</h1>
          <p className="text-muted-foreground">Track your credits earned from brand referrals</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Credits</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#677A67]">
              {isLoading ? "..." : summary?.availableCredits || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Worth {isLoading ? "..." : `€${summary?.euroValue || 0}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Earned</CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "..." : summary?.totalCredits || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Lifetime credits earned
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Redeemed</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "..." : summary?.redeemedCredits || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Credits used for listings
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rewards History</CardTitle>
          <CardDescription>
            Earn 45 credits (€45 value) each time a brand you refer subscribes to a paid account. 
            Use credits to list videos in the Global Video Library.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : rewards.length === 0 ? (
            <div className="text-center py-12">
              <Gift className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Rewards Yet</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Start referring brands to earn credits. Each brand that subscribes to a paid account 
                earns you 45 credits (€45) that can be used to list videos in the Global Video Library.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {rewards.map((reward) => (
                <div
                  key={reward.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                  data-testid={`reward-item-${reward.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-[#677A67]/10 flex items-center justify-center">
                      <Gift className="h-5 w-5 text-[#677A67]" />
                    </div>
                    <div>
                      <p className="font-medium">{getRewardTypeLabel(reward.rewardType)}</p>
                      <p className="text-sm text-muted-foreground">
                        {reward.description || "Credited to your account"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {reward.earnedAt ? format(new Date(reward.earnedAt), "MMM d, yyyy") : "N/A"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-[#677A67]">
                        +{reward.creditsAmount}
                      </span>
                      <span className="text-sm text-muted-foreground">credits</span>
                    </div>
                    <div className="mt-1">
                      {getStatusBadge(reward.status)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
