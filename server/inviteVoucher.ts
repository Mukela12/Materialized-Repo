/**
 * The voucher that makes a brand's invitation true.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 * The invitation email promised "subscription-free use until 31 October" and
 * linked to a bare /register. No code, no token. So a creator read the promise,
 * signed up, and met a $149 "choose your plan" prompt. Every brand using the
 * invite button sent that contradiction in writing to someone they were trying
 * to recruit.
 *
 * ── Why minting per invite, rather than a pool ───────────────────────────────
 * A pool means somebody tops it up, and the failure when it empties is an
 * invitation that silently stops granting anything — the same class of bug,
 * reintroduced. Minting per invite also makes attribution free: the voucher
 * carries the inviting brand, so a creator who joins is traceable to the brand
 * that brought them without a separate mechanism.
 *
 * ── Why there is a cap ───────────────────────────────────────────────────────
 * Free access is the product. Without a ceiling, any brand account can mint
 * unlimited free creator accounts by sending invitations, which undoes the
 * controlled distribution the client built the voucher system for in the first
 * place. The cap is deliberately generous and configurable rather than clever.
 */

/**
 * When invite vouchers stop working, matching the copy in the invitation.
 *
 * 05:00 UTC the following day is the same convention as the festival batches:
 * end of the stated day everywhere in the UK and US, rather than cutting New
 * York off at 20:00 on its last day.
 */
export function inviteOfferEnd(): Date {
  const configured = process.env.INVITE_OFFER_END;
  if (configured) {
    const d = new Date(configured);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date("2026-11-01T05:00:00Z");
}

/** How many invite vouchers one brand may mint. Generous, configurable, finite. */
export function inviteCapPerBrand(): number {
  const raw = Number(process.env.INVITE_VOUCHER_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
}

/** Groups every voucher a brand minted through invitations, for counting and admin. */
export function inviteBatchId(brandId: string): string {
  return `invite:${brandId}`;
}

/**
 * The voucher an invitation carries.
 *
 * Single-use and creator-only: an invitation is for one named person, and a
 * code that opened a Brand or Publisher seat would hand out the paid tiers.
 */
export function inviteVoucherFields(args: {
  code: string;
  brandId: string;
  brandName: string;
  creatorEmail: string;
  invitedByUserId: string | null;
}) {
  return {
    code: args.code,
    label: `Invitation — ${args.brandName}`.slice(0, 200),
    grantType: "free_access" as const,
    brandUserId: null,
    roleRestriction: "creator",
    maxRedemptions: 1,
    activeFrom: null,
    expiresAt: inviteOfferEnd(),
    createdBy: args.invitedByUserId,
    batchId: inviteBatchId(args.brandId),
    assignedTo: args.creatorEmail.slice(0, 200),
    partner: args.brandName.slice(0, 200),
  };
}
