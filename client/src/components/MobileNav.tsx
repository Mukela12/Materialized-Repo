import { Link, useLocation } from "wouter";
import { LayoutDashboard, Video, Library, Bell, MoreHorizontal } from "lucide-react";
import { useMailboxUnreadCount } from "@/hooks/useMailbox";

const navItems = [
  { path: "/creator", label: "Dashboard", icon: LayoutDashboard },
  { path: "/creator/my-videos", label: "Campaigns", icon: Video },
  { path: "/creator/library", label: "Library", icon: Library },
  { path: "/creator/mailbox", label: "Mailbox", icon: Bell },
  { path: "/creator/more", label: "More", icon: MoreHorizontal },
];

export function MobileNav() {
  const [location] = useLocation();
  const { data: unreadCount = 0 } = useMailboxUnreadCount();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border rounded-t-3xl pb-safe md:hidden">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const isActive = location === item.path ||
            (item.path !== "/creator" && location.startsWith(item.path));
          const Icon = item.icon;
          const isMailbox = item.path.endsWith("/mailbox");

          return (
            <Link key={item.path} href={item.path}>
              <button
                className={`flex flex-col items-center justify-center w-16 h-14 rounded-2xl transition-all duration-200 active:scale-95 ${
                  isActive
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground"
                }`}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5 mb-1" />
                  {isMailbox && unreadCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground leading-none"
                      data-testid="nav-mailbox-badge"
                    >
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </span>
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
