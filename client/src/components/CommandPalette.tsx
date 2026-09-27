/**
 * Jump anywhere by typing: Cmd-K / Ctrl-K, "/", or the search button in the
 * header. Reads the same navigation groups the sidebar renders, so the two
 * can never disagree about what pages exist. On phones it opens as a bottom
 * sheet (the shared dialog does that), which is where a menu of 17+ pages is
 * hardest to scan.
 */
import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import type { LucideIcon } from "lucide-react";
import { Search, Moon, Sun, LogOut, Compass } from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";
import { useLogout } from "@/hooks/useCurrentUser";

export interface NavGroup {
  heading: string;
  items: Array<{ path: string; label: string; icon: LucideIcon }>;
}

/** Words people type that are not the page's own label. */
const SYNONYMS: Array<[RegExp, string[]]> = [
  [/\/(creator|brand|affiliate)$/, ["home", "overview", "start"]],
  [/mailbox$/, ["inbox", "messages", "notifications"]],
  [/wallet$|rewards$/, ["tokens", "credit", "balance"]],
  [/help$/, ["support", "faq", "contact"]],
  [/my-videos$|campaigns$/, ["videos", "uploads"]],
  [/library$/, ["browse", "catalog", "videos"]],
  [/brand-kit$/, ["carousel", "colors", "styling", "fonts"]],
  [/inventory$/, ["products", "shopify", "woocommerce", "store"]],
  [/analytics$|crm$/, ["stats", "reports", "performance", "metrics"]],
  [/settings$|profile$/, ["account", "preferences", "billing"]],
];
const keywordsFor = (path: string) =>
  SYNONYMS.filter(([re]) => re.test(path)).flatMap(([, words]) => words);

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
};

export function CommandPalette({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const logout = useLogout();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = useCallback((fn: () => void) => {
    setOpen(false);
    fn();
  }, []);

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-9 gap-2 rounded-full px-3 text-muted-foreground sm:w-56 sm:justify-start"
        aria-label="Search pages"
        data-testid="button-command-palette"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search pages…</span>
        <kbd className="pointer-events-none ml-auto hidden select-none rounded border bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
          {isMac ? "⌘" : "Ctrl"} K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Where do you want to go?" data-testid="input-command-palette" />
        <CommandList>
          <CommandEmpty>No page matches that. Try "videos", "inbox" or "settings".</CommandEmpty>
          {groups.filter((g) => g.items.length).map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.items.map(({ path, label, icon: Icon }) => (
                <CommandItem
                  key={path}
                  value={`${label} ${path}`}
                  keywords={keywordsFor(path)}
                  onSelect={() => run(() => navigate(path))}
                  data-testid={`command-item-${path.replace(/\//g, "-").replace(/^-/, "")}`}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem value="toggle theme dark light mode" onSelect={() => run(toggleTheme)}>
              {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
              Switch to {theme === "dark" ? "light" : "dark"} mode
            </CommandItem>
            <CommandItem value="take the tour guide help walkthrough" onSelect={() => run(() => window.dispatchEvent(new Event("mtrlzd:start-tour")))}>
              <Compass className="mr-2 h-4 w-4" />
              Take the tour
            </CommandItem>
            <CommandItem value="sign out log out logout" onSelect={() => run(() => logout.mutate())}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <div className="hidden items-center justify-end gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground sm:flex">
          <span><CommandShortcut>↑↓</CommandShortcut> move</span>
          <span><CommandShortcut>↵</CommandShortcut> open</span>
          <span><CommandShortcut>esc</CommandShortcut> close</span>
        </div>
      </CommandDialog>
    </>
  );
}
