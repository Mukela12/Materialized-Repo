/**
 * A short spotlight tour for brand-new accounts (the 14-day-trial signups),
 * shown once, on the portal home, never to admins or long-standing accounts.
 *
 * Each step lists CANDIDATE targets; the first one actually on screen wins,
 * and a step with nothing visible is skipped. That is what lets one script
 * point at the sidebar link on a desktop and the bottom-nav link on a phone.
 * Replayable from the Cmd-K palette ("Take the tour").
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import type { CurrentUser } from "@/hooks/useCurrentUser";

type Portal = "creator" | "brand" | "affiliate";
interface Step { targets: string[]; title: string; body: string }

const STEPS: Record<Portal, Step[]> = {
  creator: [
    { targets: ['[data-testid="button-upload-video"]'], title: "Start with a video",
      body: "Upload a video and tag the products in it. Viewers shop what they see without leaving the video." },
    { targets: ['[data-sidebar="sidebar"] a[href="/creator/my-videos"]', 'nav a[href="/creator/my-videos"]'], title: "Your campaigns",
      body: "Every video you publish lives here, with its products, embed code and results." },
    { targets: ['[data-sidebar="sidebar"] a[href="/creator/referrals"]'], title: "Refer brands, earn tokens",
      body: "Introduce a brand you work with. When it subscribes, you earn credit toward your own fees." },
    { targets: ['[data-testid="button-command-palette"]'], title: "Jump anywhere",
      body: "Press ⌘K, or tap here, and type where you want to go." },
  ],
  brand: [
    { targets: ['[data-sidebar="sidebar"] a[href="/brand/inventory"]', 'nav a[href="/brand/inventory"]'], title: "Bring in your products",
      body: "Connect your Shopify or WooCommerce store, or add products by hand. They become shoppable in creator videos." },
    { targets: ['[data-sidebar="sidebar"] a[href="/brand/creators"]', 'nav a[href="/brand/campaigns"]'], title: "Invite your creators",
      body: "Invite the creators who already feature your products. Their videos become your storefront." },
    { targets: ['[data-sidebar="sidebar"] a[href="/brand/analytics"]'], title: "See what sells",
      body: "Views, clicks and sales, traced back to the video and creator that drove them." },
    { targets: ['[data-testid="button-command-palette"]'], title: "Jump anywhere",
      body: "Press ⌘K, or tap here, and type where you want to go." },
  ],
  affiliate: [
    { targets: ['[data-sidebar="sidebar"] a[href="/affiliate/library"]', 'nav a[href="/affiliate/library"]'], title: "Find videos to repost",
      body: "Browse shoppable creator videos and license the ones that fit your site." },
    { targets: ['[data-testid="banner-payout-nudge"]', '[data-sidebar="sidebar"] a[href="/affiliate/settings"]'], title: "Get paid",
      body: "Connect a payout account so commissions from every sale reach your bank automatically." },
    { targets: ['[data-testid="button-command-palette"]'], title: "Jump anywhere",
      body: "Press ⌘K, or tap here, and type where you want to go." },
  ],
};

export const START_TOUR_EVENT = "mtrlzd:start-tour";
const NEW_ACCOUNT_DAYS = 14;
const storageKey = (userId: string) => `mtrlzd-tour-v1-${userId}`;

function visibleTarget(step: Step): HTMLElement | null {
  for (const sel of step.targets) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width > 0 && r.height > 0 && cs.visibility !== "hidden") return el;
  }
  return null;
}

export function FirstRunTour({ portal, user }: { portal: Portal; user: CurrentUser | null | undefined }) {
  const [location] = useLocation();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const steps = STEPS[portal];

  const finish = useCallback(() => {
    setActive(false);
    if (user?.id) try { localStorage.setItem(storageKey(user.id), "done"); } catch { /* private mode */ }
  }, [user?.id]);

  // Auto-offer once, to new non-admin accounts, on the portal home.
  useEffect(() => {
    if (!user?.id || user.isAdmin || !user.createdAt) return;
    if (location !== `/${portal}`) return;
    const ageDays = (Date.now() - new Date(user.createdAt).getTime()) / 86_400_000;
    if (!(ageDays <= NEW_ACCOUNT_DAYS)) return;
    try { if (localStorage.getItem(storageKey(user.id))) return; } catch { return; }
    const t = setTimeout(() => { setIndex(0); setActive(true); }, 1200);
    return () => clearTimeout(t);
  }, [user?.id, user?.isAdmin, user?.createdAt, location, portal]);

  // Replay on demand (Cmd-K "Take the tour").
  useEffect(() => {
    const start = () => { setIndex(0); setActive(true); };
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);

  // Resolve the step to a visible target, skipping steps with none.
  const target = useMemo(() => (active ? visibleTarget(steps[index]) : null), [active, index, steps]);
  useEffect(() => {
    if (!active) return;
    if (!target) {
      const next = steps.findIndex((s, i) => i > index && visibleTarget(s));
      if (next === -1) finish(); else setIndex(next);
    } else {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [active, target, index, steps, finish]);

  useLayoutEffect(() => {
    if (!active || !target) return;
    const update = () => setRect(target.getBoundingClientRect());
    update();
    const t = setTimeout(update, 350); // after the smooth scroll settles
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { clearTimeout(t); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [active, target]);

  const visibleSteps = steps.map((s, i) => i).filter((i) => i === index || (active && visibleTarget(steps[i])));
  const pos = visibleSteps.indexOf(index);
  const next = () => {
    const n = steps.findIndex((s, i) => i > index && visibleTarget(s));
    if (n === -1) finish(); else setIndex(n);
  };
  const back = () => {
    for (let i = index - 1; i >= 0; i--) if (visibleTarget(steps[i])) { setIndex(i); return; }
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!active || !target || !rect) return null;

  const step = steps[index];
  const isLast = pos === visibleSteps.length - 1;
  const pad = 6;
  const phone = window.innerWidth < 640;
  // Desktop: beside the target where there is room; phones: docked above the nav.
  const cardW = Math.min(340, window.innerWidth - 24);
  const below = rect.bottom + 12 + 190 < window.innerHeight;
  const cardStyle: React.CSSProperties = phone
    ? { left: 12, right: 12, bottom: "calc(5.75rem + env(safe-area-inset-bottom))" }
    : {
        width: cardW,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - cardW - 12)),
        ...(below ? { top: rect.bottom + 12 } : { bottom: window.innerHeight - rect.top + 12 }),
      };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={step.title} data-testid="first-run-tour">
      <div className="absolute inset-0" onClick={finish} />
      <div
        className="pointer-events-none absolute rounded-xl ring-2 ring-primary transition-all duration-300"
        style={{
          left: rect.left - pad, top: rect.top - pad,
          width: rect.width + pad * 2, height: rect.height + pad * 2,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
        }}
      />
      <div className="absolute rounded-2xl border bg-popover p-5 text-popover-foreground shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200" style={cardStyle}>
        <p className="text-xs font-medium text-muted-foreground">Step {pos + 1} of {visibleSteps.length}</p>
        <p className="mt-1 text-base font-semibold">{step.title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={finish} data-testid="button-tour-skip">Skip</Button>
          <div className="ml-auto flex gap-2">
            {pos > 0 && <Button variant="outline" size="sm" onClick={back}>Back</Button>}
            <Button size="sm" onClick={next} data-testid="button-tour-next">{isLast ? "Done" : "Next"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
