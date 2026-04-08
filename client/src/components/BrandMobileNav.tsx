import { Link, useLocation } from "wouter";
import { LayoutDashboard, Package, Users, Bell, Settings } from "lucide-react";

const navItems = [
  { path: "/brand", label: "Dashboard", icon: LayoutDashboard },
  { path: "/brand/inventory", label: "Inventory", icon: Package },
  { path: "/brand/campaigns", label: "Campaigns", icon: Users },
  { path: "/brand/mailbox", label: "Mailbox", icon: Bell },
  { path: "/brand/settings", label: "Settings", icon: Settings },
];

export function BrandMobileNav() {
  const [location] = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-sm z-50 safe-area-bottom">
      <div className="flex items-center justify-around py-2 px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path || 
            (item.path !== "/brand" && location.startsWith(item.path));

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
              <Icon className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
