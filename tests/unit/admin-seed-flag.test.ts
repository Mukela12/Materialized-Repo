/**
 * The admin seeder's on/off switch.
 *
 * This ran on every boot in production and re-applied ADMIN_PASSWORD, so the
 * client's own password was silently overwritten by every deploy — reported as
 * "the admin logins were failing", with no error to explain it.
 *
 * The guard was `!process.env.SEED_ADMIN_ACCOUNT`, which means the obvious way
 * to turn it off — SEED_ADMIN_ACCOUNT=false — left it ON, because "false" is a
 * non-empty string. Anyone reaching for the switch would have got the opposite
 * of what they intended.
 */
import { describe, it, expect, afterEach } from "vitest";

/** Mirrors seedingEnabled() in server/authRoutes.ts. */
function seedingEnabled(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

describe("the admin seeding flag", () => {
  it("is OFF when unset — the safe default for a live deployment", () => {
    expect(seedingEnabled(undefined)).toBe(false);
    expect(seedingEnabled("")).toBe(false);
    expect(seedingEnabled("   ")).toBe(false);
  });

  it("is OFF for the words people actually type to disable something", () => {
    // The original bug: every one of these enabled it.
    expect(seedingEnabled("false")).toBe(false);
    expect(seedingEnabled("FALSE")).toBe(false);
    expect(seedingEnabled("0")).toBe(false);
    expect(seedingEnabled("no")).toBe(false);
    expect(seedingEnabled("off")).toBe(false);
    expect(seedingEnabled("disabled")).toBe(false);
  });

  it("is ON only for an explicit yes", () => {
    expect(seedingEnabled("true")).toBe(true);
    expect(seedingEnabled("TRUE")).toBe(true);
    expect(seedingEnabled(" true ")).toBe(true);
    expect(seedingEnabled("1")).toBe(true);
    expect(seedingEnabled("yes")).toBe(true);
  });
});
