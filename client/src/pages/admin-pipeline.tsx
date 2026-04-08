import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3 font-medium">Name</th>
            <th className="p-3 font-medium">Email</th>
            <th className="p-3 font-medium">Role</th>
            <th className="p-3 font-medium">Status</th>
            <th className="p-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
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
      {users.length === 0 && (
        <p className="text-center py-8 text-muted-foreground">No users yet</p>
      )}
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3 font-medium">Title</th>
            <th className="p-3 font-medium">Creator</th>
            <th className="p-3 font-medium">Status</th>
            <th className="p-3 font-medium">Views</th>
            <th className="p-3 font-medium">Clicks</th>
            <th className="p-3 font-medium">Revenue</th>
            <th className="p-3 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {videos.map(v => (
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
      {videos.length === 0 && (
        <p className="text-center py-8 text-muted-foreground">No videos uploaded yet</p>
      )}
    </div>
  );
}

interface AdminBrand {
  id: string;
  name: string;
  category: string | null;
  website: string | null;
  isActive: boolean;
}

function AdminBrands() {
  const { data: brands = [] } = useQuery<AdminBrand[]>({
    queryKey: ["/api/admin/brands"],
    queryFn: () => fetch("/api/admin/brands", { credentials: "include" }).then(r => r.json()),
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3 font-medium">Brand</th>
            <th className="p-3 font-medium">Category</th>
            <th className="p-3 font-medium">Website</th>
            <th className="p-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {brands.map(b => (
            <tr key={b.id} className="border-b hover:bg-muted/50">
              <td className="p-3 font-medium">{b.name}</td>
              <td className="p-3 text-muted-foreground">{b.category || "-"}</td>
              <td className="p-3">
                {b.website ? (
                  <a href={b.website.startsWith("http") ? b.website : `https://${b.website}`} target="_blank" rel="noopener noreferrer" className="text-[#677A67] hover:underline text-xs">
                    {b.website}
                  </a>
                ) : "-"}
              </td>
              <td className="p-3">
                <Badge className={b.isActive ? "bg-green-500/20 text-green-600 border-0" : "bg-red-500/20 text-red-600 border-0"}>
                  {b.isActive ? "Active" : "Inactive"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {brands.length === 0 && (
        <p className="text-center py-8 text-muted-foreground">No brands registered yet</p>
      )}
    </div>
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
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "videos" | "brands" | "pipeline">("overview");

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
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">Manage your platform</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 border-b">
          {(["overview", "users", "videos", "brands", "pipeline"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
                activeTab === tab
                  ? "border-[#677A67] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "overview" && <AdminOverview />}
        {activeTab === "users" && <AdminUsers />}
        {activeTab === "videos" && <AdminVideos />}
        {activeTab === "brands" && <AdminBrands />}
        {activeTab === "pipeline" && (
        <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Brand Outreach Pipeline</h1>
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
                              stage >= s ? "bg-[#677A67]" : "bg-border"
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
                            <div key={i} className={`rounded-lg p-2 text-center border ${step.done ? "border-[#677A67]/40 bg-[#677A67]/10" : "border-border bg-background"}`}>
                              <p className={`text-xs font-medium ${step.done ? "text-[#677A67]" : "text-muted-foreground"}`}>{step.label}</p>
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
                    ? "border-[#677A67] bg-[#677A67]/10"
                    : "border-border hover:border-muted-foreground/50"
                }`}
                data-testid={`followup-option-${opt.value}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <opt.icon className={`h-4 w-4 ${selectedFollowUp === opt.value ? "text-[#677A67]" : "text-muted-foreground"}`} />
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
