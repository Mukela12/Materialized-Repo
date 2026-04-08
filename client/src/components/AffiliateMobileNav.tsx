import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  ShoppingBag, 
  Video, 
  Bell,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/affiliate", icon: LayoutDashboard, label: "Home" },
  { href: "/affiliate/library", icon: ShoppingBag, label: "Library" },
  { href: "/affiliate/campaigns", icon: Video, label: "Campaigns" },
  { href: "/affiliate/mailbox", icon: Bell, label: "Mailbox" },
  { href: "/affiliate/settings", icon: Settings, label: "Settings" },
];

export function AffiliateMobileNav() {
  const [location] = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border md:hidden safe-area-inset-bottom">
      <div className="flex items-center justify-around py-2">
        {navItems.map((item) => {
          const isActive = location === item.href || 
            (item.href !== "/affiliate" && location.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors",
                isActive
                  ? "text-accent-sage"
                  : "text-muted-foreground"
              )}
              data-testid={`mobile-nav-${item.label.toLowerCase()}`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
