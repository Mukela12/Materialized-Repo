/**
 * Graceful bridge between the brand-agreement routes and the DocuSign service.
 *
 * `resolveSigningUrl` is the single non-regression point: when DocuSign is
 * unconfigured OR any envelope/token/consent error occurs, it returns the EXACT
 * static link used today. Only when creds are present AND the API succeeds does
 * it return a real per-recipient embedded signing URL (and persist the envelope
 * id + agreementStartedAt).
 */
import { storage } from "./storage";
import type { BrandOutreach } from "@shared/schema";
import {
  isDocuSignConfigured,
  createEnvelopeSigningUrl,
} from "./integrations/docusignService";

/**
 * The current static fallback link — byte-identical to the two inline call sites
 * this helper replaces (routes.ts authorize + follow-up handlers).
 */
export function staticFallbackUrl(): string {
  return process.env.DOCUSIGN_SIGNING_URL ?? "https://app.docusign.com/templates";
}

/**
 * Return a signing URL for a brand-outreach agreement.
 *
 * - DocuSign unconfigured → the static fallback link (today's behavior).
 * - DocuSign configured → attempt a real embedded envelope; on ANY error, log and
 *   fall back to the static link (never throws, never blocks the email).
 *
 * `returnUrl` is where DocuSign redirects the signer after completion — the
 * sign-complete callback route.
 */
export async function resolveSigningUrl(
  outreach: BrandOutreach,
  returnUrl: string,
): Promise<string> {
  if (!isDocuSignConfigured()) {
    return staticFallbackUrl();
  }

  try {
    const { envelopeId, signingUrl } = await createEnvelopeSigningUrl({
      signerName: outreach.prContactName,
      signerEmail: outreach.prContactEmail,
      // A stable per-recipient id ties the recipient to the embedded ceremony.
      clientUserId: outreach.id,
      returnUrl,
      emailSubject: `Please sign the Materialized Brand Agreement — ${outreach.brandName}`,
      brandName: outreach.brandName,
    });

    // Persist the envelope id + mark the agreement as started. Best-effort: a
    // storage hiccup must not lose the already-valid signing URL.
    try {
      await storage.updateBrandOutreachAdmin(outreach.id, {
        agreementStartedAt: new Date(),
      } as any);
      await storage.setBrandOutreachEnvelopeId(outreach.id, envelopeId);
    } catch (persistErr) {
      console.error("[DocuSign] failed to persist envelope id (non-fatal):", persistErr);
    }

    return signingUrl;
  } catch (err) {
    // CRITICAL non-regression path: any DocuSign failure degrades to the exact
    // static link the app used before this integration existed.
    console.error("[DocuSign] envelope creation failed, falling back to static link:", err);
    return staticFallbackUrl();
  }
}
