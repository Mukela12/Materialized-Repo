import { useState } from "react";
import { useLocation } from "wouter";
import { format, formatDistanceToNow, subHours, subDays, subMinutes, subWeeks } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Bell, Mail, CheckCircle2, AlertTriangle, TrendingUp, DollarSign,
  Megaphone, Star, Package, UserPlus, Video, RefreshCw, Info, ShieldCheck,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type NotifType = "success" | "warning" | "payment" | "campaign" | "info" | "system";

interface Notification {
  id: number;
  type: NotifType;
  title: string;
  body: string;
  time: Date;
  read: boolean;
  icon: React.ElementType;
}

interface Message {
  id: number;
  sender: string;
  senderInitials: string;
  avatarColor: string;
  subject: string;
  preview: string;
  time: Date;
  read: boolean;
}

// ─── Hardcoded data per role ─────────────────────────────────────────────────

const BRAND_NOTIFICATIONS: Notification[] = [
  { id: 1, type: "campaign", title: "Campaign live", body: '"Summer Collection" is now live and serving 3 publishers.', time: subHours(new Date(), 2), read: false, icon: Megaphone },
  { id: 2, type: "success", title: "10,000 views milestone", body: 'Your "Glow Routine" campaign just crossed 10,000 impressions.', time: subDays(new Date(), 1), read: false, icon: TrendingUp },
  { id: 3, type: "success", title: "Creator accepted invite", body: "Emma Style accepted your collaboration invite. Review her profile.", time: subDays(new Date(), 2), read: false, icon: UserPlus },
  { id: 4, type: "warning", title: "Publisher performance alert", body: "@creativehub.io is below the 2% conversion threshold. Consider a 48-h extension.", time: subDays(new Date(), 3), read: true, icon: AlertTriangle },
  { id: 5, type: "payment", title: "Subscription renewal due", body: "Your €249/month plan renews in 3 days. Update billing to avoid interruption.", time: subDays(new Date(), 4), read: true, icon: DollarSign },
  { id: 6, type: "system", title: "Product sync complete", body: "237 products synced from your Shopify store. 4 SKUs flagged for review.", time: subWeeks(new Date(), 1), read: true, icon: RefreshCw },
  { id: 7, type: "info", title: "Brand Kit saved", body: "Your brand fonts and colour palette have been extracted and saved.", time: subWeeks(new Date(), 1), read: true, icon: Star },
];

const BRAND_MESSAGES: Message[] = [
  { id: 1, sender: "Emma Style", senderInitials: "ES", avatarColor: "#677A67", subject: "First video is ready for review", preview: "Hi, I've just uploaded the 'Morning Routine' video and tagged all your products. Let me know if you'd like any changes...", time: subHours(new Date(), 3), read: false },
  { id: 2, sender: "Luca Ferretti", senderInitials: "LF", avatarColor: "#5b7fa6", subject: "Campaign brief question", preview: "Quick question about the colour palette — should I stick strictly to the brand kit or can I use complementary shades?", time: subDays(new Date(), 1), read: false },
  { id: 3, sender: "Materialized Support", senderInitials: "MS", avatarColor: "#43484D", subject: "API key configured successfully", preview: "Your Shopify API key has been verified and your inventory sync is active. You can manage webhook settings from the Developer tab.", time: subDays(new Date(), 2), read: true },
  { id: 4, sender: "Sofia Osei", senderInitials: "SO", avatarColor: "#a67c5b", subject: "Re: Campaign review feedback", preview: "Thanks for the feedback! I've adjusted the lighting and recut the product close-up as requested. The updated video is now live.", time: subDays(new Date(), 4), read: true },
];

const CREATOR_NOTIFICATIONS: Notification[] = [
  { id: 1, type: "payment", title: "Commission payout processed", body: "€127.50 from your affiliate commissions this week has been sent to your connected Stripe account.", time: subHours(new Date(), 4), read: false, icon: DollarSign },
  { id: 2, type: "campaign", title: "New brand invite", body: "Glow Cosmetics wants to collaborate on a skincare campaign. Review their brief before it expires in 48 hours.", time: subDays(new Date(), 1), read: false, icon: Megaphone },
  { id: 3, type: "success", title: '"Morning Routine" approved', body: "Your video has been reviewed and approved. It's now visible in the Global Video Library.", time: subDays(new Date(), 2), read: false, icon: CheckCircle2 },
  { id: 4, type: "info", title: "50K views milestone", body: '"Morning Routine" just hit 50,000 views. Your content is performing in the top 5% this month.', time: subDays(new Date(), 3), read: true, icon: TrendingUp },
  { id: 5, type: "success", title: "Top Creator reward unlocked", body: "You've reached the Gold tier! Your commission rate has increased to 20% on all future campaigns.", time: subDays(new Date(), 5), read: true, icon: Star },
  { id: 6, type: "system", title: "Video licensed", body: '@trendhub licensed "Morning Routine" from the Global Library. You\'ll receive the €45 listing fee within 48 hours.', time: subWeeks(new Date(), 1), read: true, icon: Video },
];

const CREATOR_MESSAGES: Message[] = [
  { id: 1, sender: "Glow Cosmetics", senderInitials: "GC", avatarColor: "#b07d6e", subject: "Partnership opportunity for you", preview: "Hi, we love your skincare content and think you'd be a perfect fit for our new SPF campaign launching next month. We'd love to offer...", time: subHours(new Date(), 5), read: false },
  { id: 2, sender: "Luminance Brand", senderInitials: "LB", avatarColor: "#7a6b9a", subject: "Re: Campaign brief", preview: "Great call yesterday! Here's the updated brief with the revised product list and talking points. Looking forward to seeing your take.", time: subDays(new Date(), 1), read: false },
  { id: 3, sender: "Materialized Support", senderInitials: "MS", avatarColor: "#43484D", subject: "Payout of €127.50 sent", preview: "Your commission payout for the week ending 8 March has been processed. Funds will appear in your Stripe account within 1-2 business days.", time: subDays(new Date(), 2), read: true },
  { id: 4, sender: "Noah Kim", senderInitials: "NK", avatarColor: "#5b9a7a", subject: "Affiliate invite accepted", preview: "Hi, I've accepted your affiliate invite and activated my UTM code. Excited to start promoting your videos to my audience!", time: subDays(new Date(), 5), read: true },
];

const PUBLISHER_NOTIFICATIONS: Notification[] = [
  { id: 1, type: "warning", title: "Publishing access paused", body: '"Winter Glow" campaign access has been paused by Luminance Brand. You have 48 hours to request an extension.', time: subMinutes(new Date(), 45), read: false, icon: AlertTriangle },
  { id: 2, type: "payment", title: "Commission payout — €85.00", body: "Your affiliate earnings for the week have been processed via Stripe. Expected arrival: 1-2 business days.", time: subDays(new Date(), 1), read: false, icon: DollarSign },
  { id: 3, type: "campaign", title: "New video available to license", body: '"Evening Ritual" by Sofia Osei is now in the Global Library. License it for €45 and start earning commissions.', time: subDays(new Date(), 2), read: false, icon: Video },
  { id: 4, type: "success", title: "UTM tracking activated", body: "Your unique UTM code for the 'Glow Routine' campaign is live. Embed it on your site to start tracking.", time: subDays(new Date(), 3), read: true, icon: ShieldCheck },
  { id: 5, type: "info", title: "450 link clicks this week", body: "Your affiliate link is performing well — 450 clicks and a 3.2% conversion rate. Keep it up!", time: subDays(new Date(), 5), read: true, icon: TrendingUp },
  { id: 6, type: "system", title: "Stripe Connect account ready", body: "Your Stripe Connect account has been verified. Payouts will now be sent automatically on Fridays.", time: subWeeks(new Date(), 1), read: true, icon: CheckCircle2 },
];

const PUBLISHER_MESSAGES: Message[] = [
  { id: 1, sender: "Luminance Brand", senderInitials: "LB", avatarColor: "#7a6b9a", subject: "Your publishing access has been paused", preview: "Hi, we've noticed your 'Winter Glow' campaign performance is below our threshold. We've temporarily paused your access. You can request a 48-hour grace period...", time: subMinutes(new Date(), 50), read: false },
  { id: 2, sender: "Glow Cosmetics", senderInitials: "GC", avatarColor: "#b07d6e", subject: "Congrats — top performer this week!", preview: "Your embed of the 'Morning Routine' video drove the highest conversions across all our publishers this week. We'd love to discuss extending your campaign.", time: subDays(new Date(), 2), read: false },
  { id: 3, sender: "Materialized Support", senderInitials: "MS", avatarColor: "#43484D", subject: "Stripe Connect verification complete", preview: "Great news — your Stripe Connect account has been verified and is ready to receive payouts. Your first payout will be scheduled for this Friday.", time: subDays(new Date(), 3), read: true },
  { id: 4, sender: "Emma Style", senderInitials: "ES", avatarColor: "#677A67", subject: "New video listed in library", preview: "Hi! I've just listed 'Evening Ritual' in the Global Video Library. It's my best performing skincare video with a 4.8% CVR — hope it works great for your audience.", time: subDays(new Date(), 6), read: true },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<NotifType, { bg: string; icon: string }> = {
  success:  { bg: "bg-emerald-500/15", icon: "text-emerald-600 dark:text-emerald-400" },
  warning:  { bg: "bg-amber-500/15",   icon: "text-amber-600 dark:text-amber-400" },
  payment:  { bg: "bg-green-500/15",   icon: "text-green-600 dark:text-green-400" },
  campaign: { bg: "bg-primary/10",     icon: "text-primary" },
  info:     { bg: "bg-blue-500/15",    icon: "text-blue-600 dark:text-blue-400" },
  system:   { bg: "bg-muted",          icon: "text-muted-foreground" },
};

function timeLabel(date: Date) {
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 60 * 1000) return formatDistanceToNow(date, { addSuffix: true });
  if (diff < 24 * 60 * 60 * 1000) return format(date, "h:mm a");
  if (diff < 7 * 24 * 60 * 60 * 1000) return format(date, "EEE");
  return format(date, "d MMM");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NotifCard({ n, onRead }: { n: Notification; onRead: (id: number) => void }) {
  const style = TYPE_STYLES[n.type];
  const Icon = n.icon;

  return (
    <div
      data-testid={`notif-card-${n.id}`}
      onClick={() => onRead(n.id)}
      className={`flex gap-3 p-4 rounded-2xl cursor-pointer transition-all hover:bg-muted/40 ${
        !n.read ? "bg-muted/30 border border-border/50" : "bg-transparent border border-transparent"
      }`}
    >
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

function MessageCard({ m, onRead }: { m: Message; onRead: (id: number) => void }) {
  return (
    <div
      data-testid={`message-card-${m.id}`}
      onClick={() => onRead(m.id)}
      className={`flex gap-3 p-4 rounded-2xl cursor-pointer transition-all hover:bg-muted/40 ${
        !m.read ? "bg-muted/30 border border-border/50" : "bg-transparent border border-transparent"
      }`}
    >
      <Avatar className="w-9 h-9 shrink-0">
        <AvatarFallback style={{ backgroundColor: m.avatarColor + "33", color: m.avatarColor }} className="text-xs font-semibold">
          {m.senderInitials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <p className={`text-sm ${!m.read ? "font-semibold text-foreground" : "font-medium text-foreground/70"}`}>
            {m.sender}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-muted-foreground">{timeLabel(m.time)}</span>
            {!m.read && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
          </div>
        </div>
        <p className={`text-xs truncate mb-0.5 ${!m.read ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}>
          {m.subject}
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{m.preview}</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Mailbox() {
  const [location] = useLocation();

  const isCreator   = location.startsWith("/creator");
  const isAffiliate = location.startsWith("/affiliate");

  const rawNotifs  = isCreator ? CREATOR_NOTIFICATIONS : isAffiliate ? PUBLISHER_NOTIFICATIONS : BRAND_NOTIFICATIONS;
  const rawMsgs    = isCreator ? CREATOR_MESSAGES      : isAffiliate ? PUBLISHER_MESSAGES      : BRAND_MESSAGES;

  const [notifs, setNotifs]   = useState(rawNotifs);
  const [messages, setMsgs]   = useState(rawMsgs);
  const [tab, setTab]         = useState<"notifications" | "messages">("notifications");

  const unreadNotifs = notifs.filter((n) => !n.read).length;
  const unreadMsgs   = messages.filter((m) => !m.read).length;
  const totalUnread  = unreadNotifs + unreadMsgs;

  const markNotifRead  = (id: number) => setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
  const markMessageRead = (id: number) => setMsgs((prev) => prev.map((m) => m.id === id ? { ...m, read: true } : m));
  const markAllRead    = () => { setNotifs((p) => p.map((n) => ({ ...n, read: true }))); setMsgs((p) => p.map((m) => ({ ...m, read: true }))); };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Mailbox</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalUnread > 0 ? `${totalUnread} unread item${totalUnread > 1 ? "s" : ""}` : "All caught up"}
            </p>
          </div>
          {totalUnread > 0 && (
            <Badge className="bg-primary text-primary-foreground border-0 text-xs px-2 py-0.5 rounded-full" data-testid="badge-unread-count">
              {totalUnread}
            </Badge>
          )}
        </div>
        {totalUnread > 0 && (
          <button
            data-testid="button-mark-all-read"
            onClick={markAllRead}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList
          className="border border-border rounded-2xl p-1 mb-2 w-full h-10"
          data-testid="tabs-mailbox"
        >
          <TabsTrigger
            value="notifications"
            data-testid="tab-notifications"
            className="flex-1 rounded-xl text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground transition-all flex items-center gap-1.5"
          >
            <Bell size={12} />
            Notifications
            {unreadNotifs > 0 && (
              <span className="bg-primary-foreground/20 text-primary-foreground dark:bg-foreground/20 dark:text-foreground text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                {unreadNotifs}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="messages"
            data-testid="tab-messages"
            className="flex-1 rounded-xl text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground transition-all flex items-center gap-1.5"
          >
            <Mail size={12} />
            Messages
            {unreadMsgs > 0 && (
              <span className="bg-primary-foreground/20 text-primary-foreground dark:bg-foreground/20 dark:text-foreground text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                {unreadMsgs}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="space-y-1">
          {notifs.map((n) => (
            <NotifCard key={n.id} n={n} onRead={markNotifRead} />
          ))}
        </TabsContent>

        <TabsContent value="messages" className="space-y-1">
          {messages.map((m) => (
            <MessageCard key={m.id} m={m} onRead={markMessageRead} />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
