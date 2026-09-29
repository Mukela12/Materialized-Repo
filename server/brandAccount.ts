/**
 * Every brand account has a brand.
 *
 * Found in QA on 29 Sep 2026: signing up as a brand created a user and
 * nothing else. The brands row, which products, creator invitations,
 * campaigns and store connections all hang off, was only ever made by a
 * POST /api/brands that no screen calls. So a brand that registered could not
 * add a single product ("No brand available") and never appeared in the list
 * creators tag brands from. The one working brand in production dated from
 * the Replit era; local QA used a seeded brand, which hid it.
 *
 * ensureOwnBrand is called at sign-up, backfilled by migration 0038, and used
 * as a safety net on the routes that need a brand.
 */
import { asc, eq, sql } from "drizzle-orm";
import { brands, type Brand } from "@shared/schema";

export async function ensureOwnBrand(user: { id: string; role: string; displayName: string }): Promise<Brand | null> {
  if (user.role !== "brand") return null;
  const { db } = await import("./db");
  const name = (user.displayName || "").trim().slice(0, 200) || "My brand";
  // One transaction with a per-user advisory lock: two first requests at once
  // (a double-clicked button) must not make two brands.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"own-brand:" + user.id}))`);
    const [existing] = await tx.select().from(brands).where(eq(brands.ownerId, user.id)).orderBy(asc(brands.id)).limit(1);
    if (existing) return existing;
    const [created] = await tx.insert(brands).values({ name, ownerId: user.id, isActive: true }).returning();
    return created;
  });
}
