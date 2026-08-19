/**
 * Which plan a role must buy.
 *
 * The client's pricing, verbatim: "creator $149; brand $249; publisher $499".
 * PLAN_CONFIG stores those under stable keys that predate the role names, so
 * the mapping is written down once here rather than guessed at each call site:
 *
 *   creator   -> creator  $149
 *   brand     -> starter  $249
 *   publisher -> pro      $499   (role name is `affiliate` internally)
 *
 * `starter` and `pro` are deliberately NOT interchangeable with `creator`:
 * entitlement keys off subscription STATUS rather than tier, so a brand on the
 * $149 tier would receive the full Brand feature set. That is why the existing
 * checkout endpoints police their own allowlists, and why this returns exactly
 * one plan per role rather than a menu.
 */
import { PLAN_CONFIG, type PlanKey } from "../shared/plans";

export type AppRole = "creator" | "brand" | "affiliate" | string;

const BY_ROLE: Record<string, PlanKey> = {
  creator: "creator",
  brand: "starter",
  affiliate: "pro",
};

export function planForRole(role: AppRole | null | undefined): PlanKey | null {
  if (!role) return null;
  return BY_ROLE[role] ?? null;
}

/** Major units, for display. Never used to charge — Stripe holds the price. */
export function planAmountMajor(plan: PlanKey): number {
  return PLAN_CONFIG[plan].amount / 100;
}

/** What the product calls this role on screen. */
export function roleLabel(role: AppRole | null | undefined): string {
  return role === "affiliate" ? "Publisher" : role === "brand" ? "Brand" : "Creator";
}

/** Where a completed or abandoned checkout should land, per portal. */
export function portalHome(role: AppRole | null | undefined): string {
  return role === "brand" ? "/brand" : role === "affiliate" ? "/affiliate" : "/creator";
}
