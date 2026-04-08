import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { User } from "@shared/schema";
import {
  UserPen,
  CalendarDays,
  Receipt,
  ArrowLeftRight,
  Wallet,
  Building2,
  KeyRound,
  LogOut,
  ChevronRight,
} from "lucide-react";

// ─── Role-based menu sections ─────────────────────────────────────────────────
function buildSections(role: string) {
  const isBrand   = role === "brand";
  const isCreator = role === "creator";
  const base      = isBrand ? "/brand" : isCreator ? "/creator" : "/affiliate";

  const profile = [
    { label: "Edit Profile", icon: UserPen, path: `${base}/profile` },
  ];

  const billing = isBrand
    ? [
        { label: "Subscription Information",   icon: CalendarDays,   path: "/brand/settings/subscription" },
        { label: "Billing History",            icon: Receipt,        path: "/brand/settings/billing-history" },
        { label: "Transaction History",        icon: ArrowLeftRight, path: "/brand/settings/transactions" },
        { label: "Payout Method",             icon: Wallet,         path: "/brand/settings/payout" },
        { label: "Billing Address & Business", icon: Building2,      path: "/brand/settings/billing-address" },
      ]
    : isCreator
    ? [
        { label: "Subscription & Billing", icon: CalendarDays, path: "/creator/settings/subscription" },
      ]
    : [];

  const developer = isBrand
    ? [{ label: "API Key", icon: KeyRound, path: "/brand/settings/api-key" }]
    : [];

  return { profile, billing, developer };
}
// ─────────────────────────────────────────────────────────────────────────────

function getInitials(name?: string): string {
  if (!name) return "B";
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function MenuRow({
  label,
  icon: Icon,
  path,
  testId,
  last = false,
}: {
  label: string;
  icon: React.ElementType;
  path: string;
  testId: string;
  last?: boolean;
}) {
  return (
    <Link href={path}>
      <div
        className={`flex items-center gap-4 px-4 py-3.5 hover-elevate cursor-pointer ${
          !last ? "border-b border-border" : ""
        }`}
        data-testid={testId}
      >
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <span className="flex-1 text-sm font-medium">{label}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}

export default function More() {
  const [, navigate] = useLocation();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/users/me"],
  });

  const role        = user?.role ?? "brand";
  const { profile: profileSection, billing: billingSection, developer: developerSection } = buildSections(role);
  const displayName = user?.displayName || (role === "creator" ? "Demo Creator" : "Demo Brand");
  const username    = user?.username    || `${role}-account`;
  const initials    = getInitials(displayName);

  return (
    <div className="space-y-6 pb-24 md:pb-6 max-w-2xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" data-testid="text-settings-title">
          Profile &amp; Settings
        </h1>
        <p className="text-muted-foreground mt-1">Manage your account, billing, and developer access</p>
      </div>

      {/* ── Profile card ── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user?.avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-xl" data-testid="text-avatar-initials">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg leading-tight truncate" data-testid="text-display-name">
                {displayName}
              </h3>
              <p className="text-sm text-muted-foreground truncate" data-testid="text-username">
                {username}
              </p>
              <Badge className="mt-2 bg-chart-2 hover:bg-chart-2/90 capitalize" data-testid="badge-role">
                {role}
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full shrink-0"
              onClick={() => navigate(profileSection[0]?.path ?? `/${role}/profile`)}
              data-testid="button-edit-profile"
            >
              Edit Profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Profile section ── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-1">
          <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          {profileSection.map((item, i) => (
            <MenuRow
              key={item.path}
              label={item.label}
              icon={item.icon}
              path={item.path}
              testId={`link-profile-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              last={i === profileSection.length - 1}
            />
          ))}
        </CardContent>
      </Card>

      {/* ── Billing & Subscription section ── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-1">
          <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
            Billing &amp; Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          {billingSection.map((item, i) => (
            <MenuRow
              key={item.path}
              label={item.label}
              icon={item.icon}
              path={item.path}
              testId={`link-billing-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              last={i === billingSection.length - 1}
            />
          ))}
        </CardContent>
      </Card>

      {/* ── Developer section (brand only) ── */}
      {developerSection.length > 0 && (
        <Card>
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
              Developer
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-1">
            {developerSection.map((item, i) => (
              <MenuRow
                key={item.path}
                label={item.label}
                icon={item.icon}
                path={item.path}
                testId={`link-dev-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                last={i === developerSection.length - 1}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Sign out ── */}
      <Button
        variant="outline"
        className="w-full gap-2 text-destructive hover:text-destructive"
        data-testid="button-sign-out"
      >
        <LogOut className="h-4 w-4" />
        Sign Out
      </Button>

      <p className="text-center text-xs text-muted-foreground" data-testid="text-footer-version">
        Materialized Video Commerce Platform v1.0.0
      </p>
    </div>
  );
}
