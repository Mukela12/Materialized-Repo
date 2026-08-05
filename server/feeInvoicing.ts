/**
 * Raising an invoice against the marketplace-fee ledger.
 *
 * server/feeAccruals.ts records what each brand owes, per verified order. This
 * turns a period of those accruals into an actual Stripe invoice.
 *
 * ── The ordering, which is the whole design ──────────────────────────────────
 * This writes to two systems: the accrual rows here, and an invoice at Stripe.
 * A crash in between leaves them disagreeing, and the two possible
 * disagreements are not equally bad:
 *
 *   Stripe first, then claim  ->  the invoice exists but the rows still look
 *                                 unbilled, so the NEXT RUN BILLS AGAIN. The
 *                                 brand is charged twice.
 *   Claim first, then Stripe  ->  the rows look billed but no invoice exists.
 *                                 Under-billing: visible, and recoverable.
 *
 * So the accruals are claimed FIRST, in one transaction, under an advisory lock
 * on the brand. The claim is what makes a second concurrent run find nothing.
 *
 * This is the same shape as the bug the payout engine still has — it transfers
 * money and only then marks the commissions paid, so a database failure at the
 * wrong moment leaves the money gone and the rows re-payable. Not repeated here.
 *
 * ── Resuming ─────────────────────────────────────────────────────────────────
 * The fee_invoices row is created before the Stripe call and its id is used as
 * the Stripe idempotency key, so retrying a half-finished run returns the SAME
 * invoice rather than creating a second. Stripe only retains idempotency keys
 * for 24 hours, so beyond that the retry falls back to searching Stripe for an
 * invoice carrying this id in its metadata. Both paths are exercised by tests.
 *
 * ── Drafts ───────────────────────────────────────────────────────────────────
 * An invoice is created as a DRAFT and bills nobody until it is finalised, which
 * is a separate explicit call. That is deliberate: the first invoices a brand
 * receives should be looked at by a human before they go out.
 */
/** One accrual row, as far as invoicing cares. */
export interface ClaimableAccrual {
  id: string;
  marketplaceFeeCents: number;
  currency: string;
  externalOrderId: string;
  saleCents: number;
}

export interface FeeInvoiceRecord {
  id: string;
  brandUserId: string;
  currency: string;
  subtotalCents: number;
  lineCount: number;
  status: "pending" | "created" | "failed" | "void";
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  finalized: boolean;
}

export interface InvoiceClaim {
  invoice: FeeInvoiceRecord;
  accruals: ClaimableAccrual[];
}

/** Storage surface — keeps this unit-testable without a database. */
export interface FeeInvoiceStore {
  /**
   * Atomically: take an advisory lock on the brand, select their unbilled
   * accruals for the period and currency, create a fee_invoices row, and point
   * those accruals at it. Returns null when there is nothing to bill.
   *
   * MUST be a single transaction. If the claim is not atomic, two admins
   * clicking at the same moment can both claim the same rows.
   */
  claimAccrualsForInvoice(args: {
    brandUserId: string;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<InvoiceClaim | null>;

  /** Release a claim, returning the accruals to 'accrued' so they bill later. */
  releaseInvoiceClaim(feeInvoiceId: string, reason: string, status: "failed" | "void"): Promise<void>;

  markInvoiceCreated(feeInvoiceId: string, stripeInvoiceId: string, hostedInvoiceUrl: string | null): Promise<void>;
  markInvoiceFinalized(feeInvoiceId: string, hostedInvoiceUrl: string | null): Promise<void>;
  getFeeInvoice(feeInvoiceId: string): Promise<FeeInvoiceRecord | null>;
  getBrandStripeCustomerId(brandUserId: string): Promise<string | null>;
}

/** The Stripe surface used here. Narrow on purpose, so tests can fake it. */
export interface FeeInvoiceStripe {
  createInvoice(args: {
    customerId: string;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
    daysUntilDue: number;
  }): Promise<{ id: string; hosted_invoice_url?: string | null }>;

  createInvoiceItem(args: {
    customerId: string;
    invoiceId: string;
    amountCents: number;
    currency: string;
    description: string;
    idempotencyKey: string;
  }): Promise<void>;

  finalizeInvoice(invoiceId: string): Promise<{ id: string; total: number; hosted_invoice_url?: string | null }>;

  /** Used to resume past Stripe's 24h idempotency-key retention. */
  findInvoiceByFeeInvoiceId(customerId: string, feeInvoiceId: string): Promise<{ id: string; hosted_invoice_url?: string | null } | null>;
}

export interface GenerateResult {
  status: "invoiced" | "nothing_to_invoice" | "no_customer" | "failed";
  feeInvoiceId?: string;
  stripeInvoiceId?: string;
  hostedInvoiceUrl?: string | null;
  subtotalCents?: number;
  lineCount?: number;
  finalized?: boolean;
  error?: string;
}

function money(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/**
 * The invoice carries ONE line for the whole period, not one per order: a brand
 * with a thousand orders should not receive a thousand-line invoice. The
 * per-order detail lives in the accrual ledger, which is what a query gets
 * reconciled against.
 */
export function describeInvoiceLine(orderCount: number, periodStart: Date, periodEnd: Date): string {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return `Materialized marketplace fee — ${orderCount} attributed ` +
    `${orderCount === 1 ? "order" : "orders"}, ${d(periodStart)} to ${d(periodEnd)}`;
}

/**
 * Generate one invoice for one brand and one currency.
 *
 * Returns rather than throws for the expected outcomes — nothing to bill, brand
 * has no Stripe customer — because those are normal results of a bulk run, not
 * errors. A genuine Stripe failure releases the claim and reports "failed", so
 * the accruals become billable again on the next run rather than being stranded.
 */
export async function generateFeeInvoice(
  store: FeeInvoiceStore,
  stripe: FeeInvoiceStripe,
  args: {
    brandUserId: string;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    /**
     * REMOVED. Finalising is now finalizeFeeInvoice(), deliberately outside this
     * function's try/catch — a throw after the invoice was sent used to release
     * the claim, so the same orders were billed again next run.
     */
    daysUntilDue?: number;
  },
): Promise<GenerateResult> {
  const customerId = await store.getBrandStripeCustomerId(args.brandUserId);
  if (!customerId) {
    // Checked BEFORE claiming: claiming rows we then cannot bill would strand
    // them behind a failed invoice for no reason.
    return { status: "no_customer", error: "Brand has no Stripe customer id" };
  }

  const claim = await store.claimAccrualsForInvoice({
    brandUserId: args.brandUserId,
    currency: args.currency,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });

  if (!claim || claim.accruals.length === 0 || claim.invoice.subtotalCents <= 0) {
    if (claim) await store.releaseInvoiceClaim(claim.invoice.id, "nothing to invoice", "void");
    return { status: "nothing_to_invoice" };
  }

  const feeInvoiceId = claim.invoice.id;
  const description = describeInvoiceLine(claim.accruals.length, args.periodStart, args.periodEnd);

  try {
    // Past Stripe's 24h key retention an identical key would create a SECOND
    // invoice, so a resumed run looks for one already carrying this id first.
    let stripeInvoice = await stripe.findInvoiceByFeeInvoiceId(customerId, feeInvoiceId);

    if (!stripeInvoice) {
      // Invoice FIRST, then the item naming it. Creating the item first and
      // relying on the invoice to sweep it up does NOT work — invoices.create
      // defaults to pending_invoice_items_behavior 'exclude', which produced a
      // finalised $0 invoice marked paid while the real amount floated as a
      // pending item. See the note on createSurplusInvoice in stripeService.ts.
      stripeInvoice = await stripe.createInvoice({
        customerId,
        currency: claim.invoice.currency,
        description,
        metadata: {
          type: "marketplace_fee",
          feeInvoiceId,
          brandUserId: args.brandUserId,
          orders: String(claim.accruals.length),
        },
        idempotencyKey: `fee_invoice_${feeInvoiceId}`,
        daysUntilDue: args.daysUntilDue ?? 14,
      });

      await stripe.createInvoiceItem({
        customerId,
        invoiceId: stripeInvoice.id,
        amountCents: claim.invoice.subtotalCents,
        currency: claim.invoice.currency,
        description,
        idempotencyKey: `fee_invoice_item_${feeInvoiceId}`,
      });
    }

    await store.markInvoiceCreated(feeInvoiceId, stripeInvoice.id, stripeInvoice.hosted_invoice_url ?? null);

    let hostedUrl = stripeInvoice.hosted_invoice_url ?? null;
    return {
      status: "invoiced",
      feeInvoiceId,
      stripeInvoiceId: stripeInvoice.id,
      hostedInvoiceUrl: hostedUrl,
      subtotalCents: claim.invoice.subtotalCents,
      lineCount: claim.accruals.length,
      finalized: false,
    };
  } catch (err) {
    // Release, so the accruals are billable again next run rather than stranded
    // behind an invoice that does not exist. Under-billing once is recoverable;
    // silently losing a receivable is not.
    //
    // Reachable ONLY before the invoice is finalised — see finalizeFeeInvoice
    // below for why finalising must never be able to land here.
    const message = (err as Error)?.message ?? String(err);
    await store.releaseInvoiceClaim(feeInvoiceId, message, "failed");
    return { status: "failed", feeInvoiceId, error: message };
  }
}

/**
 * Finalise a draft — the step that actually issues the bill.
 *
 * DELIBERATELY NOT INSIDE generateFeeInvoice's try/catch. It used to be, and
 * that was a way to bill a brand twice: finalizeInvoice() sends a real,
 * collectible invoice, and ANY throw after it returned — the zero-total guard,
 * a dropped response, a failed markInvoiceFinalized — fell into the catch and
 * released the accruals back to `accrued`. A sent invoice would then exist while
 * its rows looked unbilled, and the next run would bill them again.
 *
 * So once money has been demanded, nothing here releases a claim. A bookkeeping
 * failure after finalising is reported for a human instead — the same rule the
 * payout engine follows once a transfer has left.
 */
export async function finalizeFeeInvoice(
  store: FeeInvoiceStore,
  stripe: FeeInvoiceStripe,
  feeInvoiceId: string,
  stripeInvoiceId: string,
): Promise<{ ok: boolean; finalized: boolean; hostedInvoiceUrl?: string | null; error?: string; needsAttention?: boolean }> {
  let final: { id: string; total: number; hosted_invoice_url?: string | null };
  try {
    final = await stripe.finalizeInvoice(stripeInvoiceId);
  } catch (err) {
    // Nothing was sent, so the claim may safely stay put — the draft is still
    // there to retry. We do NOT release: the draft still references these rows.
    return { ok: false, finalized: false, error: (err as Error)?.message ?? String(err) };
  }

  // From here the invoice IS issued. No failure below may release the claim.
  if (!final.total) {
    return {
      ok: false, finalized: true, needsAttention: true,
      error: `Invoice ${final.id} finalised with a zero total — the line item did not attach. ` +
        `It has been issued; void it in Stripe.`,
    };
  }

  try {
    await store.markInvoiceFinalized(feeInvoiceId, final.hosted_invoice_url ?? null);
  } catch (err) {
    return {
      ok: false, finalized: true, needsAttention: true,
      hostedInvoiceUrl: final.hosted_invoice_url ?? null,
      error: `Invoice ${final.id} was SENT but recording that failed: ${(err as Error)?.message}. ` +
        `Do not re-run; mark fee invoice ${feeInvoiceId} finalised by hand.`,
    };
  }

  return { ok: true, finalized: true, hostedInvoiceUrl: final.hosted_invoice_url ?? null };
}

/** Human-readable one-liner for a run, for logs and the admin response. */
export function summariseResult(brandLabel: string, r: GenerateResult): string {
  switch (r.status) {
    case "invoiced":
      return `${brandLabel}: ${money(r.subtotalCents!, "usd")} across ${r.lineCount} order(s)` +
        `${r.finalized ? " — finalised" : " — draft"}`;
    case "nothing_to_invoice": return `${brandLabel}: nothing to invoice`;
    case "no_customer": return `${brandLabel}: SKIPPED, no Stripe customer`;
    case "failed": return `${brandLabel}: FAILED — ${r.error}`;
  }
}
