import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { format, differenceInDays, addDays, formatDistanceToNow } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Video,
  User,
  TrendingUp,
  MousePointer,
  DollarSign,
  RefreshCw,
  AlertTriangle,
  Clock,
  Ban,
  ChevronRight,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Campaign, CampaignAffiliate } from "@shared/schema";

const TOTAL_DAYS = 60;

function daysRemaining(campaign: Campaign): number {
  if (!campaign.startDate) return TOTAL_DAYS;
  const end = addDays(new Date(campaign.startDate), (campaign as any).totalDays ?? TOTAL_DAYS);
  return Math.max(0, differenceInDays(end, new Date()));
}

type CampaignDetail = Campaign & {
  affiliates: (CampaignAffiliate & { user?: { id: string; name: string | null; email: string } })[];
};

export default function BrandCampaignDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/brand/campaigns/:id");
  const { toast } = useToast();
  const campaignId = params?.id ?? "";

  const [disableTarget, setDisableTarget] = useState<string | null>(null);
  const [disableMessage, setDisableMessage] = useState(
    "Hi, we've noticed your performance metrics are below the campaign threshold. We're temporarily pausing your publisher access. You can request a 48-hour grace period to turn things around — we believe in you!"
  );

  const { data: detail, isLoading } = useQuery<CampaignDetail>({
    queryKey: ["/api/campaigns", campaignId, "detail"],
    queryFn: () => fetch(`/api/campaigns/${campaignId}/detail`).then((r) => r.json()),
    enabled: !!campaignId,
  });

  const disableMut = useMutation({
    mutationFn: ({ caId, message }: { caId: string; message: string }) =>
      apiRequest("POST", `/api/campaigns/${campaignId}/publishers/${caId}/disable`, {
        message,
        campaignName: detail?.name ?? "",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "detail"] });
      setDisableTarget(null);
      toast({ title: "Publisher paused", description: "A notification has been sent to the publisher." });
    },
    onError: () => toast({ title: "Failed to pause publisher", variant: "destructive" }),
  });

  const extendMut = useMutation({
    mutationFn: (caId: string) =>
      apiRequest("POST", `/api/campaigns/${campaignId}/publishers/${caId}/extend`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "detail"] });
      toast({ title: "48-hour grace granted", description: "Publisher access has been restored temporarily." });
    },
    onError: () => toast({ title: "Failed to extend", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40 rounded-xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Campaign not found.</p>
      </div>
    );
  }

  const rem = daysRemaining(detail);
  const total = (detail as any).totalDays ?? TOTAL_DAYS;
  const pct = Math.max(0, Math.min(100, ((total - rem) / total) * 100));
  const isExpired = detail.status === "completed" || detail.status === "cancelled" || rem === 0;
  const gross = parseFloat(detail.actualRevenue ?? "0");
  const fees = (detail.affiliates ?? []).reduce((s, a) => s + parseFloat(a.totalEarnings ?? "0"), 0);
  const net = gross - fees;

  const targetPublisher = disableTarget
    ? detail.affiliates.find((a) => a.id === disableTarget)
    : null;

  return (
    <div className="space-y-5 pb-6">
      {/* Top bar */}
      <div className="flex items-center gap-3">
        <button
          data-testid="button-back"
          onClick={() => navigate("/brand/campaigns")}
          className="w-8 h-8 rounded-xl bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors shrink-0"
        >
          <ArrowLeft size={16} className="text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-lg leading-tight truncate text-foreground">{detail.name}</h1>
          <p className="text-xs text-muted-foreground">Campaign detail</p>
        </div>
        <Badge
          className={`text-[10px] px-2.5 py-1 rounded-full border-0 font-medium shrink-0 ${
            isExpired ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
          }`}
        >
          {isExpired ? "Expired" : "Active"}
        </Badge>
      </div>

      {/* Campaign summary card */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        {/* Launch date & creator */}
        <div className="grid grid-cols-2 gap-3">
          <InfoChip icon={<Video size={13} />} label="Launched">
            {detail.startDate ? format(new Date(detail.startDate), "d MMM yyyy") : "—"}
          </InfoChip>
          <InfoChip icon={<User size={13} />} label="Creator">
            {(detail as any).creatorName ?? (detail.creatorIds ? JSON.parse(detail.creatorIds)[0] ?? "—" : "—")}
          </InfoChip>
        </div>

        {/* Days remaining */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[11px] text-muted-foreground">Day {total - rem} of {total}</span>
            <span className="text-[11px] font-medium text-foreground/70">
              {rem > 0 ? `${rem} days remaining` : "Campaign ended"}
            </span>
          </div>
          <Progress value={pct} className="h-2" data-testid="progress-days" />
        </div>

        {/* Performance stats */}
        <div className="grid grid-cols-3 gap-2">
          <SmallStat icon={<RefreshCw size={11} />} label="Reposts" value={(detail as any).repostCount ?? 0} />
          <SmallStat icon={<TrendingUp size={11} />} label="Units Sold" value={detail.actualConversions ?? 0} />
          <SmallStat icon={<MousePointer size={11} />} label="Clicks" value={detail.actualClicks ?? 0} />
        </div>

        {/* Financial summary */}
        <div className="border-t border-border pt-3 grid grid-cols-3 gap-2">
          <FinTile label="Gross Value" value={`€${gross.toFixed(2)}`} />
          <FinTile label="Affiliate Fees" value={`€${fees.toFixed(2)}`} color="text-red-500 dark:text-red-400" />
          <FinTile label="Net Earned" value={`€${net.toFixed(2)}`} color="text-emerald-600 dark:text-emerald-400" />
        </div>
      </div>

      {/* Publisher list */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
          Publishers ({detail.affiliates?.length ?? 0})
        </h2>

        {!detail.affiliates || detail.affiliates.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <p className="text-muted-foreground text-sm">No publishers linked to this campaign yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {detail.affiliates.map((aff) => {
              const isDisabled = aff.isDisabled;
              const hasGrace = !isDisabled && aff.graceUntil && new Date(aff.graceUntil) > new Date();
              return (
                <div
                  key={aff.id}
                  data-testid={`card-publisher-${aff.id}`}
                  className={`bg-card border rounded-2xl p-4 transition-all ${
                    isDisabled ? "border-red-500/20 opacity-70" : hasGrace ? "border-amber-500/20" : "border-border"
                  }`}
                >
                  {/* Publisher header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User size={15} className="text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {aff.user?.name ?? aff.user?.email ?? aff.affiliateId}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{aff.user?.email ?? ""}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      {isDisabled && (
                        <Badge className="bg-red-500/15 text-red-500 dark:text-red-400 border-0 text-[10px] px-2 py-0.5 rounded-full">
                          Paused
                        </Badge>
                      )}
                      {hasGrace && (
                        <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-0 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock size={9} />
                          Grace until {format(new Date(aff.graceUntil!), "d MMM HH:mm")}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {parseFloat(aff.commissionRate).toFixed(0)}% commission
                      </span>
                    </div>
                  </div>

                  {/* Performance metrics */}
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <PubStat label="Clicks" value={aff.totalClicks ?? 0} />
                    <PubStat label="Conv." value={aff.totalConversions ?? 0} />
                    <PubStat label="Revenue" value={`€${parseFloat(aff.totalRevenue ?? "0").toFixed(0)}`} />
                    <PubStat label="Earnings" value={`€${parseFloat(aff.totalEarnings ?? "0").toFixed(0)}`} />
                  </div>

                  {/* UTM code */}
                  <div className="bg-muted/40 rounded-lg px-3 py-1.5 flex items-center justify-between mb-3">
                    <span className="text-[10px] text-muted-foreground font-mono truncate">{aff.utmCode ?? "—"}</span>
                    <span className="text-[10px] text-muted-foreground/60 ml-2 shrink-0">UTM</span>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {!isDisabled ? (
                      <Button
                        data-testid={`button-disable-${aff.id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => setDisableTarget(aff.id)}
                        className="flex-1 h-8 text-xs border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50 rounded-xl bg-transparent"
                      >
                        <Ban size={12} className="mr-1.5" />
                        Deactivate Publisher
                      </Button>
                    ) : (
                      <Button
                        data-testid={`button-extend-${aff.id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => extendMut.mutate(aff.id)}
                        disabled={extendMut.isPending}
                        className="flex-1 h-8 text-xs border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-xl bg-transparent"
                      >
                        <Clock size={12} className="mr-1.5" />
                        Give 48-Hour Extension
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Deactivate dialog */}
      <Dialog open={!!disableTarget} onOpenChange={(o) => !o && setDisableTarget(null)}>
        <DialogContent className="rounded-3xl max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle size={16} className="text-amber-500" />
              Deactivate Publisher
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              This will disable the publisher's embed on their site and send them the following notification.
            </DialogDescription>
          </DialogHeader>

          {targetPublisher && (
            <div className="bg-muted/40 rounded-xl px-3 py-2 text-sm text-foreground/70 mb-2">
              <span className="font-medium text-foreground">
                {targetPublisher.user?.name ?? targetPublisher.user?.email ?? targetPublisher.affiliateId}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Notification message</label>
            <Textarea
              data-testid="textarea-disable-message"
              value={disableMessage}
              onChange={(e) => setDisableMessage(e.target.value)}
              rows={5}
              className="text-xs resize-none rounded-xl"
            />
          </div>

          <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300/80">
            <p className="font-medium mb-1">What happens next</p>
            <ul className="space-y-1 text-amber-600 dark:text-amber-300/60">
              <li className="flex items-center gap-1.5"><ChevronRight size={10} />Embed disabled on publisher site</li>
              <li className="flex items-center gap-1.5"><ChevronRight size={10} />Notification sent with performance tips</li>
              <li className="flex items-center gap-1.5"><ChevronRight size={10} />Publisher can request a 48-hour grace period</li>
            </ul>
          </div>

          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              data-testid="button-cancel-disable"
              variant="outline"
              onClick={() => setDisableTarget(null)}
              className="flex-1 rounded-xl"
            >
              Cancel
            </Button>
            <Button
              data-testid="button-confirm-disable"
              onClick={() => disableTarget && disableMut.mutate({ caId: disableTarget, message: disableMessage })}
              disabled={disableMut.isPending}
              className="flex-1 bg-red-500/80 hover:bg-red-500 text-white rounded-xl"
            >
              {disableMut.isPending ? "Pausing…" : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoChip({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <span className="text-xs font-medium text-foreground">{children}</span>
    </div>
  );
}

function SmallStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="bg-muted/40 rounded-xl p-2.5 flex items-center gap-2">
      <span className="text-muted-foreground/60 shrink-0">{icon}</span>
      <div>
        <div className="text-xs font-semibold text-foreground">{value}</div>
        <div className="text-[9px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function FinTile({ label, value, color = "text-foreground/80" }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className={`text-sm font-semibold ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground mt-0.5">{label}</span>
    </div>
  );
}

function PubStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-muted/40 rounded-lg p-2 text-center">
      <div className="text-xs font-semibold text-foreground">{value}</div>
      <div className="text-[9px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
