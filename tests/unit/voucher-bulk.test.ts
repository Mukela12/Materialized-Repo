/**
 * Voucher bulk actions, and the free pass on CSV invitations (29 Sep 2026).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeBulkResult } from "../../client/src/components/VoucherBulkBar";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const routes = code("server/routes.ts");
const storage = code("server/storage.ts");
const none = { updated: 0, deleted: 0, revoked: 0, skipped: 0, accountsUpdated: 0 };

function handler(method: string, path: string): string {
  const start = routes.indexOf(`app.${method}("${path}"`);
  expect(start, `${method} ${path}`).toBeGreaterThan(-1);
  return routes.slice(start, routes.indexOf("\n  app.", start + 10));
}

describe("bulk actions protect codes someone signed up with", () => {
  it("a used code keeps its type", () => {
    expect(storage).toMatch(/const unused = ids\.filter\(\(id\) => !used\.has\(id\)\);/);
    expect(storage).toMatch(/set\(\{ roleRestriction: action\.role \}\)\.where\(inArray\(vouchers\.id, unused\)\)/);
  });

  it("delete removes unused codes and only revokes used ones", () => {
    expect(storage).toMatch(/const toRevoke = action\.kind === "revoke" \? ids : Array\.from\(used\);/);
    expect(storage).toMatch(/tx\.delete\(vouchers\)\.where\(inArray\(vouchers\.id, unused\)\)/);
  });

  it("a new expiry reaches people who already signed up with a free code", () => {
    expect(storage).toMatch(/SET free_access_until = v\.expires_at/);
    expect(storage).toMatch(/v\.grant_type = 'free_access'\s+AND v\.free_days IS NULL\s+AND u\.free_access = true/);
    // Both the bulk action and the batch "Set dates" dialog carry it.
    expect((storage.match(/await this\.syncFreeAccessToVoucherExpiry\(/g) ?? []).length).toBe(2);
  });

  it("is admin-only, validated, and reads days the New York way", () => {
    expect(routes).toMatch(/app\.post\("\/api\/admin\/vouchers\/bulk", requireAdmin,/);
    const body = handler("post", "/api/admin/vouchers/bulk");
    expect(body).toMatch(/ids\.length > 2000/);
    expect(body).toMatch(/parseVoucherDate\(req\.body\?\.expiresAt, "end"\)/);
    expect(body).toMatch(/The start date must be before the expiry date/);
  });
});

describe("the result says what happened", () => {
  it("counts, and why a used code was left alone", () => {
    expect(describeBulkResult({ action: "role", role: "brand" }, { ...none, updated: 3, skipped: 1 }))
      .toBe("3 codes updated, 1 used code left as they were");
    expect(describeBulkResult({ action: "delete" }, { ...none, deleted: 4, revoked: 1 }))
      .toBe("4 codes deleted, 1 code revoked, used codes are revoked, not deleted");
    expect(describeBulkResult({ action: "dates", expiresAt: "2026-12-15" }, { ...none, updated: 2, accountsUpdated: 1 }))
      .toBe("2 codes updated, 1 account moved to the new expiry");
    expect(describeBulkResult({ action: "revoke" }, none)).toBe("nothing to change");
  });
});

describe("a CSV invitation carries its free pass", () => {
  it("both invite paths mint through the same helper", () => {
    expect(handler("post", "/api/brands/invite-creator")).toMatch(/voucherCode = await mintInvitePass\(/);
    const bulk = handler("post", "/api/brands/invite-creators/bulk");
    expect(bulk).toMatch(/code = await mintInvitePass\(/);
    expect(bulk).toMatch(/acceptUrl: inviteAcceptUrl\(req, code\),\s*voucherCode: code,/);
    expect(bulk).not.toMatch(/`\$\{publicOrigin\(req\)\}\/register`/);
  });

  it("rows past the pass limit are reported, not sent a promise with no pass", () => {
    const bulk = handler("post", "/api/brands/invite-creators/bulk");
    expect(bulk).toMatch(/const room = await invitePassesLeft\(useBrandId\);/);
    expect(bulk).toMatch(/errors\.push\(\{ index: over\.index, error: "Pass limit reached" \}\)/);
    expect(bulk).toMatch(/const toInvite = validInvitations\.slice\(0, room\);/);
  });

  it("the brand sees how many were really sent", () => {
    const page = code("client/src/pages/brand-creators.tsx");
    expect(page).toMatch(/return \(await res\.json\(\)\) as \{ created: number;/);
  });
});

describe("failed requests show the server's reason", () => {
  it("nothing reaches for a response the error doesn't have", async () => {
    const { serverMessage } = await import("../../client/src/lib/queryClient");
    expect(serverMessage(new Error('429: {"error":"Invitation limit reached (100)."}'))).toBe("Invitation limit reached (100).");
    expect(serverMessage(new Error("500: <!DOCTYPE html>"))).toBe("");
    const { globSync } = await import("node:fs");
    const offenders = globSync("client/src/**/*.tsx", { cwd: join(__dirname, "../..") })
      .filter((f) => /response\?\.json\?\.\(\)/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
