import { useState } from "react";
import { Link, useLocation } from "wouter";
import materializedLogo from "@assets/MTRLZD_Logo_white_transparent.png";
import {
  LayoutDashboard,
  Video,
  Library,
  ListVideo,
  BarChart3,
  Users,
  HelpCircle,
  Search,
  Send,
  Palette,
  UserPlus,
  Wallet,
  UserCircle,
  Bell,
  Heart,
  LogOut,
} from "lucide-react";
import { useLogout } from "@/hooks/useCurrentUser";
import { useMailboxUnreadCount } from "@/hooks/useMailbox";
import { useTokenBalance, tokenLabel } from "@/hooks/useWallet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const overviewItems = [
  { path: "/creator", label: "Dashboard", icon: LayoutDashboard },
];

const contentItems = [
  { path: "/creator/my-videos", label: "My Campaigns", icon: Video },
  { path: "/creator/library", label: "Global Video Library", icon: Library },
  { path: "/creator/playlists", label: "My Playlists", icon: ListVideo },
  { path: "/creator/wishlist", label: "Wishlist", icon: Heart },
];

const analyticsItems = [
  { path: "/creator/analytics", label: "Analytics", icon: BarChart3 },
  { path: "/creator/crm", label: "CRM Analytics", icon: Users },
];

// Client's review: "Move Brand Referrals to this section and delete from
// Branding" — so My Brand Partners lives under Affiliates now, and Branding is
// just the carousel styling it actually is.
const affiliateItems = [
  { path: "/creator/affiliates", label: "Manage Affiliates", icon: UserPlus },
  { path: "/creator/referrals", label: "My Brand Partners", icon: Send },
];

const brandItems = [
  { path: "/creator/brand-kit", label: "Product Carousel Styling", icon: Palette },
];

// One credit surface only. This used to point at /creator/rewards, which rendered
// the retired `creator_rewards` table; the wallet now owns it and that path still
// resolves to the same page for anyone holding an old link.
const walletItems = [
  { path: "/creator/wallet", label: "Token Wallet", icon: Wallet },
];

const accountItems = [
  { path: "/creator/profile", label: "Personal Details", icon: UserCircle },
];

const communicationItems = [
  { path: "/creator/mailbox", label: "Mailbox", icon: Bell },
];

const otherItems = [
  { path: "/creator/help", label: "Help Center", icon: HelpCircle },
];

interface AppSidebarProps {
  user?: {
    displayName: string;
    username: string;
    email?: string;
    avatarUrl?: string;
    role: string;
    isAdmin?: boolean;
  };
}

export function AppSidebar({ user }: AppSidebarProps) {
  const logoutMutation = useLogout();
  const [location] = useLocation();
  const { data: unreadCount = 0 } = useMailboxUnreadCount();
  const { balance: tokenBalance } = useTokenBalance();

  const [menuQuery, setMenuQuery] = useState("");

  /**
   * Filter nav items by the sidebar search box.
   *
   * That input had a placeholder and an icon but no value and no onChange —
   * typing in it did nothing. It appears in every screenshot the client sent,
   * with the word "editor" typed into it, so she had tried to use it.
   *
   * Returning [] for a group that matches nothing lets renderGroup hide the
   * group heading too, rather than leaving a bare label over an empty list.
   */
  const filterItems = <T extends { label: string }>(items: T[]): T[] => {
    const q = menuQuery.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  };

  const renderItems = (items: typeof overviewItems) => (
    <SidebarMenu>
      {items.map((item) => {
        const isActive = location === item.path ||
          (item.path !== "/creator" && location.startsWith(item.path));
        const Icon = item.icon;
        const isMailbox = item.path.endsWith("/mailbox");
        const isWallet = item.path.endsWith("/wallet");

        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link href={item.path}>
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                {isMailbox && unreadCount > 0 && (
                  <Badge className="ml-auto h-5 min-w-5 justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground border-0">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Badge>
                )}
                {isWallet && tokenBalance > 0 && (
                  <Badge
                    className="ml-auto h-5 min-w-5 justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground border-0"
                    title={`${tokenLabel(tokenBalance)} of account credit`}
                    data-testid="badge-sidebar-token-balance"
                  >
                    {tokenBalance > 99 ? "99+" : tokenBalance}
                  </Badge>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3 mb-4">
          <img
            src={materializedLogo}
            alt="Materialized"
            className="invert dark:invert-0"
            style={{ height: 40, width: "auto" }}
          />
        </div>
        
        <div className="flex items-center gap-3 p-3 rounded-xl bg-sidebar-accent/50">
          <Avatar className="h-10 w-10">
            <AvatarImage src={user?.avatarUrl} />
            <AvatarFallback className="bg-primary/20 text-primary">
              {user?.displayName?.charAt(0) || "C"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user?.displayName || "Creator"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.email || user?.username || ""}
            </p>
          </div>
        </div>
        
        <Badge className="mt-3 w-fit" variant="default">
          Creator
        </Badge>
        
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search menu..."
            className="pl-9 h-10 rounded-lg bg-sidebar-accent/30"
            data-testid="input-search-menu"
            value={menuQuery}
            onChange={(e) => setMenuQuery(e.target.value)}
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {filterItems(overviewItems).length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Overview
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(filterItems(overviewItems))}
          </SidebarGroupContent>
        </SidebarGroup>
        )}

        {filterItems(contentItems).length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Content Management
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(filterItems(contentItems))}
          </SidebarGroupContent>
        </SidebarGroup>
        )}

        {filterItems(analyticsItems).length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Analytics & Insights
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(filterItems(analyticsItems))}
          </SidebarGroupContent>
        </SidebarGroup>
        )}

        {filterItems(affiliateItems).length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Affiliates
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(filterItems(affiliateItems))}
          </SidebarGroupContent>
        </SidebarGroup>
        )}

        {filterItems(brandItems).length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Styling
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(filterItems(brandItems))}
          </SidebarGroupContent>
        </SidebarGroup>
        )}

        {filterItems(walletItems).length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Wallet
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(filterItems(walletItems))}
          </SidebarGroupContent>
        </SidebarGroup>
        )}

        {filterItems(communicationItems).length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Communication
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(filterItems(communicationItems))}
          </SidebarGroupContent>
        </SidebarGroup>
        )}

        {filterItems(accountItems).length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Account
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(filterItems(accountItems))}
          </SidebarGroupContent>
        </SidebarGroup>
        )}

        {filterItems(otherItems).length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Support
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(filterItems(otherItems))}
          </SidebarGroupContent>
        </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => logoutMutation.mutate()}
              className="text-muted-foreground hover:text-destructive w-full"
              data-testid="button-sidebar-logout"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
