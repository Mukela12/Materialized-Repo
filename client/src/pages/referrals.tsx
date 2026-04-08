import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReferralsTable } from "@/components/ReferralsTable";
import { Send, CheckCircle, Clock, XCircle, Plus, TrendingUp } from "lucide-react";
import type { BrandReferral } from "@shared/schema";

export default function Referrals() {
  const { data: referrals = [], isLoading } = useQuery<BrandReferral[]>({
    queryKey: ["/api/referrals"],
  });

  const statusCounts = {
    pending: referrals.filter((r) => r.status === "pending").length,
    sent: referrals.filter((r) => r.status === "sent").length,
    accepted: referrals.filter((r) => r.status === "accepted").length,
    declined: referrals.filter((r) => r.status === "declined").length,
  };

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Brand Referrals</h1>
          <p className="text-muted-foreground mt-1">
            Track and manage your brand referrals to grow the network
          </p>
        </div>
        <Button className="rounded-full gap-2">
          <Plus className="h-4 w-4" />
          New Referral
        </Button>
      </div>

      <Card className="bg-gradient-to-r from-primary/10 to-chart-2/10 border-0">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="h-7 w-7 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg">Grow the Network, Earn Rewards</h3>
              <p className="text-muted-foreground mt-1">
                Every brand you refer that joins the platform earns you bonus commissions on their products. 
                Help us build the biggest video commerce ecosystem.
              </p>
            </div>
            <Badge variant="secondary" className="text-lg px-4 py-2 bg-primary text-primary-foreground">
              +5% Bonus
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="h-10 w-10 mx-auto rounded-lg bg-yellow-500/10 flex items-center justify-center mb-2">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
            <p className="text-2xl font-bold">{statusCounts.pending}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="h-10 w-10 mx-auto rounded-lg bg-blue-500/10 flex items-center justify-center mb-2">
              <Send className="h-5 w-5 text-blue-600" />
            </div>
            <p className="text-2xl font-bold">{statusCounts.sent}</p>
            <p className="text-xs text-muted-foreground">Sent</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="h-10 w-10 mx-auto rounded-lg bg-green-500/10 flex items-center justify-center mb-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <p className="text-2xl font-bold">{statusCounts.accepted}</p>
            <p className="text-xs text-muted-foreground">Accepted</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="h-10 w-10 mx-auto rounded-lg bg-red-500/10 flex items-center justify-center mb-2">
              <XCircle className="h-5 w-5 text-red-600" />
            </div>
            <p className="text-2xl font-bold">{statusCounts.declined}</p>
            <p className="text-xs text-muted-foreground">Declined</p>
          </CardContent>
        </Card>
      </div>

      <ReferralsTable referrals={referrals} isLoading={isLoading} />
    </div>
  );
}
