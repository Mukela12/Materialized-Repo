/**
 * Adapts stripeService to the narrow surface server/feeInvoicing.ts needs, so
 * the invoicing logic stays testable against a fake rather than the Stripe SDK.
 *
 * Its own module because both the admin route and the scheduler need it, and
 * importing it from routes.ts into index.ts would be circular.
 */
import { stripeService } from "./stripeService";
import type { FeeInvoiceStripe } from "./feeInvoicing";

export const feeInvoiceStripeAdapter: FeeInvoiceStripe = {
  createInvoice: (a) => stripeService.createFeeInvoice(a) as any,
  createInvoiceItem: (a) => stripeService.createFeeInvoiceItem(a),
  finalizeInvoice: (id) => stripeService.finalizeFeeInvoice(id) as any,
  findInvoiceByFeeInvoiceId: (customerId, feeInvoiceId) =>
    stripeService.findFeeInvoiceByFeeInvoiceId(customerId, feeInvoiceId) as any,
};
