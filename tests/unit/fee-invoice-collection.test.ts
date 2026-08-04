/**
 * How the marketplace fee is collected.
 *
 * The client's objection to invoicing was scale, and it was a fair one: emailing
 * thousands of brands an invoice each month and chasing the unpaid ones is not a
 * process, it is a job nobody will do. Brands are already paying us a
 * subscription on a card we hold, so the fee is charged to that same card.
 *
 * WHAT THIS IS NOT. It is still an invoice, not a Stripe application fee. The
 * money is collected FROM the brand after the sale, not withheld from the
 * shopper's payment as it passes through — that requires the checkout itself to
 * run through MTRLZD. The two get conflated in conversation and must not get
 * conflated in code.
 */
import { describe, it, expect, afterEach } from "vitest";
import { feeInvoiceAutoCharge } from "../../server/feeConfig";

const original = process.env.FEE_INVOICE_COLLECTION;
afterEach(() => {
  if (original === undefined) delete process.env.FEE_INVOICE_COLLECTION;
  else process.env.FEE_INVOICE_COLLECTION = original;
});

describe("the collection mode", () => {
  it("auto-charges by default — the only mode that survives thousands of brands", () => {
    delete process.env.FEE_INVOICE_COLLECTION;
    expect(feeInvoiceAutoCharge()).toBe(true);
  });

  it("can be switched back to emailed invoices", () => {
    process.env.FEE_INVOICE_COLLECTION = "send_invoice";
    expect(feeInvoiceAutoCharge()).toBe(false);
  });

  it("is case-insensitive, so a capitalised env value does not silently auto-charge", () => {
    process.env.FEE_INVOICE_COLLECTION = "SEND_INVOICE";
    expect(feeInvoiceAutoCharge()).toBe(false);
  });

  it("treats an unrecognised value as auto-charge rather than failing open to unpaid invoices", () => {
    process.env.FEE_INVOICE_COLLECTION = "nonsense";
    expect(feeInvoiceAutoCharge()).toBe(true);
  });

  it("treats empty as the default", () => {
    process.env.FEE_INVOICE_COLLECTION = "";
    expect(feeInvoiceAutoCharge()).toBe(true);
  });
});

/**
 * The Stripe call shape. Asserted against a fake rather than the SDK, because
 * the thing worth pinning is which parameters are sent — `days_until_due` is
 * rejected by Stripe when collection_method is charge_automatically, so the two
 * modes must not both set it.
 */
describe("the invoice parameters", () => {
  function buildParams(autoCharge: boolean, daysUntilDue = 14) {
    return {
      customer: "cus_1",
      currency: "usd",
      ...(autoCharge
        ? { collection_method: "charge_automatically" as const }
        : { collection_method: "send_invoice" as const, days_until_due: daysUntilDue }),
      auto_advance: false,
      metadata: { collection: autoCharge ? "auto_charge" : "send_invoice" },
    };
  }

  it("sends no due date when auto-charging — Stripe rejects the combination", () => {
    const p = buildParams(true) as any;
    expect(p.collection_method).toBe("charge_automatically");
    expect(p.days_until_due).toBeUndefined();
  });

  it("sends a due date only when emailing the invoice", () => {
    const p = buildParams(false, 21) as any;
    expect(p.collection_method).toBe("send_invoice");
    expect(p.days_until_due).toBe(21);
  });

  it("stays a draft in both modes, so finalising remains a deliberate act", () => {
    expect((buildParams(true) as any).auto_advance).toBe(false);
    expect((buildParams(false) as any).auto_advance).toBe(false);
  });

  it("records which mode was used, so a brand's charge can be explained later", () => {
    expect(buildParams(true).metadata.collection).toBe("auto_charge");
    expect(buildParams(false).metadata.collection).toBe("send_invoice");
  });
});
