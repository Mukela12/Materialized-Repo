/**
 * Guards for the 2026 UI refinement pass: the rules that are easy to lose in
 * a later edit and invisible until a client notices.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("first-run tour", () => {
  const src = code("client/src/components/FirstRunTour.tsx");

  it("never auto-offers to admins or accounts older than the trial window", () => {
    expect(src).toMatch(/user\.isAdmin/);
    expect(src).toMatch(/NEW_ACCOUNT_DAYS\s*=\s*14/);
    expect(src).toMatch(/ageDays <= NEW_ACCOUNT_DAYS/);
  });

  it("shows once per user: finishing or skipping is remembered", () => {
    expect(src).toMatch(/localStorage\.setItem\(storageKey\(user\.id\)/);
    expect(src).toMatch(/localStorage\.getItem\(storageKey\(user\.id\)\)\) return/);
  });

  it("skips steps whose target is not on screen rather than pointing at nothing", () => {
    expect(src).toMatch(/if \(!target\)/);
  });

  it("the server exposes createdAt so the age check can work", () => {
    expect(code("server/authRoutes.ts")).toMatch(/createdAt: user\.createdAt/);
  });
});

describe("command palette", () => {
  it("reads the same navigation lists the sidebars render, per portal", () => {
    const app = code("client/src/App.tsx");
    expect(app).toMatch(/BRAND_NAV_GROUPS/);
    expect(app).toMatch(/PUBLISHER_NAV_GROUPS/);
    expect(app).toMatch(/CREATOR_NAV_GROUPS/);
    expect(code("client/src/components/AppSidebar.tsx")).toMatch(/export const CREATOR_NAV_GROUPS/);
  });
});

describe("primitives", () => {
  it("badges are labels, not 60px pills", () => {
    expect(code("client/src/components/ui/badge.tsx")).not.toMatch(/py-\[20px\]/);
  });

  it("small buttons are small", () => {
    const btn = code("client/src/components/ui/button.tsx");
    const sm = btn.match(/sm:\s*"([^"]+)"/)?.[1] ?? "";
    expect(sm).not.toMatch(/py-\[20px\]/);
  });

  it("tab bars scroll instead of stretching the page", () => {
    expect(code("client/src/components/ui/tabs.tsx")).toMatch(/max-w-full[^"]*overflow-x-auto/);
  });

  it("grid children may shrink below their content", () => {
    expect(read("client/src/index.css")).toMatch(/main \.grid > \*\s*\{\s*min-width:\s*0/);
  });

  it("the shell uses the dynamic viewport height", () => {
    expect(code("client/src/App.tsx")).toMatch(/h-dvh/);
  });
});
