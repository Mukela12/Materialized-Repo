import { Switch, Route, useLocation } from "wouter";
import materializedLogo from "@assets/MATERIALIZED_full_logo_1773352270197.png";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AppSidebar } from "@/components/AppSidebar";
import { BrandAppSidebar } from "@/components/BrandAppSidebar";
import { AffiliateAppSidebar } from "@/components/AffiliateAppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { BrandMobileNav } from "@/components/BrandMobileNav";
import { AffiliateMobileNav } from "@/components/AffiliateMobileNav";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import MyVideos from "@/pages/my-videos";
import Library from "@/pages/library";
import Analytics from "@/pages/analytics";
import CRMAnalytics from "@/pages/crm";
import Referrals from "@/pages/referrals";
import Help from "@/pages/help";
import More from "@/pages/more";
import BrandDashboard from "@/pages/brand-dashboard";
import BrandInventory from "@/pages/brand-inventory";
import BrandCreators from "@/pages/brand-creators";
import BrandCampaigns from "@/pages/brand-campaigns";
import BrandCampaignDetail from "@/pages/brand-campaign-detail";
import BrandKit from "@/pages/brand-kit";
import AffiliateLibrary from "@/pages/affiliate-library";
import BrandLibrary from "@/pages/brand-library";
import PlaylistsPage from "@/pages/playlists";
import AffiliateCampaigns from "@/pages/affiliate-campaigns";
import AffiliateSettings from "@/pages/affiliate-settings";
import AffiliateDashboard from "@/pages/affiliate-dashboard";
import Affiliates from "@/pages/affiliates";
import Landing from "@/pages/landing";
import Rewards from "@/pages/rewards";
import Profile from "@/pages/profile";
import BrandAuthorize from "@/pages/brand-authorize";
import AdminPipeline from "@/pages/admin-pipeline";
import BrandSettingsSubscription from "@/pages/brand-settings-subscription";
import CreatorSettingsSubscription from "@/pages/creator-settings-subscription";
import BrandSettingsBillingHistory from "@/pages/brand-settings-billing-history";
import BrandSettingsTransactions from "@/pages/brand-settings-transactions";
import BrandSettingsPayout from "@/pages/brand-settings-payout";
import BrandSettingsBillingAddress from "@/pages/brand-settings-billing-address";
import BrandSettingsApiKey from "@/pages/brand-settings-api-key";
import Mailbox from "@/pages/mailbox";
import WishlistPage from "@/pages/wishlist";
import Login from "@/pages/login";
import Register from "@/pages/register";
import VerifyEmail from "@/pages/verify-email";
import { useCurrentUser, useLogout } from "@/hooks/useCurrentUser";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, LogOut, User, Layers } from "lucide-react";

function CreatorRouter() {
  return (
    <Switch>
      <Route path="/creator" component={Dashboard} />
      <Route path="/creator/my-videos" component={MyVideos} />
      <Route path="/creator/library" component={Library} />
      <Route path="/creator/playlists" component={PlaylistsPage} />
      <Route path="/creator/wishlist" component={WishlistPage} />
      <Route path="/creator/analytics" component={Analytics} />
      <Route path="/creator/crm" component={CRMAnalytics} />
      <Route path="/creator/affiliates" component={Affiliates} />
      <Route path="/creator/referrals" component={Referrals} />
      <Route path="/creator/brand-kit" component={BrandKit} />
      <Route path="/creator/rewards" component={Rewards} />
      <Route path="/creator/profile" component={Profile} />
      <Route path="/creator/help" component={Help} />
      <Route path="/creator/mailbox" component={Mailbox} />
      <Route path="/creator/more" component={More} />
      <Route path="/creator/settings/subscription" component={CreatorSettingsSubscription} />
      <Route component={NotFound} />
    </Switch>
  );
}

function BrandRouter() {
  return (
    <Switch>
      <Route path="/brand" component={BrandDashboard} />
      <Route path="/brand/inventory" component={BrandInventory} />
      <Route path="/brand/creators" component={BrandCreators} />
      <Route path="/brand/analytics" component={Analytics} />
      <Route path="/brand/campaigns/:id" component={BrandCampaignDetail} />
      <Route path="/brand/campaigns" component={BrandCampaigns} />
      <Route path="/brand/profile" component={Profile} />
      <Route path="/brand/settings" component={More} />
      <Route path="/brand/settings/subscription" component={BrandSettingsSubscription} />
      <Route path="/brand/settings/billing-history" component={BrandSettingsBillingHistory} />
      <Route path="/brand/settings/transactions" component={BrandSettingsTransactions} />
      <Route path="/brand/settings/payout" component={BrandSettingsPayout} />
      <Route path="/brand/settings/billing-address" component={BrandSettingsBillingAddress} />
      <Route path="/brand/settings/api-key" component={BrandSettingsApiKey} />
      <Route path="/brand/library" component={BrandLibrary} />
      <Route path="/brand/playlists" component={PlaylistsPage} />
      <Route path="/brand/wishlist" component={WishlistPage} />
      <Route path="/brand/brand-kit" component={BrandKit} />
      <Route path="/brand/mailbox" component={Mailbox} />
      <Route path="/brand/help" component={Help} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AffiliateRouter() {
  return (
    <Switch>
      <Route path="/affiliate" component={AffiliateDashboard} />
      <Route path="/affiliate/library" component={AffiliateLibrary} />
      <Route path="/affiliate/campaigns" component={AffiliateCampaigns} />
      <Route path="/affiliate/analytics" component={Analytics} />
      <Route path="/affiliate/settings" component={AffiliateSettings} />
      <Route path="/affiliate/playlists" component={PlaylistsPage} />
      <Route path="/affiliate/wishlist" component={WishlistPage} />
      <Route path="/affiliate/brand-kit" component={BrandKit} />
      <Route path="/affiliate/mailbox" component={Mailbox} />
      <Route path="/affiliate/help" component={Help} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  const [location] = useLocation();
  const isBrandRoute = location.startsWith("/brand") && !location.startsWith("/brand-authorize");
  const isAffiliateRoute = location.startsWith("/affiliate");
  const isCreatorRoute = location.startsWith("/creator");
  const isLandingRoute = location === "/";
  const isAuthorizeRoute = location.startsWith("/brand-authorize");

  if (isLandingRoute) return <Landing />;
  if (isAuthorizeRoute) {
    return (
      <Switch>
        <Route path="/brand-authorize/:token" component={BrandAuthorize} />
      </Switch>
    );
  }
  if (isBrandRoute) return <BrandRouter />;
  if (isAffiliateRoute) return <AffiliateRouter />;
  if (isCreatorRoute) return <CreatorRouter />;
  return <CreatorRouter />;
}

function AdminPortalSwitcher() {
  const [, navigate] = useLocation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" data-testid="button-admin-portal-switcher">
          <Layers className="h-3.5 w-3.5" />
          Switch Portal
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => navigate("/creator")} data-testid="menu-portal-creator">
          Creator Portal
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/brand")} data-testid="menu-portal-brand">
          Brand Portal
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/affiliate")} data-testid="menu-portal-publisher">
          Publisher Portal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && user === null) {
      navigate("/login");
    }
  }, [isLoading, user, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}

function AppContent() {
  const [location] = useLocation();
  const { data: user } = useCurrentUser();
  const logoutMutation = useLogout();

  const isBrandRoute = location.startsWith("/brand") && !location.startsWith("/brand-authorize");
  const isAffiliateRoute = location.startsWith("/affiliate");
  const isLandingRoute = location === "/";
  const isAuthorizeRoute = location.startsWith("/brand-authorize");
  const isAdminRoute = location.startsWith("/admin");
  const isAuthRoute = location === "/login" || location === "/register" || location.startsWith("/verify-email");

  if (isAuthRoute) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/verify-email/:token" component={VerifyEmail} />
      </Switch>
    );
  }

  if (isAuthorizeRoute) {
    return (
      <Switch>
        <Route path="/brand-authorize/:token" component={BrandAuthorize} />
      </Switch>
    );
  }

  if (isAdminRoute) {
    return (
      <Switch>
        <Route path="/admin" component={AdminPipeline} />
      </Switch>
    );
  }

  if (isLandingRoute) return <Landing />;

  const getSidebar = () => {
    if (isBrandRoute) return <BrandAppSidebar user={user ?? undefined} />;
    if (isAffiliateRoute) return <AffiliateAppSidebar user={user ?? undefined} />;
    return <AppSidebar user={user ?? undefined} />;
  };

  const getMobileNav = () => {
    if (isBrandRoute) return <BrandMobileNav />;
    if (isAffiliateRoute) return <AffiliateMobileNav />;
    return <MobileNav />;
  };

  return (
    <AuthGuard>
      <div className="flex h-screen w-full">
        <div className="hidden md:block">
          {getSidebar()}
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-4 p-4 border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="hidden md:flex" data-testid="button-sidebar-toggle" />
              <img
                src={materializedLogo}
                alt="Materialized"
                className="md:hidden"
                style={{ height: 32, width: "auto" }}
              />
            </div>
            <div className="flex items-center gap-2">
              {user?.isAdmin && <AdminPortalSwitcher />}
              <ThemeToggle />
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1 h-8" data-testid="button-user-menu">
                      <User className="h-4 w-4" />
                      <span className="hidden sm:inline text-xs max-w-24 truncate">{user.displayName}</span>
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <div className="px-2 py-1.5">
                      <p className="text-xs font-medium truncate">{user.displayName}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => logoutMutation.mutate()}
                      className="text-destructive focus:text-destructive"
                      data-testid="button-logout"
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6 bg-background">
            <Router />
          </main>
        </div>
      </div>
      {getMobileNav()}
    </AuthGuard>
  );
}

function AppWithSidebar() {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <AppContent />
    </SidebarProvider>
  );
}

function App() {
  const [location] = useLocation();
  const isLandingRoute = location === "/";
  const isAuthRoute = location === "/login" || location === "/register" || location.startsWith("/verify-email");

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          {(isLandingRoute || isAuthRoute) ? (
            <Switch>
              <Route path="/" component={Landing} />
              <Route path="/login" component={Login} />
              <Route path="/register" component={Register} />
              <Route path="/verify-email/:token" component={VerifyEmail} />
            </Switch>
          ) : (
            <AppWithSidebar />
          )}
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
