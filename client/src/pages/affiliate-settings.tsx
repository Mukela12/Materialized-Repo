import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  CreditCard, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  Wallet,
  Building2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type StripeConnectStatus = {
  connected: boolean;
  onboarded: boolean;
  accountId?: string;
};

type User = {
  id: string;
  email: string;
  displayName: string;
  commissionRate: string;
  stripeConnectAccountId: string | null;
  stripeConnectOnboarded: boolean | null;
};

export default function AffiliateSettings() {
  const { toast } = useToast();

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ['/api/users/me'],
  });

  const { data: stripeStatus, isLoading: stripeLoading } = useQuery<StripeConnectStatus>({
    queryKey: ['/api/stripe/connect/status'],
  });

  const createConnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/stripe/connect/create');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/stripe/connect/status'] });
      toast({
        title: "Account Created",
        description: "Your payout account has been created. Complete onboarding to receive payments.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create payout account. Please try again.",
        variant: "destructive",
      });
    },
  });

  const startOnboardingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/stripe/connect/onboarding');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, '_blank');
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start onboarding. Please try again.",
        variant: "destructive",
      });
    },
  });

  const isLoading = userLoading || stripeLoading;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
          Payout Settings
        </h1>
        <p className="text-muted-foreground">
          Manage your payout account and payment preferences
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="w-5 h-5" />
                  Account Overview
                </CardTitle>
                <CardDescription>
                  Your affiliate account details
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium" data-testid="text-user-email">{user?.email}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Commission Rate</p>
                  <p className="font-medium" data-testid="text-commission-rate">{user?.commissionRate}%</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  Payout Account
                </CardTitle>
                <CardDescription>
                  Connect your bank account to receive affiliate commissions
                </CardDescription>
              </div>
              {stripeStatus?.onboarded ? (
                <Badge className="bg-chart-2 text-white">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              ) : stripeStatus?.connected ? (
                <Badge variant="secondary">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Pending
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {!stripeStatus?.connected ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
                    <CreditCard className="w-5 h-5 mt-0.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Set Up Payouts</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Connect your bank account through Stripe to receive automatic payouts 
                        when you earn commissions. This is a one-time setup.
                      </p>
                    </div>
                  </div>
                  <Button 
                    onClick={() => createConnectMutation.mutate()}
                    disabled={createConnectMutation.isPending}
                    data-testid="button-create-payout-account"
                  >
                    {createConnectMutation.isPending ? "Creating..." : "Create Payout Account"}
                  </Button>
                </div>
              ) : !stripeStatus?.onboarded ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                    <AlertCircle className="w-5 h-5 mt-0.5 text-amber-600" />
                    <div>
                      <p className="font-medium text-amber-800 dark:text-amber-200">Complete Onboarding</p>
                      <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                        Your payout account has been created but you need to complete the 
                        onboarding process to verify your identity and add your bank details.
                      </p>
                    </div>
                  </div>
                  <Button 
                    onClick={() => startOnboardingMutation.mutate()}
                    disabled={startOnboardingMutation.isPending}
                    data-testid="button-complete-onboarding"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {startOnboardingMutation.isPending ? "Loading..." : "Complete Onboarding"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
                    <CheckCircle2 className="w-5 h-5 mt-0.5 text-green-600" />
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-200">Payouts Active</p>
                      <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                        Your payout account is fully set up. Commissions will be automatically 
                        transferred to your connected bank account.
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Account ID: <code className="px-2 py-1 bg-muted rounded">{stripeStatus.accountId}</code>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Payout Schedule
              </CardTitle>
              <CardDescription>
                How and when you receive your earnings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Payout Frequency</p>
                  <p className="font-medium">Monthly</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Payouts are processed on the 1st of each month
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Minimum Payout</p>
                  <p className="font-medium">$50.00</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Balance carries over if threshold not met
                  </p>
                </div>
              </div>
              <Separator />
              <div className="text-sm text-muted-foreground">
                All payouts are processed securely through Stripe. Standard bank processing 
                times apply (typically 2-5 business days).
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
