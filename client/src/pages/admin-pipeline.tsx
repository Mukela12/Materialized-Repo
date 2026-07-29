import { useState } from "react";
import { formatMoney } from "@/lib/currency";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTableControls, type SortDir } from "@/hooks/useTableControls";
import { exportToCsv } from "@/lib/exportCsv";
import { TableToolbar } from "@/components/TableToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  CheckCircle2,
  Clock,
  FileSignature,
  CreditCard,
  Eye,
  MousePointerClick,
  Send,
  StickyNote,
  RefreshCw,
  TrendingUp,
  Globe,
  Zap,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Percent,
  Wallet,
  Ban,
  XCircle,
  DollarSign,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface PipelineEntry {
  id: string;
  brandName: string;
  prContactName: string;
  prContactEmail: string;
  videoTitle: string | null;
  videoUrl: string | null;
  creatorName: string;
  creatorEmail: string | null;
  status: string;
  createdAt: string | null;
  authorizedAt: string | null;
  agreementStartedAt: string | null;
  agreementSignedAt: string | null;
  brandSubscribedAt: string | null;
  followUpCount: number | null;
  lastFollowUpAt: string | null;
  lastFollowUpType: string | null;
  adminNotes: string | null;
  videoViews: number;
  videoClicks: number;
}

const STAGE_ORDER = [
  "pending",
  "email_sent",
  "authorized",
  "agreement_sent",
  "completed",
  "declined",
];

const STAGE_CONFIG: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  pending:        { label: "Pending",          color: "text-gray-500",   icon: Clock,          bg: "bg-gray-100 dark:bg-gray-800" },
  email_sent:     { label: "Email Sent",        color: "text-blue-600",   icon: Mail,           bg: "bg-blue-50 dark:bg-blue-900/20" },
  authorized:     { label: "Authorised",        color: "text-amber-600",  icon: CheckCircle2,   bg: "bg-amber-50 dark:bg-amber-900/20" },
  agreement_sent: { label: "Agreement Sent",    color: "text-purple-600", icon: FileSignature,  bg: "bg-purple-50 dark:bg-purple-900/20" },
  completed:      { label: "Signed",            color: "text-green-600",  icon: FileSignature,  bg: "bg-green-50 dark:bg-green-900/20" },
  declined:       { label: "Declined",          color: "text-red-600",    icon: AlertCircle,    bg: "bg-red-50 dark:bg-red-900/20" },
};

const FOLLOW_UP_OPTIONS = [
  { value: "docusign_reminder",   label: "DocuSign Reminder",       icon: FileSignature,  desc: "Nudge the brand to sign the pending agreement" },
  { value: "results_excitement",  label: "Video Results Email",     icon: TrendingUp,     desc: "Share video views/clicks and pitch the platform value" },
  { value: "global_pitch",        label: "Global Expansion Pitch",  icon: Globe,          desc: "Paint the big picture — global creator marketing at scale" },
  { value: "subscription_nudge",  label: "Subscribe Nudge",         icon: CreditCard,     desc: "Push the brand to subscribe and unlock their dashboard" },
];

function stageBadge(entry: PipelineEntry) {
  const cfg = STAGE_CONFIG[entry.status] ?? STAGE_CONFIG.pending;
  const Icon = cfg.icon;
  const isSubscribed = !!entry.brandSubscribedAt;
  if (isSubscribed) {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 border-0">
        <CreditCard className="h-3 w-3" /> Subscribed
      </Badge>
    );
  }
  const hasAgreementSigned = !!entry.agreementSignedAt;
  if (hasAgreementSigned && entry.status !== "declined") {
    return (
      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1 border-0">
        <FileSignature className="h-3 w-3" /> Agreement Signed
      </Badge>
    );
  }
  const hasAgreementStarted = !!entry.agreementStartedAt && !hasAgreementSigned;
  if (hasAgreementStarted) {
    return (
      <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 gap-1 border-0">
        <Clock className="h-3 w-3" /> Agreement Opened
      </Badge>
    );
  }
  return (
    <Badge className={`${cfg.bg} ${cfg.color} gap-1 border-0`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </Badge>
  );
}

function pipelineStage(entry: PipelineEntry): number {
  if (entry.brandSubscribedAt) return 5;
  if (entry.agreementSignedAt) return 4;
  if (entry.agreementStartedAt) return 3;
  if (entry.status === "authorized" || entry.status === "agreement_sent" || entry.status === "completed") return 2;
  if (entry.status === "email_sent") return 1;
  return 0;
}

interface DashboardStats {
  totalUsers: number;
  totalVideos: number;
  totalBrands: number;
  totalCampaigns: number;
  activeSubscriptions: number;
  usersByRole: Record<string, number>;
}

interface AdminUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: string;
  isAdmin: boolean;
  freeAccess: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  commissionRateOverride?: string | null;
  stripeConnectAccountId?: string | null;
  stripeConnectOnboarded?: boolean | null;
}

function AdminOverview() {
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["/api/admin/dashboard"],
    queryFn: () => fetch("/api/admin/dashboard", { credentials: "include" }).then(r => r.json()),
  });

  if (!stats) return <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const cards = [
    { label: "Total Users", value: stats.totalUsers, icon: "👥" },
    { label: "Videos", value: stats.totalVideos, icon: "🎬" },
    { label: "Brands", value: stats.totalBrands, icon: "🏷" },
    { label: "Campaigns", value: stats.totalCampaigns, icon: "📊" },
    { label: "Active Subscriptions", value: stats.activeSubscriptions, icon: "💳" },
    { label: "Creators", value: stats.usersByRole?.creator ?? 0, icon: "🎨" },
    { label: "Brand Accounts", value: stats.usersByRole?.brand ?? 0, icon: "🏢" },
    { label: "Affiliates", value: stats.usersByRole?.affiliate ?? 0, icon: "🔗" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map(c => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">{c.icon} {c.label}</p>
            <p className="text-2xl font-bold">{c.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AdminUsers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => fetch("/api/admin/users", { credentials: "include" }).then(r => r.json()),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Record<string, any> }) =>
      apiRequest("PATCH", `/api/admin/users/${id}`, updates),
    onSuccess: () => {
      toast({ title: "User updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const { query, setQuery, sortKey, sortDir, toggleSort, rows } = useTableControls(users, {
    searchFields: (u) => [u.displayName, u.username, u.email, u.role],
    sortAccessors: {
      name: (u) => u.displayName,
      email: (u) => u.email,
      role: (u) => u.role,
    },
  });

  const handleExport = () =>
    exportToCsv("admin-users", rows, [
      { header: "Name", value: (u) => u.displayName },
      { header: "Username", value: (u) => u.username },
      { header: "Email", value: (u) => u.email },
      { header: "Role", value: (u) => u.role },
      { header: "Admin", value: (u) => (u.isAdmin ? "yes" : "no") },
      { header: "Free Access", value: (u) => (u.freeAccess ? "yes" : "no") },
      { header: "Email Verified", value: (u) => (u.emailVerified ? "yes" : "no") },
    ]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          onExport={handleExport}
          exportDisabled={rows.length === 0}
          searchPlaceholder="Search users…"
          data-testid="admin-users-toolbar"
        />
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <SortTh label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortTh label="Email" sortKey="email" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortTh label="Role" sortKey="role" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <th className="p-3 font-medium">Status</th>
            <th className="p-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(u => (
            <tr key={u.id} className="border-b hover:bg-muted/50">
              <td className="p-3">
                <div className="font-medium">{u.displayName}</div>
                <div className="text-xs text-muted-foreground">@{u.username}</div>
              </td>
              <td className="p-3 text-muted-foreground">{u.email}</td>
              <td className="p-3">
                <Badge variant="outline" className="capitalize">{u.role}</Badge>
                {u.isAdmin && <Badge className="ml-1 bg-red-500/20 text-red-600 border-0">Admin</Badge>}
              </td>
              <td className="p-3">
                {u.emailVerified ? (
                  <Badge className="bg-green-500/20 text-green-600 border-0">Verified</Badge>
                ) : (
                  <Badge className="bg-yellow-500/20 text-yellow-600 border-0">Unverified</Badge>
                )}
                {u.freeAccess && <Badge className="ml-1 bg-blue-500/20 text-blue-600 border-0">Free</Badge>}
              </td>
              <td className="p-3">
                <div className="flex gap-1">
                  {!u.isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7"
                      onClick={() => updateMutation.mutate({ id: u.id, updates: { isAdmin: true } })}
                    >
                      Make Admin
                    </Button>
                  )}
                  {!u.freeAccess && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7"
                      onClick={() => updateMutation.mutate({ id: u.id, updates: { freeAccess: true } })}
                    >
                      Grant Free
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="text-center py-8 text-muted-foreground">
          {users.length === 0 ? "No users yet" : "No users match your search"}
        </p>
      )}
      </div>
    </div>
  );
}

interface AdminVideo {
  id: string;
  title: string;
  status: string;
  totalViews: number;
  totalClicks: number;
  totalRevenue: string;
  createdAt: string | null;
  creatorName: string;
}

function AdminVideos() {
  const { data: videos = [] } = useQuery<AdminVideo[]>({
    queryKey: ["/api/admin/videos"],
    queryFn: () => fetch("/api/admin/videos", { credentials: "include" }).then(r => r.json()),
  });

  const { query, setQuery, sortKey, sortDir, toggleSort, rows } = useTableControls(videos, {
    searchFields: (v) => [v.title, v.creatorName, v.status],
    sortAccessors: {
      title: (v) => v.title,
      creator: (v) => v.creatorName,
      status: (v) => v.status,
      views: (v) => v.totalViews ?? 0,
      clicks: (v) => v.totalClicks ?? 0,
      revenue: (v) => v.totalRevenue,
      createdAt: (v) => v.createdAt,
    },
  });

  const handleExport = () =>
    exportToCsv("admin-videos", rows, [
      { header: "Title", value: (v) => v.title },
      { header: "Creator", value: (v) => v.creatorName },
      { header: "Status", value: (v) => v.status },
      { header: "Views", value: (v) => v.totalViews ?? 0 },
      { header: "Clicks", value: (v) => v.totalClicks ?? 0 },
      { header: "Revenue", value: (v) => v.totalRevenue },
      { header: "Created At", value: (v) => v.createdAt },
    ]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          onExport={handleExport}
          exportDisabled={rows.length === 0}
          searchPlaceholder="Search videos…"
          data-testid="admin-videos-toolbar"
        />
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <SortTh label="Title" sortKey="title" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortTh label="Creator" sortKey="creator" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortTh label="Views" sortKey="views" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortTh label="Clicks" sortKey="clicks" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortTh label="Revenue" sortKey="revenue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortTh label="Created" sortKey="createdAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map(v => (
            <tr key={v.id} className="border-b hover:bg-muted/50">
              <td className="p-3 font-medium max-w-[200px] truncate">{v.title}</td>
              <td className="p-3 text-muted-foreground">{v.creatorName}</td>
              <td className="p-3">
                <Badge variant="outline" className="capitalize">{v.status}</Badge>
              </td>
              <td className="p-3">{v.totalViews?.toLocaleString() ?? 0}</td>
              <td className="p-3">{v.totalClicks?.toLocaleString() ?? 0}</td>
              <td className="p-3">{v.totalRevenue ? `$${Number(v.totalRevenue).toFixed(2)}` : "$0.00"}</td>
              <td className="p-3 text-muted-foreground text-xs">
                {v.createdAt ? format(new Date(v.createdAt), "MMM d, yyyy") : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="text-center py-8 text-muted-foreground">
          {videos.length === 0 ? "No videos uploaded yet" : "No videos match your search"}
        </p>
      )}
      </div>
    </div>
  );
}

interface AdminBrand {
  id: string;
  name: string;
  category: string | null;
  website: string | null;
  isActive: boolean;
  /** Admin-granted inventory window. Null = never granted. Past = lapsed/revoked. */
  inventoryAccessUntil: string | null;
  inventoryAccessNote: string | null;
}

/** True while an admin grant is still running. Mirrors the server gate. */
function inventoryLive(b: AdminBrand): boolean {
  return !!b.inventoryAccessUntil && new Date(b.inventoryAccessUntil).getTime() > Date.now();
}

function AdminBrands() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: brands = [] } = useQuery<AdminBrand[]>({
    queryKey: ["/api/admin/brands"],
    queryFn: () => fetch("/api/admin/brands", { credentials: "include" }).then(r => r.json()),
  });

  // Switch a brand's inventory on for 30 days (the "$29 admin fee, no
  // subscription" case) or revoke it. The $29 is settled out of band; this only
  // records the window.
  const setAccess = useMutation({
    mutationFn: ({ id, days, note }: { id: string; days: number; note?: string }) =>
      apiRequest("PUT", `/api/admin/brands/${id}/inventory-access`, { days, note }),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brands"] });
      toast({
        title: v.days > 0 ? "Inventory switched on" : "Inventory access revoked",
        description: v.days > 0
          ? `Discoverable for ${v.days} days.`
          : "This brand's products are no longer discoverable.",
      });
    },
    onError: () => toast({ title: "Could not update inventory access", variant: "destructive" }),
  });

  const { query, setQuery, sortKey, sortDir, toggleSort, rows } = useTableControls(brands, {
    searchFields: (b) => [b.name, b.category, b.website],
    sortAccessors: {
      name: (b) => b.name,
      category: (b) => b.category,
      status: (b) => (b.isActive ? 1 : 0),
    },
  });

  const handleExport = () =>
    exportToCsv("admin-brands", rows, [
      { header: "Brand", value: (b) => b.name },
      { header: "Category", value: (b) => b.category },
      { header: "Website", value: (b) => b.website },
      { header: "Status", value: (b) => (b.isActive ? "Active" : "Inactive") },
    ]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          onExport={handleExport}
          exportDisabled={rows.length === 0}
          searchPlaceholder="Search brands…"
          data-testid="admin-brands-toolbar"
        />
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <SortTh label="Brand" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortTh label="Category" sortKey="category" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <th className="p-3 font-medium">Website</th>
            <SortTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <th className="p-3 font-medium">Inventory</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(b => (
            <tr key={b.id} className="border-b hover:bg-muted/50">
              <td className="p-3 font-medium">{b.name}</td>
              <td className="p-3 text-muted-foreground">{b.category || "-"}</td>
              <td className="p-3">
                {b.website ? (
                  <a href={b.website.startsWith("http") ? b.website : `https://${b.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs">
                    {b.website}
                  </a>
                ) : "-"}
              </td>
              <td className="p-3">
                <Badge className={b.isActive ? "bg-green-500/20 text-green-600 border-0" : "bg-red-500/20 text-red-600 border-0"}>
                  {b.isActive ? "Active" : "Inactive"}
                </Badge>
              </td>
              <td className="p-3">
                {inventoryLive(b) ? (
                  <div className="flex items-center gap-2">
                    <Badge className="bg-green-500/20 text-green-600 border-0 whitespace-nowrap">
                      On &middot; till {new Date(b.inventoryAccessUntil!).toLocaleDateString()}
                    </Badge>
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                      disabled={setAccess.isPending}
                      onClick={() => setAccess.mutate({ id: b.id, days: 0 })}
                      data-testid={`button-revoke-inventory-${b.id}`}
                    >
                      Revoke
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-xs whitespace-nowrap"
                    disabled={setAccess.isPending}
                    onClick={() => setAccess.mutate({ id: b.id, days: 30, note: "Admin grant — $29 admin fee settled" })}
                    data-testid={`button-grant-inventory-${b.id}`}
                  >
                    Switch on 30 days
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="text-center py-8 text-muted-foreground">
          {brands.length === 0 ? "No brands registered yet" : "No brands match your search"}
        </p>
      )}
      </div>
    </div>
  );
}

// ==================== MONEY OPS ====================

interface FeeConfig {
  marketplaceFeePct: number;
  creatorPct: number;
  publisherPct: number;
}

interface AdminCommission {
  id: string;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  videoId: string;
  saleAmount: string;
  commissionRate: string;
  commissionAmount: string;
  status: string;
  createdAt: string | null;
}

interface AdminPayout {
  id: string;
  userId: string;
  affiliateName: string;
  amount: string;
  status: string | null;
  stripeTransferId: string | null;
  createdAt: string | null;
}

interface PayoutRunSummary {
  paid: Array<{ affiliateId: string; payoutId: string; amountCents: number; transferId: string }>;
  heldBelowThreshold: Array<{ affiliateId: string; amountCents: number }>;
  skippedNoAccount: Array<{ affiliateId: string; amountCents: number }>;
  failed: Array<{ affiliateId: string; payoutId?: string; amountCents: number; error: string }>;
}

const money = (v: string | number) => formatMoney(Number(v));
const centsMoney = (c: number) => formatMoney(c / 100);

/**
 * Clickable sort header for the admin native `<table>`s (these predate the
 * shadcn Table primitive). Mirrors the SortableHeader used elsewhere so sort
 * affordances look consistent app-wide.
 */
function SortTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  dir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={`p-3 font-medium ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        data-testid={`sort-${sortKey}`}
      >
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

function AdminMoneyOps() {
  const [subTab, setSubTab] = useState<"payouts" | "commissions" | "rates">("payouts");

  return (
    <div>
      {/* Money Ops sub-tabs — same underline pattern as the top-level tabs */}
      <div className="flex gap-1 mb-6 border-b overflow-x-auto">
        {(["payouts", "commissions", "rates"] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            data-testid={`money-subtab-${t}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
              subTab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {subTab === "payouts" && <MoneyPayouts />}
      {subTab === "commissions" && <MoneyCommissions />}
      {subTab === "rates" && <MoneyRates />}
    </div>
  );
}

function StatChip({
  label, count, amountCents, icon: Icon, tint,
}: { label: string; count: number; amountCents: number; icon: any; tint: string }) {
  return (
    <Card className="shadow-none border">
      <CardContent className="p-4">
        <Icon className={`h-5 w-5 mb-2 ${tint}`} />
        <p className="text-2xl font-bold">{count}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-1">{centsMoney(amountCents)}</p>
      </CardContent>
    </Card>
  );
}

function payoutStatusBadge(status: string | null) {
  const s = status ?? "pending";
  if (s === "paid") return <Badge className="bg-green-500/20 text-green-600 border-0">Paid</Badge>;
  if (s === "processing") return <Badge className="bg-blue-500/20 text-blue-600 border-0">Processing</Badge>;
  if (s === "failed") return <Badge className="bg-red-500/20 text-red-600 border-0">Failed</Badge>;
  return <Badge className="bg-gray-500/20 text-gray-600 border-0 capitalize">{s}</Badge>;
}

function commissionStatusBadge(status: string | null) {
  const s = status ?? "pending";
  if (s === "pending") return <Badge className="bg-amber-500/20 text-amber-600 border-0 capitalize">{s}</Badge>;
  if (s === "approved") return <Badge className="bg-blue-500/20 text-blue-600 border-0 capitalize">{s}</Badge>;
  if (s === "paid") return <Badge className="bg-green-500/20 text-green-600 border-0 capitalize">{s}</Badge>;
  if (s === "reversed") return <Badge className="bg-red-500/20 text-red-600 border-0 capitalize">{s}</Badge>;
  if (s === "rejected") return <Badge className="bg-gray-500/20 text-gray-600 border-0 capitalize">{s}</Badge>;
  return <Badge className="bg-gray-500/20 text-gray-600 border-0 capitalize">{s}</Badge>;
}

function MoneyPayouts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<PayoutRunSummary | null>(null);

  // Approved commissions preview the next run: how many affiliates, how much owed.
  const { data: approved = [] } = useQuery<AdminCommission[]>({
    queryKey: ["/api/admin/commissions", "approved"],
    queryFn: () => fetch("/api/admin/commissions?status=approved", { credentials: "include" }).then(r => r.json()),
  });

  const { data: payouts = [], isLoading } = useQuery<AdminPayout[]>({
    queryKey: ["/api/admin/payouts"],
    queryFn: () => fetch("/api/admin/payouts", { credentials: "include" }).then(r => r.json()),
  });

  const owedCents = approved.reduce((sum, c) => sum + Math.round(Number(c.commissionAmount) * 100), 0);
  const affiliateCount = new Set(approved.map(c => c.affiliateId)).size;

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/payouts/run"),
    onSuccess: async (res) => {
      const summary: PayoutRunSummary = await res.json();
      setResult(summary);
      setConfirmOpen(false);
      const paidCount = summary.paid.length;
      toast({
        title: paidCount > 0 ? `Paid ${paidCount} affiliate${paidCount === 1 ? "" : "s"}` : "Payout run complete",
        description: summary.failed.length > 0 ? `${summary.failed.length} failed` : undefined,
        variant: summary.failed.length > 0 ? "destructive" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/commissions", "approved"] });
    },
    onError: () => toast({ title: "Payout run failed", variant: "destructive" }),
  });

  const sumCents = (rows: Array<{ amountCents: number }>) => rows.reduce((s, r) => s + r.amountCents, 0);

  const { query, setQuery, sortKey, sortDir, toggleSort, rows: payoutRows } = useTableControls(payouts, {
    searchFields: (p) => [p.affiliateName, p.stripeTransferId],
    sortAccessors: {
      affiliate: (p) => p.affiliateName,
      amount: (p) => p.amount,
      status: (p) => p.status,
      createdAt: (p) => p.createdAt,
    },
  });

  const handleExport = () =>
    exportToCsv("payouts", payoutRows, [
      { header: "Affiliate", value: (p) => p.affiliateName },
      { header: "Amount", value: (p) => p.amount },
      { header: "Status", value: (p) => p.status ?? "" },
      { header: "Transfer ID", value: (p) => p.stripeTransferId ?? "" },
      { header: "Created At", value: (p) => p.createdAt },
    ]);

  return (
    <div className="space-y-6">
      {/* Pending-run summary + action */}
      <Card className="shadow-none border">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Next payout run</p>
            <p className="text-xs text-muted-foreground mt-1">
              {affiliateCount} affiliate{affiliateCount === 1 ? "" : "s"} · {money(owedCents / 100)} in approved commissions
            </p>
          </div>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={runMutation.isPending}
            className="gap-2"
            data-testid="button-run-payouts"
          >
            {runMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Run payouts
          </Button>
        </CardContent>
      </Card>

      {/* Result summary from the last run */}
      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatChip label="Paid" count={result.paid.length} amountCents={sumCents(result.paid)} icon={CheckCircle2} tint="text-green-600" />
            <StatChip label="Held (below min)" count={result.heldBelowThreshold.length} amountCents={sumCents(result.heldBelowThreshold)} icon={Clock} tint="text-yellow-600" />
            <StatChip label="No Connect account" count={result.skippedNoAccount.length} amountCents={sumCents(result.skippedNoAccount)} icon={Ban} tint="text-gray-500" />
            <StatChip label="Failed" count={result.failed.length} amountCents={sumCents(result.failed)} icon={XCircle} tint="text-red-600" />
          </div>
          {result.failed.length > 0 && (
            <Card className="shadow-none border border-red-500/30">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-red-600 mb-2 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> Failed transfers
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {result.failed.map((f, i) => (
                    <li key={i} className="font-mono">
                      {f.affiliateId.slice(0, 8)}… · {centsMoney(f.amountCents)} · {f.error}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Payout history */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <p className="text-sm font-medium">Payout history</p>
          <TableToolbar
            query={query}
            onQueryChange={setQuery}
            onExport={handleExport}
            exportDisabled={payoutRows.length === 0}
            searchPlaceholder="Search affiliate / transfer…"
            data-testid="payouts-toolbar"
          />
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <SortTh label="Affiliate" sortKey="affiliate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortTh label="Amount" sortKey="amount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="p-3 font-medium">Transfer ID</th>
                  <SortTh label="Date" sortKey="createdAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {payoutRows.map(p => (
                  <tr key={p.id} className="border-b hover:bg-muted/50" data-testid={`payout-row-${p.id}`}>
                    <td className="p-3 font-medium">{p.affiliateName}</td>
                    <td className="p-3">{money(p.amount)}</td>
                    <td className="p-3">{payoutStatusBadge(p.status)}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{p.stripeTransferId ?? "-"}</td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {p.createdAt ? format(new Date(p.createdAt), "MMM d, yyyy") : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payoutRows.length === 0 && (
              <p className="text-center py-8 text-muted-foreground">
                {payouts.length === 0 ? "No payouts yet" : "No payouts match your search"}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Run affiliate payouts?</DialogTitle>
            <DialogDescription>
              This transfers approved commissions to {affiliateCount} affiliate{affiliateCount === 1 ? "" : "s"} totalling {money(owedCents / 100)}.
              The run is idempotent, only pays onboarded Connect accounts, and holds balances below the minimum.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={runMutation.isPending} data-testid="button-cancel-payouts">
              Cancel
            </Button>
            <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending} className="gap-2" data-testid="button-confirm-payouts">
              {runMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Confirm run
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MoneyCommissions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "paid" | "reversed" | "rejected">("pending");
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const { data: commissions = [], isLoading } = useQuery<AdminCommission[]>({
    queryKey: ["/api/admin/commissions", statusFilter],
    queryFn: () => fetch(`/api/admin/commissions?status=${statusFilter}`, { credentials: "include" }).then(r => r.json()),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/commissions/${id}/approve`),
    onMutate: (id: string) => setApprovingId(id),
    onSuccess: () => {
      toast({ title: "Commission approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/commissions", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/commissions", "approved"] });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
    onSettled: () => setApprovingId(null),
  });

  const { query, setQuery, sortKey, sortDir, toggleSort, rows } = useTableControls(commissions, {
    searchFields: (c) => [c.affiliateName, c.affiliateEmail],
    sortAccessors: {
      affiliate: (c) => c.affiliateName,
      saleAmount: (c) => c.saleAmount,
      commissionRate: (c) => c.commissionRate,
      commissionAmount: (c) => c.commissionAmount,
      createdAt: (c) => c.createdAt,
    },
  });

  const handleExport = () =>
    exportToCsv(`commissions-${statusFilter}`, rows, [
      { header: "Affiliate", value: (c) => c.affiliateName },
      { header: "Email", value: (c) => c.affiliateEmail },
      { header: "Sale Amount", value: (c) => c.saleAmount },
      { header: "Commission Rate", value: (c) => c.commissionRate },
      { header: "Commission Amount", value: (c) => c.commissionAmount },
      { header: "Status", value: (c) => c.status },
      { header: "Created At", value: (c) => c.createdAt },
    ]);

  return (
    <div className="space-y-4">
      {/* Status filter pills + search / export */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex gap-2 flex-wrap">
          {(["pending", "approved", "paid", "reversed", "rejected"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              data-testid={`commission-filter-${s}`}
              className={`px-3 py-1 rounded-full text-xs font-medium border capitalize transition-colors ${
                statusFilter === s
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-transparent bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          onExport={handleExport}
          exportDisabled={rows.length === 0}
          searchPlaceholder="Search affiliate…"
          data-testid="commissions-toolbar"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <SortTh label="Affiliate" sortKey="affiliate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Sale" sortKey="saleAmount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Rate" sortKey="commissionRate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Commission" sortKey="commissionAmount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Created" sortKey="createdAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <th className="p-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} className="border-b hover:bg-muted/50" data-testid={`commission-row-${c.id}`}>
                  <td className="p-3">
                    <div className="font-medium">{c.affiliateName}</div>
                    <div className="text-xs text-muted-foreground">{c.affiliateEmail}</div>
                  </td>
                  <td className="p-3">{money(c.saleAmount)}</td>
                  <td className="p-3 text-muted-foreground">{Number(c.commissionRate).toFixed(2)}%</td>
                  <td className="p-3 font-medium">{money(c.commissionAmount)}</td>
                  <td className="p-3 text-muted-foreground text-xs">
                    {c.createdAt ? format(new Date(c.createdAt), "MMM d, yyyy") : "-"}
                  </td>
                  <td className="p-3">
                    {c.status === "pending" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={approvingId === c.id}
                        onClick={() => approveMutation.mutate(c.id)}
                        data-testid={`button-approve-${c.id}`}
                      >
                        {approvingId === c.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Approve
                      </Button>
                    ) : (
                      commissionStatusBadge(c.status)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">
              {commissions.length === 0
                ? `No ${statusFilter} commissions`
                : "No commissions match your search"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MoneyRates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: fees, isLoading } = useQuery<FeeConfig>({
    queryKey: ["/api/admin/settings/fees"],
    queryFn: () => fetch("/api/admin/settings/fees", { credentials: "include" }).then(r => r.json()),
  });

  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => fetch("/api/admin/users", { credentials: "include" }).then(r => r.json()),
  });

  const [form, setForm] = useState<FeeConfig | null>(null);
  const current = form ?? fees ?? null;

  const feesMutation = useMutation({
    mutationFn: (patch: FeeConfig) => apiRequest("PATCH", "/api/admin/settings/fees", patch),
    onSuccess: async (res) => {
      const saved: FeeConfig = await res.json();
      setForm(saved);
      toast({ title: "Fee settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/fees"] });
    },
    onError: () => toast({ title: "Failed to save fees", variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string | null }) =>
      apiRequest("PATCH", `/api/admin/users/${id}`, { commissionRateOverride: value }),
    onSuccess: () => {
      toast({ title: "Override saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: () => toast({ title: "Failed to save override", variant: "destructive" }),
  });

  const overAllocated = current ? current.creatorPct + current.publisherPct > current.marketplaceFeePct : false;
  const affiliates = users.filter(u => u.role === "affiliate");

  return (
    <div className="space-y-8">
      {/* Platform fee editor */}
      <Card className="shadow-none border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Percent className="h-4 w-4 text-primary" /> Platform fee & commission split
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {isLoading || !current ? (
            <div className="flex justify-center py-6"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {([
                  { key: "marketplaceFeePct", label: "Marketplace fee %" },
                  { key: "creatorPct", label: "Creator %" },
                  { key: "publisherPct", label: "Publisher %" },
                ] as const).map(({ key, label }) => (
                  <div key={key}>
                    <Label htmlFor={`fee-${key}`} className="text-xs text-muted-foreground">{label}</Label>
                    <Input
                      id={`fee-${key}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={current[key]}
                      onChange={e => setForm({ ...current, [key]: Number(e.target.value) })}
                      className="mt-1"
                      data-testid={`input-${key}`}
                    />
                  </div>
                ))}
              </div>

              {overAllocated && (
                <div className="mt-4 flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-500">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Creator ({current.creatorPct}%) + publisher ({current.publisherPct}%) exceeds the marketplace fee
                    ({current.marketplaceFeePct}%). Payouts will be capped at the fee.
                  </span>
                </div>
              )}

              <div className="mt-4">
                <Button
                  onClick={() => feesMutation.mutate(current)}
                  disabled={feesMutation.isPending}
                  className="gap-2"
                  data-testid="button-save-fees"
                >
                  {feesMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                  Save fees
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Per-affiliate commission overrides */}
      <div>
        <p className="text-sm font-medium mb-3 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" /> Per-affiliate commission overrides
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3 font-medium">Affiliate</th>
                <th className="p-3 font-medium">Connect status</th>
                <th className="p-3 font-medium">Override %</th>
                <th className="p-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {affiliates.map(u => (
                <OverrideRow
                  key={u.id}
                  user={u}
                  saving={overrideMutation.isPending}
                  onSave={(value) => overrideMutation.mutate({ id: u.id, value })}
                />
              ))}
            </tbody>
          </table>
          {affiliates.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No affiliates yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

function OverrideRow({
  user, saving, onSave,
}: { user: AdminUser; saving: boolean; onSave: (value: string | null) => void }) {
  const [value, setValue] = useState<string>(user.commissionRateOverride ?? "");

  return (
    <tr className="border-b hover:bg-muted/50" data-testid={`override-row-${user.id}`}>
      <td className="p-3">
        <div className="font-medium">{user.displayName}</div>
        <div className="text-xs text-muted-foreground">{user.email}</div>
      </td>
      <td className="p-3">
        {user.stripeConnectOnboarded ? (
          <Badge className="bg-green-500/20 text-green-600 border-0">Onboarded</Badge>
        ) : (
          <Badge className="bg-yellow-500/20 text-yellow-600 border-0">Not onboarded</Badge>
        )}
      </td>
      <td className="p-3">
        <Input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={value}
          placeholder="uses default"
          onChange={e => setValue(e.target.value)}
          className="h-8 w-32"
          data-testid={`input-override-${user.id}`}
        />
      </td>
      <td className="p-3">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={saving}
            onClick={() => onSave(value === "" ? null : value)}
            data-testid={`button-save-override-${user.id}`}
          >
            Save
          </Button>
          {value !== "" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={saving}
              onClick={() => { setValue(""); onSave(null); }}
              data-testid={`button-clear-override-${user.id}`}
            >
              Clear
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function AdminPipeline() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [followUpDialog, setFollowUpDialog] = useState<{ open: boolean; entry: PipelineEntry | null }>({ open: false, entry: null });
  const [selectedFollowUp, setSelectedFollowUp] = useState<string>("");
  const [notesValues, setNotesValues] = useState<Record<string, string>>({});
  const [filterStage, setFilterStage] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "videos" | "brands" | "pipeline" | "money">("overview");

  const { data: pipeline = [], isLoading, refetch } = useQuery<PipelineEntry[]>({
    queryKey: ["/api/admin/pipeline"],
    queryFn: () => fetch("/api/admin/pipeline").then(r => {
      if (!r.ok) throw new Error("Not authorised");
      return r.json();
    }),
    retry: false,
  });

  const followUpMutation = useMutation({
    mutationFn: ({ id, followUpType }: { id: string; followUpType: string }) =>
      apiRequest("POST", `/api/admin/pipeline/${id}/follow-up`, { followUpType }),
    onSuccess: (_, { followUpType }) => {
      const opt = FOLLOW_UP_OPTIONS.find(o => o.value === followUpType);
      toast({ title: "Follow-up sent!", description: opt?.label ?? followUpType });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pipeline"] });
      setFollowUpDialog({ open: false, entry: null });
    },
    onError: () => toast({ title: "Failed to send", variant: "destructive" }),
  });

  const notesMutation = useMutation({
    mutationFn: ({ id, adminNotes }: { id: string; adminNotes: string }) =>
      apiRequest("PATCH", `/api/admin/pipeline/${id}`, { adminNotes }),
    onSuccess: () => {
      toast({ title: "Notes saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pipeline"] });
    },
    onError: () => toast({ title: "Failed to save notes", variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Record<string, any> }) =>
      apiRequest("PATCH", `/api/admin/pipeline/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pipeline"] });
      toast({ title: "Updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const filtered = filterStage === "all"
    ? pipeline
    : pipeline.filter(e => {
        if (filterStage === "subscribed") return !!e.brandSubscribedAt;
        if (filterStage === "agreement_signed") return !!e.agreementSignedAt && !e.brandSubscribedAt;
        if (filterStage === "agreement_started") return !!e.agreementStartedAt && !e.agreementSignedAt;
        if (filterStage === "authorized") return (e.status === "authorized" || e.status === "agreement_sent") && !e.agreementStartedAt;
        return e.status === filterStage;
      });

  const stats = {
    total: pipeline.length,
    authorized: pipeline.filter(e => pipelineStage(e) >= 2).length,
    agreementStarted: pipeline.filter(e => pipelineStage(e) === 3).length,
    agreementSigned: pipeline.filter(e => pipelineStage(e) >= 4).length,
    subscribed: pipeline.filter(e => !!e.brandSubscribedAt).length,
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Admin Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">Manage your platform</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 border-b overflow-x-auto">
          {(["overview", "users", "videos", "brands", "pipeline", "money"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              data-testid={`tab-${tab}`}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
                activeTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "money" ? "Money Ops" : tab}
            </button>
          ))}
        </div>

        {activeTab === "overview" && <AdminOverview />}
        {activeTab === "users" && <AdminUsers />}
        {activeTab === "videos" && <AdminVideos />}
        {activeTab === "brands" && <AdminBrands />}
        {activeTab === "money" && <AdminMoneyOps />}
        {activeTab === "pipeline" && (
        <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Brand Outreach Pipeline</h1>
            <p className="text-muted-foreground text-sm mt-1">Sales team view — track and action every brand contact</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
          {[
            { label: "Total Outreach", value: stats.total, icon: Mail, color: "text-blue-600" },
            { label: "Authorised", value: stats.authorized, icon: CheckCircle2, color: "text-amber-600" },
            { label: "Agreement Opened", value: stats.agreementStarted, icon: Clock, color: "text-yellow-600" },
            { label: "Agreement Signed", value: stats.agreementSigned, icon: FileSignature, color: "text-green-600" },
            { label: "Subscribed", value: stats.subscribed, icon: CreditCard, color: "text-emerald-600" },
          ].map(s => (
            <Card key={s.label} className="shadow-none border">
              <CardContent className="p-4">
                <s.icon className={`h-5 w-5 ${s.color} mb-2`} />
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-muted-foreground">Filter:</span>
          {[
            { value: "all", label: "All" },
            { value: "email_sent", label: "Email Sent" },
            { value: "authorized", label: "Authorised" },
            { value: "agreement_started", label: "Agmt Opened" },
            { value: "agreement_signed", label: "Agmt Signed" },
            { value: "subscribed", label: "Subscribed" },
            { value: "declined", label: "Declined" },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setFilterStage(f.value)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                filterStage === f.value
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`filter-${f.value}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Pipeline rows */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>No outreach records yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(entry => {
              const isExpanded = expandedId === entry.id;
              const stage = pipelineStage(entry);

              return (
                <Card key={entry.id} className="shadow-none border overflow-hidden" data-testid={`pipeline-row-${entry.id}`}>
                  {/* Main row */}
                  <div
                    className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <div className="flex items-start gap-4">
                      {/* Stage dots */}
                      <div className="hidden sm:flex flex-col items-center gap-1 mt-1">
                        {[1, 2, 3, 4, 5].map(s => (
                          <div
                            key={s}
                            className={`w-2 h-2 rounded-full ${
                              stage >= s ? "bg-primary" : "bg-border"
                            }`}
                          />
                        ))}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-semibold text-sm truncate">{entry.brandName}</span>
                          {stageBadge(entry)}
                          {entry.followUpCount ? (
                            <Badge variant="outline" className="gap-1 text-xs border-dashed">
                              <Send className="h-2.5 w-2.5" /> {entry.followUpCount} follow-up{entry.followUpCount !== 1 ? "s" : ""}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{entry.prContactName} · {entry.prContactEmail}</span>
                          <span>Creator: {entry.creatorName}</span>
                          {entry.videoTitle && <span>📹 {entry.videoTitle}</span>}
                          {entry.createdAt && <span>Sent {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</span>}
                        </div>
                        {/* Video stats */}
                        {(entry.videoViews > 0 || entry.videoClicks > 0) && (
                          <div className="flex gap-3 mt-1.5">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Eye className="h-3 w-3" /> {entry.videoViews.toLocaleString()} views
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <MousePointerClick className="h-3 w-3" /> {entry.videoClicks.toLocaleString()} clicks
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full gap-1 text-xs h-7"
                          onClick={e => {
                            e.stopPropagation();
                            setFollowUpDialog({ open: true, entry });
                            setSelectedFollowUp("");
                          }}
                          data-testid={`btn-followup-${entry.id}`}
                        >
                          <Zap className="h-3 w-3" /> Follow-up
                        </Button>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t bg-muted/20 p-4 space-y-4">
                      {/* Pipeline progress */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Journey</p>
                        <div className="grid grid-cols-5 gap-2">
                          {[
                            { label: "Email Sent", ts: entry.createdAt, done: stage >= 1 },
                            { label: "Authorised", ts: entry.authorizedAt, done: stage >= 2 },
                            { label: "Agmt Opened", ts: entry.agreementStartedAt, done: stage >= 3 },
                            { label: "Agmt Signed", ts: entry.agreementSignedAt, done: stage >= 4 },
                            { label: "Subscribed", ts: entry.brandSubscribedAt, done: stage >= 5 },
                          ].map((step, i) => (
                            <div key={i} className={`rounded-lg p-2 text-center border ${step.done ? "border-primary/40 bg-primary/10" : "border-border bg-background"}`}>
                              <p className={`text-xs font-medium ${step.done ? "text-primary" : "text-muted-foreground"}`}>{step.label}</p>
                              {step.ts ? (
                                <p className="text-[10px] text-muted-foreground mt-0.5">{format(new Date(step.ts), "d MMM")}</p>
                              ) : (
                                <p className="text-[10px] text-muted-foreground/50 mt-0.5">—</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Manual stage controls */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Mark Progress</p>
                        <div className="flex flex-wrap gap-2">
                          {!entry.agreementStartedAt && stage >= 2 && (
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs gap-1"
                              onClick={() => patchMutation.mutate({ id: entry.id, updates: { agreementStartedAt: new Date().toISOString() } })}
                              data-testid={`btn-agmt-started-${entry.id}`}
                            >
                              <Clock className="h-3 w-3" /> Mark Agreement Opened
                            </Button>
                          )}
                          {!entry.agreementSignedAt && entry.agreementStartedAt && (
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs gap-1"
                              onClick={() => patchMutation.mutate({ id: entry.id, updates: { agreementSignedAt: new Date().toISOString(), status: "completed" } })}
                              data-testid={`btn-agmt-signed-${entry.id}`}
                            >
                              <FileSignature className="h-3 w-3" /> Mark Agreement Signed
                            </Button>
                          )}
                          {!entry.brandSubscribedAt && entry.agreementSignedAt && (
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs gap-1 text-emerald-600 border-emerald-300"
                              onClick={() => patchMutation.mutate({ id: entry.id, updates: { brandSubscribedAt: new Date().toISOString() } })}
                              data-testid={`btn-subscribed-${entry.id}`}
                            >
                              <CreditCard className="h-3 w-3" /> Mark as Subscribed
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Admin notes */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                          <StickyNote className="h-3 w-3" /> Sales Notes
                        </p>
                        <Textarea
                          className="text-sm min-h-[80px] resize-none bg-background"
                          placeholder="Add notes about this lead..."
                          value={notesValues[entry.id] ?? entry.adminNotes ?? ""}
                          onChange={e => setNotesValues(prev => ({ ...prev, [entry.id]: e.target.value }))}
                          data-testid={`notes-${entry.id}`}
                        />
                        <div className="flex justify-end mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={() => notesMutation.mutate({ id: entry.id, adminNotes: notesValues[entry.id] ?? entry.adminNotes ?? "" })}
                            disabled={notesMutation.isPending}
                            data-testid={`btn-save-notes-${entry.id}`}
                          >
                            <StickyNote className="h-3 w-3" /> Save Notes
                          </Button>
                        </div>
                      </div>

                      {/* Last follow-up info */}
                      {entry.lastFollowUpAt && (
                        <p className="text-xs text-muted-foreground">
                          Last follow-up: <strong>{FOLLOW_UP_OPTIONS.find(o => o.value === entry.lastFollowUpType)?.label ?? entry.lastFollowUpType}</strong> — {formatDistanceToNow(new Date(entry.lastFollowUpAt), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Follow-up dialog */}
      <Dialog open={followUpDialog.open} onOpenChange={open => !open && setFollowUpDialog({ open: false, entry: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Follow-up Email</DialogTitle>
            <DialogDescription>
              {followUpDialog.entry && (
                <>To <strong>{followUpDialog.entry.prContactName}</strong> at <strong>{followUpDialog.entry.brandName}</strong></>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {FOLLOW_UP_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSelectedFollowUp(opt.value)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selectedFollowUp === opt.value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                }`}
                data-testid={`followup-option-${opt.value}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <opt.icon className={`h-4 w-4 ${selectedFollowUp === opt.value ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-sm font-semibold">{opt.label}</span>
                </div>
                <p className="text-xs text-muted-foreground pl-6">{opt.desc}</p>
              </button>
            ))}
          </div>

          {/* Stats preview for results_excitement */}
          {selectedFollowUp === "results_excitement" && followUpDialog.entry && (
            <div className="rounded-xl bg-muted/40 p-3 flex gap-6 text-center">
              <div className="flex-1">
                <p className="text-xl font-bold">{followUpDialog.entry.videoViews.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Views</p>
              </div>
              <div className="flex-1">
                <p className="text-xl font-bold">{followUpDialog.entry.videoClicks.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Clicks</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setFollowUpDialog({ open: false, entry: null })}>Cancel</Button>
            <Button
              disabled={!selectedFollowUp || followUpMutation.isPending}
              onClick={() => {
                if (followUpDialog.entry && selectedFollowUp) {
                  followUpMutation.mutate({ id: followUpDialog.entry.id, followUpType: selectedFollowUp });
                }
              }}
              className="gap-2"
              data-testid="btn-send-followup"
            >
              {followUpMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Email
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
