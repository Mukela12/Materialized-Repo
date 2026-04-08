import { Link, useLocation } from "wouter";
import materializedLogo from "@assets/MATERIALIZED_full_logo_1773352270197.png";
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
  Gift,
  UserCircle,
  Bell,
  Heart,
  LogOut,
} from "lucide-react";
import { useLogout } from "@/hooks/useCurrentUser";
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

const affiliateItems = [
  { path: "/creator/affiliates", label: "Manage Affiliates", icon: UserPlus },
];

const brandItems = [
  { path: "/creator/brand-kit", label: "Brand Kit", icon: Palette },
  { path: "/creator/referrals", label: "Brand Referrals", icon: Send },
];

const rewardsItems = [
  { path: "/creator/rewards", label: "My Rewards", icon: Gift },
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

  const renderItems = (items: typeof overviewItems) => (
    <SidebarMenu>
      {items.map((item) => {
        const isActive = location === item.path || 
          (item.path !== "/creator" && location.startsWith(item.path));
        const Icon = item.icon;

        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link href={item.path}>
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
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
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Overview
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(overviewItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Content Management
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(contentItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Analytics & Insights
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(analyticsItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Affiliates
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(affiliateItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Branding
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(brandItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Rewards
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(rewardsItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Communication
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(communicationItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Account
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(accountItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Support
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(otherItems)}
          </SidebarGroupContent>
        </SidebarGroup>
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
