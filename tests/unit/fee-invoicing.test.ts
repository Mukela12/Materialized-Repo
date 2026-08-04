/**
 * Raising an invoice against the marketplace-fee ledger.
 *
 * Invoicing writes to two systems — the accrual rows and Stripe — and the whole
 * design is about which one goes first. Calling Stripe first and claiming
 * afterwards means a crash in between leaves the invoice raised and the rows
 * still looking unbilled, so the next run BILLS THE BRAND AGAIN. Claiming first
 * can only under-bill, which is visible and recoverable.
 *
 * That is the same shape as the defect the payout engine still carries: it
 * transfers the money and only then marks the commissions paid. These tests
 * exist so that shape does not get introduced here by a later edit.
 *
 * What is pinned:
 *   - a second concurrent run finds nothing (the claim is what blocks it)
 *   - a Stripe failure RELEASES the rows, so the receivable is not stranded
 *   - a resumed run lands on the SAME Stripe invoice, both within Stripe's 24h
 *     idempotency window and past it
 *   - unattributed (zero-fee) accruals are never billed
 *   - a finalised invoice with a zero total is treated as failure, not success
 */
import { describe, it, expect, vi } from "vitest";
import {
  generateFeeInvoice,
  describeInvoiceLine,
  type FeeInvoiceStore,
  type FeeInvoiceStripe,
  type InvoiceClaim,
} from "../../server/feeInvoicing";

const PERIOD = { periodStart: new Date("2026-07-01"), periodEnd: new Date("2026-08-01") };

/** In-memory store mirroring the real claim/release semantics. */
function fakeStore(opts: { customerId?: string | null; accruals?: number[] } = {}) {
  const feeCents = opts.accruals ?? [1500, 1300];
  let released: string[] = [];
  const invoices = new Map<string, any>();
  // Rows start unbilled; a claim moves them, a release moves them back.
  let unbilled = feeCents.map((c, i) => ({
    id: `acc_${i}`, marketplaceFeeCents: c, currency: "usd",
    externalOrderId: `order_${i}`, saleCents: c * 10,
  }));

  const store: FeeInvoiceStore & { invoices: Map<string, any>; released: string[]; unbilledCount(): number } = {
    invoices,
    get released() { return released; },
    unbilledCount: () => unbilled.length,

    async getBrandStripeCustomerId() {
      return opts.customerId === undefined ? "cus_123" : opts.customerId;
    },

    async claimAccrualsForInvoice(args): Promise<InvoiceClaim | null> {
      if (unbilled.length === 0) return null;   // <- what stops a second run
      const claimed = unbilled;
      unbilled = [];
      const id = `fi_${invoices.size + 1}`;
      const subtotalCents = claimed.reduce((s, r) => s + r.marketplaceFeeCents, 0);
      const invoice = {
        id, brandUserId: args.brandUserId, currency: args.currency,
        subtotalCents, lineCount: claimed.length, status: "pending" as const,
        stripeInvoiceId: null, hostedInvoiceUrl: null, finalized: false,
        _claimed: claimed,
      };
      invoices.set(id, invoice);
      return { invoice, accruals: claimed };
    },

    async releaseInvoiceClaim(id, reason, status) {
      released.push(id);
      const inv = invoices.get(id);
      if (inv) { inv.status = status; inv.error = reason; unbilled = inv._claimed; }
    },

    async markInvoiceCreated(id, stripeInvoiceId, hostedInvoiceUrl) {
      const inv = invoices.get(id);
      if (inv) { inv.status = "created"; inv.stripeInvoiceId = stripeInvoiceId; inv.hostedInvoiceUrl = hostedInvoiceUrl; }
    },

    async markInvoiceFinalized(id, hostedInvoiceUrl) {
      const inv = invoices.get(id);
      if (inv) { inv.finalized = true; inv.hostedInvoiceUrl = hostedInvoiceUrl; }
    },

    async getFeeInvoice(id) { return invoices.get(id) ?? null; },
  };
  return store;
}

function fakeStripe(overrides: Partial<FeeInvoiceStripe> = {}) {
  const created: any[] = [];
  const items: any[] = [];
  const base: FeeInvoiceStripe = {
    async createInvoice(a) {
      created.push(a);
      return { id: `in_${created.length}`, hosted_invoice_url: `https://pay.stripe/in_${created.length}` };
    },
    async createInvoiceItem(a) { items.push(a); },
    async finalizeInvoice(id) { return { id, total: 2800, hosted_invoice_url: `https://pay.stripe/${id}` }; },
    async findInvoiceByFeeInvoiceId() { return null; },
    ...overrides,
  };
  return Object.assign(base, { created, items });
}

const ARGS = { brandUserId: "brand_1", currency: "usd", ...PERIOD };

describe("raising an invoice", () => {
  it("bills the sum of the claimed accruals, as a draft", async () => {
    const store = fakeStore();
    const stripe = fakeStripe();

    const r = await generateFeeInvoice(store, stripe, ARGS);

    expect(r.status).toBe("invoiced");
    expect(r.subtotalCents).toBe(2800);
    expect(r.lineCount).toBe(2);
    expect(r.finalized).toBe(false); // a draft bills nobody yet
    expect(stripe.items[0].amountCents).toBe(2800);
  });

  it("creates the invoice BEFORE the line item, and names it on the item", async () => {
    // Reversing this produced a finalised $0 invoice marked paid, with the real
    // amount floating as an unattached pending item. See stripeService.ts.
    const store = fakeStore();
    const order: string[] = [];
    const stripe = fakeStripe({
      async createInvoice() { order.push("invoice"); return { id: "in_1", hosted_invoice_url: null }; },
      async createInvoiceItem(a) { order.push("item"); expect(a.invoiceId).toBe("in_1"); },
    });

    await generateFeeInvoice(store, stripe, ARGS);
    expect(order).toEqual(["invoice", "item"]);
  });

  it("finalises when asked, and reports the hosted url", async () => {
    const store = fakeStore();
    const r = await generateFeeInvoice(store, fakeStripe(), { ...ARGS, finalize: true });

    expect(r.finalized).toBe(true);
    expect(r.hostedInvoiceUrl).toContain("https://pay.stripe/");
  });

  it("treats a finalised zero-total invoice as a FAILURE, not a success", async () => {
    // A $0 invoice is auto-marked paid, so this would otherwise read as success
    // while nobody was billed.
    const store = fakeStore();
    const stripe = fakeStripe({
      async finalizeInvoice(id) { return { id, total: 0, hosted_invoice_url: null }; },
    });

    const r = await generateFeeInvoice(store, stripe, { ...ARGS, finalize: true });

    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/zero total/i);
    expect(store.unbilledCount()).toBe(2); // released, so it can be billed again
  });
});

describe("not billing twice", () => {
  it("a second run finds nothing, because the first claimed the rows", async () => {
    const store = fakeStore();
    const stripe = fakeStripe();

    const first = await generateFeeInvoice(store, stripe, ARGS);
    const second = await generateFeeInvoice(store, stripe, ARGS);

    expect(first.status).toBe("invoiced");
    expect(second.status).toBe("nothing_to_invoice");
    expect(stripe.created).toHaveLength(1); // only ONE Stripe invoice
  });

  it("resumes onto the same Stripe invoice instead of creating a second", async () => {
    // The crash-and-retry case: the invoice exists at Stripe but the run died
    // before recording it. findInvoiceByFeeInvoiceId is what closes this, and it
    // is the path that survives past Stripe's 24h idempotency-key retention.
    const store = fakeStore();
    const stripe = fakeStripe({
      async findInvoiceByFeeInvoiceId() {
        return { id: "in_existing", hosted_invoice_url: "https://pay.stripe/in_existing" };
      },
    });

    const r = await generateFeeInvoice(store, stripe, ARGS);

    expect(r.status).toBe("invoiced");
    expect(r.stripeInvoiceId).toBe("in_existing");
    expect(stripe.created).toHaveLength(0); // nothing new was created
  });

  it("passes a stable idempotency key derived from the fee invoice id", async () => {
    const store = fakeStore();
    const stripe = fakeStripe();
    const r = await generateFeeInvoice(store, stripe, ARGS);

    expect(stripe.created[0].idempotencyKey).toBe(`fee_invoice_${r.feeInvoiceId}`);
    expect(stripe.items[0].idempotencyKey).toBe(`fee_invoice_item_${r.feeInvoiceId}`);
  });
});

describe("when Stripe fails", () => {
  it("releases the claim so the receivable is not stranded", async () => {
    const store = fakeStore();
    const stripe = fakeStripe({
      async createInvoice() { throw new Error("Stripe is down"); },
    });

    const r = await generateFeeInvoice(store, stripe, ARGS);

    expect(r.status).toBe("failed");
    expect(r.error).toBe("Stripe is down");
    expect(store.released).toHaveLength(1);
    // The crucial part: billable again next run.
    expect(store.unbilledCount()).toBe(2);
  });

  it("still releases when the failure is on the line item, not the invoice", async () => {
    const store = fakeStore();
    const stripe = fakeStripe({
      async createInvoiceItem() { throw new Error("item rejected"); },
    });

    const r = await generateFeeInvoice(store, stripe, ARGS);

    expect(r.status).toBe("failed");
    expect(store.unbilledCount()).toBe(2);
  });
});

describe("what is never billed", () => {
  it("does nothing when the brand has no Stripe customer, and claims nothing", async () => {
    const store = fakeStore({ customerId: null });
    const stripe = fakeStripe();

    const r = await generateFeeInvoice(store, stripe, ARGS);

    expect(r.status).toBe("no_customer");
    // Checked BEFORE claiming — the rows must not be stranded behind an invoice
    // that could never be raised.
    expect(store.unbilledCount()).toBe(2);
    expect(store.invoices.size).toBe(0);
  });

  it("raises nothing when the period has no billable accruals", async () => {
    const store = fakeStore({ accruals: [] });
    const stripe = fakeStripe();

    const r = await generateFeeInvoice(store, stripe, ARGS);

    expect(r.status).toBe("nothing_to_invoice");
    expect(stripe.created).toHaveLength(0);
  });

  it("voids a claim that turns out to total zero", async () => {
    // Defence in depth: the storage query already excludes zero-fee rows, but if
    // one ever got through, an invoice for $0 must not be raised.
    const store = fakeStore({ accruals: [0, 0] });
    const stripe = fakeStripe();

    const r = await generateFeeInvoice(store, stripe, ARGS);

    expect(r.status).toBe("nothing_to_invoice");
    expect(stripe.created).toHaveLength(0);
    expect(store.unbilledCount()).toBe(2); // released, not stuck
  });
});

describe("the invoice line", () => {
  it("is one line for the period, not one per order", () => {
    const line = describeInvoiceLine(37, new Date("2026-07-01"), new Date("2026-08-01"));
    expect(line).toBe("Materialized marketplace fee — 37 attributed orders, 2026-07-01 to 2026-08-01");
  });

  it("says 'order' when there is exactly one", () => {
    expect(describeInvoiceLine(1, new Date("2026-07-01"), new Date("2026-08-01")))
      .toContain("1 attributed order,");
  });
});
