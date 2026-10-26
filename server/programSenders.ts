/**
 * Storage for program invites (see server/programInvites.ts for the rules).
 * Its own module with direct queries: these are new tables and joins the
 * general storage interface has no use for.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { programSenders, users, vouchers, type ProgramSender } from "@shared/schema";
import { canonicalCode } from "./vouchers";
import { programBatchId, SEAT_TYPES, type SeatType, type TemplateVoucher } from "./programInvites";

export async function getSender(userId: string): Promise<ProgramSender | null> {
  const [row] = await db.select().from(programSenders).where(eq(programSenders.userId, userId));
  return row ?? null;
}

export async function getVoucherById(id: string | null | undefined): Promise<TemplateVoucher | null> {
  if (!id) return null;
  const [v] = await db.select().from(vouchers).where(eq(vouchers.id, id));
  return (v as unknown as TemplateVoucher) ?? null;
}

/** A voucher by its code, however it was typed (case, dashes, spaces). */
export async function findVoucherByCode(code: string): Promise<TemplateVoucher | null> {
  const want = canonicalCode(code);
  if (!want) return null;
  const [v] = await db.select().from(vouchers)
    .where(sql`regexp_replace(upper(${vouchers.code}), '[^A-Z0-9]', '', 'g') = ${want}`);
  return (v as unknown as TemplateVoucher) ?? null;
}

export async function countSent(userId: string, type: SeatType): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(vouchers)
    .where(eq(vouchers.batchId, programBatchId(userId, type)));
  return r?.n ?? 0;
}

/** Emails this account has already invited, lowercased. */
export async function invitedEmails(userId: string): Promise<Set<string>> {
  const rows = await db.select({ email: vouchers.assignedTo }).from(vouchers)
    .where(inArray(vouchers.batchId, SEAT_TYPES.map((t) => programBatchId(userId, t))));
  return new Set(rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean));
}

export interface SentInvite {
  id: string;
  name: string;
  email: string;
  type: SeatType;
  sentAt: string;
  joined: boolean;
}

export async function listSent(userId: string): Promise<SentInvite[]> {
  const rows = await db.select({
    id: vouchers.id, label: vouchers.label, email: vouchers.assignedTo, batchId: vouchers.batchId,
    createdAt: vouchers.createdAt,
    // Spelled out in full: inside a sub-query Drizzle writes ${vouchers.id} as a
    // bare "id", which resolves to the redemption's own id and never matches.
    joined: sql<boolean>`exists (select 1 from voucher_redemptions r where r.voucher_id = "vouchers"."id")`,
  }).from(vouchers)
    .where(inArray(vouchers.batchId, SEAT_TYPES.map((t) => programBatchId(userId, t))))
    .orderBy(sql`${vouchers.createdAt} desc`);
  return rows.map((r) => ({
    id: r.id,
    // The label is "<program>: <name>".
    name: (r.label ?? "").replace(/^[^:]*:\s*/, "") || (r.email ?? ""),
    email: r.email ?? "",
    type: (SEAT_TYPES.find((t) => (r.batchId ?? "").endsWith(`:${t}`)) ?? "creator"),
    sentAt: new Date(r.createdAt as any).toISOString(),
    joined: !!r.joined,
  }));
}

/** Take back invites whose email never went out, so they don't use up the allowance. */
export async function releaseUnsent(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(vouchers).where(and(
    inArray(vouchers.id, ids),
    sql`not exists (select 1 from voucher_redemptions r where r.voucher_id = "vouchers"."id")`,
  ));
}

export interface SenderSummary {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  programName: string;
  brandLimit: number;
  brandTemplateCode: string | null;
  brandSent: number;
  creatorLimit: number;
  creatorTemplateCode: string | null;
  creatorSent: number;
  publisherLimit: number;
  publisherTemplateCode: string | null;
  publisherSent: number;
  /** The partner's commission deal: % of their people's sales, until when. */
  commissionPct: number | null;
  commissionUntil: string | null;
  joined: number;
}

export async function listSenders(): Promise<SenderSummary[]> {
  const rows = await db.select({ s: programSenders, email: users.email, displayName: users.displayName, role: users.role })
    .from(programSenders).innerJoin(users, eq(users.id, programSenders.userId));
  const out: SenderSummary[] = [];
  for (const { s, email, displayName, role } of rows) {
    const [bt, ct, pt, sent] = await Promise.all([
      getVoucherById(s.brandTemplateVoucherId), getVoucherById(s.creatorTemplateVoucherId),
      getVoucherById(s.publisherTemplateVoucherId), listSent(s.userId),
    ]);
    out.push({
      userId: s.userId, email, displayName, role: role ?? "",
      programName: s.programName,
      brandLimit: s.brandLimit, brandTemplateCode: bt?.code ?? null, brandSent: sent.filter((x) => x.type === "brand").length,
      creatorLimit: s.creatorLimit, creatorTemplateCode: ct?.code ?? null, creatorSent: sent.filter((x) => x.type === "creator").length,
      publisherLimit: s.publisherLimit ?? 0, publisherTemplateCode: pt?.code ?? null, publisherSent: sent.filter((x) => x.type === "publisher").length,
      commissionPct: s.commissionPct != null ? Number(s.commissionPct) : null,
      commissionUntil: s.commissionUntil ? new Date(s.commissionUntil as any).toISOString() : null,
      joined: sent.filter((x) => x.joined).length,
    });
  }
  return out.sort((a, b) => a.programName.localeCompare(b.programName) || a.email.localeCompare(b.email));
}

export async function saveSender(v: {
  userId: string; programName: string;
  brandLimit: number; brandTemplateVoucherId: string | null;
  creatorLimit: number; creatorTemplateVoucherId: string | null;
  publisherLimit: number; publisherTemplateVoucherId: string | null;
  commissionPct: number | null; commissionUntil: Date | null;
  createdBy: string;
}): Promise<void> {
  const row = { ...v, commissionPct: v.commissionPct != null ? v.commissionPct.toFixed(2) : null };
  await db.insert(programSenders).values({ ...row, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: programSenders.userId,
      set: {
        programName: v.programName, brandLimit: v.brandLimit, brandTemplateVoucherId: v.brandTemplateVoucherId,
        creatorLimit: v.creatorLimit, creatorTemplateVoucherId: v.creatorTemplateVoucherId,
        publisherLimit: v.publisherLimit, publisherTemplateVoucherId: v.publisherTemplateVoucherId,
        commissionPct: row.commissionPct, commissionUntil: v.commissionUntil, updatedAt: new Date(),
      },
    });
}

export async function removeSender(userId: string): Promise<boolean> {
  const r = await db.delete(programSenders).where(eq(programSenders.userId, userId)).returning();
  return r.length > 0;
}
