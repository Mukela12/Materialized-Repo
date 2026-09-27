/**
 * The phone navigation: a floating glass dock instead of a bar glued to the
 * screen edge (recipe shared by Levy and DegreeDesk).
 *
 *  - Four destinations in one pill; the fifth (More / Settings) sits beside it
 *    as its own round button.
 *  - The active tab's highlight SLIDES between tabs on a critically damped
 *    spring (no overshoot), and snaps instantly under reduced motion.
 *  - It steps aside while the on-screen keyboard is open, so it never covers
 *    the field being typed in.
 *  - It floats clear of the home indicator (safe-area inset).
 *  - Links are real <a> elements (the old navs nested a <button> in a link).
 */
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { useMailboxUnreadCount } from "@/hooks/useMailbox";

export interface DockItem { path: string; label: string; icon: LucideIcon }

const SPRING = { type: "spring" as const, mass: 0.6, stiffness: 420, damping: 34 };

/** html[data-keyboard="open"] while an editable field has focus on a touch device. */
function useKeyboardAwareness() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const root = document.documentElement;
    const editable = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onIn = (e: FocusEvent) => { if (editable(e.target)) { clearTimeout(timer); root.dataset.keyboard = "open"; } };
    const onOut = () => { timer = setTimeout(() => { if (!editable(document.activeElement)) delete root.dataset.keyboard; }, 120); };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => { document.removeEventListener("focusin", onIn); document.removeEventListener("focusout", onOut); clearTimeout(timer); };
  }, []);
}

export function FloatingDock({ items, overflow, home, overflowIsCatchAll = false }: {
  /** The four destinations inside the pill. */
  items: DockItem[];
  /** The round button beside the pill (More or Settings). */
  overflow: DockItem;
  /** The portal root, matched exactly so it is not "active" on every page. */
  home: string;
  /** Light the overflow button when the current page is not in the pill (for "More"). */
  overflowIsCatchAll?: boolean;
}) {
  const [location] = useLocation();
  const reduced = useReducedMotion();
  const { data: unread = 0 } = useMailboxUnreadCount();
  useKeyboardAwareness();

  const matches = (path: string) =>
    path === home ? location === home : location === path || location.startsWith(path + "/");
  const activeIndex = items.findIndex((i) => matches(i.path));
  const overflowActive = matches(overflow.path) || (overflowIsCatchAll && activeIndex === -1);
  const OverflowIcon = overflow.icon;

  return (
    <nav className="mz-dock md:hidden" aria-label="Main">
      <div className="mz-dock-surface">
        {items.map((item, i) => {
          const Icon = item.icon;
          const active = i === activeIndex;
          const isMailbox = item.path.endsWith("/mailbox");
          return (
            <Link
              key={item.path}
              href={item.path}
              className="mz-dock-item"
              aria-current={active ? "page" : undefined}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              {active && (
                <motion.span
                  layoutId="mz-dock-selection"
                  className="mz-dock-selection"
                  transition={reduced ? { duration: 0 } : SPRING}
                  aria-hidden="true"
                />
              )}
              <span className="relative">
                <Icon className="h-[19px] w-[19px]" strokeWidth={1.85} />
                {isMailbox && unread > 0 && (
                  <span className="mz-dock-badge" data-testid="nav-mailbox-badge">{unread > 9 ? "9+" : unread}</span>
                )}
              </span>
              <span className="mz-dock-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
      <Link
        href={overflow.path}
        className="mz-dock-more"
        aria-current={overflowActive ? "page" : undefined}
        aria-label={overflow.label}
        data-testid={`nav-${overflow.label.toLowerCase()}`}
      >
        <OverflowIcon className="h-5 w-5" strokeWidth={1.85} />
        <span className="mz-dock-label">{overflow.label}</span>
      </Link>
    </nav>
  );
}
