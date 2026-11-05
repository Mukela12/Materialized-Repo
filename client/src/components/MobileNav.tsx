import { LayoutDashboard, Video, BarChart3, Bell, MoreHorizontal } from "lucide-react";
import { FloatingDock } from "./FloatingDock";

export function MobileNav() {
  return (
    <FloatingDock
      home="/creator"
      items={[
        { path: "/creator", label: "Home", icon: LayoutDashboard },
        { path: "/creator/my-videos", label: "Campaigns", icon: Video },
        { path: "/creator/analytics", label: "Analytics", icon: BarChart3 },
        { path: "/creator/mailbox", label: "Mailbox", icon: Bell },
      ]}
      overflow={{ path: "/creator/more", label: "More", icon: MoreHorizontal }}
      overflowIsCatchAll
    />
  );
}
