/**
 * Crediting a partner on a code AFTER it was minted (client, 20 Nov 2026).
 *
 * Partners are sent one shared code (GUSHCLOUD26, 2,000 creators) before they
 * have an account, so "credit to partner" cannot only exist on the mint form.
 * The credit is read from the voucher at the moment of each sale, so setting
 * it later still covers everyone who already joined with the code.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const ROUTES = read("server/routes.ts");
const STORAGE = read("server/storage.ts");
const PARTNERS = read("server/partners.ts");
const UI = read("client/src/components/VoucherManager.tsx");

function route(): string {
  const at = ROUTES.indexOf('app.patch("/api/admin/vouchers/:id/referrer"');
  expect(at).toBeGreaterThan(-1);
  return ROUTES.slice(at, ROUTES.indexOf("\n  });", at));
}

describe("crediting a partner on an existing code", () => {
  it("is an admin-only route", () => {
    expect(route()).toMatch(/^app\.patch\("\/api\/admin\/vouchers\/:id\/referrer", requireAdmin,/);
  });

  it("looks the partner up by account email and refuses an email with no account", () => {
    const r = route();
    expect(r).toContain("storage.getUserByEmail(email)");
    expect(r).toMatch(/if \(!partner\) return res\.status\(400\)/);
    // The id that is saved comes from the account that was found, never from the request.
    expect(r).toContain("referrerUserId = partner.id");
    expect(r).not.toMatch(/req\.body\??\.referrerUserId/);
  });

  it("clears the credit on a blank email", () => {
    const r = route();
    expect(r).toMatch(/let referrerUserId: string \| null = null;\s*if \(email\) \{/);
  });

  it("writes the column in the real storage, not only the in-memory one", () => {
    const db = STORAGE.slice(STORAGE.lastIndexOf("async setVoucherReferrer("));
    expect(db.slice(0, 300)).toContain(".set({ referrerUserId })");
  });

  it("lists the credited partner's email so the table can show it", () => {
    expect(STORAGE).toContain("where u.id = ${vouchers}.referrer_user_id");
    expect(UI).toContain("data-testid={`input-referrer-${v.id}`}");
  });

  it("is read at the moment of the sale, so a late credit covers earlier sign-ups", () => {
    // creditedPartner joins the redemption to the voucher's CURRENT referrer.
    expect(PARTNERS).toMatch(/select v\.referrer_user_id, v\.batch_id, r\.redeemed_at from voucher_redemptions r join vouchers v/);
  });
});
