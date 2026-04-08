import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Bell, Mail, CheckCircle2, AlertTriangle, TrendingUp, DollarSign,
  Megaphone, Star, UserPlus, RefreshCw, Info, Inbox,
} from "lucide-react";

type NotifType = "success" | "warning" | "payment" | "campaign" | "info" | "system";

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  read: boolean;
}

const TYPE_STYLES: Record<NotifType, { bg: string; icon: string; Icon: React.ElementType }> = {
  success:  { bg: "bg-emerald-500/15", icon: "text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 },
  warning:  { bg: "bg-amber-500/15",   icon: "text-amber-600 dark:text-amber-400", Icon: AlertTriangle },
  payment:  { bg: "bg-green-500/15",   icon: "text-green-600 dark:text-green-400", Icon: DollarSign },
  campaign: { bg: "bg-primary/10",     icon: "text-primary", Icon: Megaphone },
  info:     { bg: "bg-blue-500/15",    icon: "text-blue-600 dark:text-blue-400", Icon: Info },
  system:   { bg: "bg-muted",          icon: "text-muted-foreground", Icon: RefreshCw },
};

function timeLabel(dateStr: string) {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 60 * 1000) return formatDistanceToNow(date, { addSuffix: true });
  if (diff < 24 * 60 * 60 * 1000) return format(date, "h:mm a");
  if (diff < 7 * 24 * 60 * 60 * 1000) return format(date, "EEE");
  return format(date, "d MMM");
}

function NotifCard({ n }: { n: Notification }) {
  const style = TYPE_STYLES[n.type] || TYPE_STYLES.info;
  const Icon = style.Icon;

  return (
    <div className={`flex gap-3 p-4 rounded-2xl transition-all hover:bg-muted/40 ${
      !n.read ? "bg-muted/30 border border-border/50" : "bg-transparent border border-transparent"
    }`}>
      <div className={`w-9 h-9 rounded-xl ${style.bg} flex items-center justify-center shrink-0`}>
        <Icon size={16} className={style.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm leading-tight ${!n.read ? "font-semibold text-foreground" : "font-medium text-foreground/70"}`}>
            {n.title}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-muted-foreground">{timeLabel(n.time)}</span>
            {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{n.body}</p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <Inbox size={24} className="text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground/70">No notifications yet</p>
      <p className="text-xs text-muted-foreground mt-1">Activity from your campaigns and collaborations will appear here</p>
    </div>
  );
}

export default function Mailbox() {
  const [location] = useLocation();
  const [tab, setTab] = useState<"notifications" | "activity">("notifications");

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/mailbox/notifications"],
    queryFn: async () => {
      const res = await fetch("/api/mailbox/notifications", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const unread = notifications.filter(n => !n.read).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Mailbox</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {unread > 0 ? `${unread} unread item${unread > 1 ? "s" : ""}` : "All caught up"}
            </p>
          </div>
          {unread > 0 && (
            <Badge className="bg-primary text-primary-foreground border-0 text-xs px-2 py-0.5 rounded-full">
              {unread}
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="border border-border rounded-2xl p-1 mb-2 w-full h-10">
          <TabsTrigger
            value="notifications"
            className="flex-1 rounded-xl text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground transition-all flex items-center gap-1.5"
          >
            <Bell size={12} />
            Notifications
            {unread > 0 && (
              <span className="bg-primary-foreground/20 text-primary-foreground dark:bg-foreground/20 dark:text-foreground text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                {unread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="flex-1 rounded-xl text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground transition-all flex items-center gap-1.5"
          >
            <Mail size={12} />
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="space-y-1">
          {notifications.length > 0 ? (
            notifications.map((n) => <NotifCard key={n.id} n={n} />)
          ) : (
            <EmptyState />
          )}
        </TabsContent>

        <TabsContent value="activity" className="space-y-1">
          <EmptyState />
        </TabsContent>
      </Tabs>
    </div>
  );
}
