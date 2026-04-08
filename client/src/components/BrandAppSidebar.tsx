import { Link, useLocation } from "wouter";
import materializedLogo from "@assets/MATERIALIZED_full_logo_1773352270197.png";
import {
  LayoutDashboard,
  Package,
  Users,
  BarChart3,
  HelpCircle,
  Search,
  Settings,
  Target,
  Bell,
  Palette,
  Library,
  ListVideo,
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
  { path: "/brand", label: "Dashboard", icon: LayoutDashboard },
];

const inventoryItems = [
  { path: "/brand/inventory", label: "Product Inventory", icon: Package },
];

const creatorsItems = [
  { path: "/brand/creators", label: "Connect Your Creators", icon: Users },
  { path: "/brand/campaigns", label: "Campaigns", icon: Target },
  { path: "/brand/library", label: "Video Library", icon: Library },
  { path: "/brand/playlists", label: "My Playlists", icon: ListVideo },
  { path: "/brand/wishlist", label: "Wishlist", icon: Heart },
];

const analyticsItems = [
  { path: "/brand/analytics", label: "Analytics", icon: BarChart3 },
];

const brandingItems = [
  { path: "/brand/brand-kit", label: "Brand Kit", icon: Palette },
];

const communicationItems = [
  { path: "/brand/mailbox", label: "Mailbox", icon: Bell },
];

const otherItems = [
  { path: "/brand/settings", label: "Settings", icon: Settings },
  { path: "/brand/help", label: "Help Center", icon: HelpCircle },
];

interface BrandAppSidebarProps {
  user?: {
    displayName: string;
    username: string;
    email?: string;
    avatarUrl?: string;
    role: string;
    isAdmin?: boolean;
  };
}

export function BrandAppSidebar({ user }: BrandAppSidebarProps) {
  const [location] = useLocation();
  const logoutMutation = useLogout();

  const renderItems = (items: typeof overviewItems) => (
    <SidebarMenu>
      {items.map((item) => {
        const isActive = location === item.path || 
          (item.path !== "/brand" && location.startsWith(item.path));
        const Icon = item.icon;

        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link href={item.path} data-testid={`nav-brand-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
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
      <SidebarHeader className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-center mb-5">
          <img
            src={materializedLogo}
            alt="Materialized"
            style={{ height: 200, width: "auto", filter: "invert(1)" }}
          />
        </div>

        <div className="flex items-center gap-3 p-3 rounded-xl bg-sidebar-accent/50">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={user?.avatarUrl} />
            <AvatarFallback className="bg-primary/20 text-primary text-sm">
              {user?.displayName?.charAt(0) || "B"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate leading-tight">
              {user?.displayName || "Brand"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.email || user?.username || ""}
            </p>
          </div>
          <Badge className="shrink-0 bg-chart-2 hover:bg-chart-2/90 text-[10px] px-2 py-0.5">
            Brand
          </Badge>
        </div>

        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search menu..."
            className="pl-9 h-10 rounded-lg bg-sidebar-accent/30"
            data-testid="input-search-brand-menu"
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
            Products
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(inventoryItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Creator Network
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(creatorsItems)}
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
            Branding
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderItems(brandingItems)}
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
            Settings
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
