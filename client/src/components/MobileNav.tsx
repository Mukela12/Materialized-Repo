import { LayoutDashboard, Video, Library, Bell, MoreHorizontal } from "lucide-react";
import { FloatingDock } from "./FloatingDock";

export function MobileNav() {
  return (
    <FloatingDock
      home="/creator"
      items={[
        { path: "/creator", label: "Home", icon: LayoutDashboard },
        { path: "/creator/my-videos", label: "Campaigns", icon: Video },
        { path: "/creator/library", label: "Library", icon: Library },
        { path: "/creator/mailbox", label: "Mailbox", icon: Bell },
      ]}
      overflow={{ path: "/creator/more", label: "More", icon: MoreHorizontal }}
      overflowIsCatchAll
    />
  );
}
