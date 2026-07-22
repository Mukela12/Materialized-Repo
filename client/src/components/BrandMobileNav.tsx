import { Link, useLocation } from "wouter";
import { LayoutDashboard, Package, Users, Bell, Settings } from "lucide-react";
import { useMailboxUnreadCount } from "@/hooks/useMailbox";

const navItems = [
  { path: "/brand", label: "Dashboard", icon: LayoutDashboard },
  { path: "/brand/inventory", label: "Inventory", icon: Package },
  { path: "/brand/campaigns", label: "Campaigns", icon: Users },
  { path: "/brand/mailbox", label: "Mailbox", icon: Bell },
  { path: "/brand/settings", label: "Settings", icon: Settings },
];

export function BrandMobileNav() {
  const [location] = useLocation();
  const { data: unreadCount = 0 } = useMailboxUnreadCount();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-sm z-50 safe-area-bottom">
      <div className="flex items-center justify-around py-2 px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path ||
            (item.path !== "/brand" && location.startsWith(item.path));
          const isMailbox = item.path.endsWith("/mailbox");

          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
              data-testid={`nav-mobile-brand-${item.label.toLowerCase()}`}
            >
              <span className="relative">
                <Icon className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} />
                {isMailbox && unreadCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground leading-none"
                    data-testid="nav-mobile-brand-mailbox-badge"
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
