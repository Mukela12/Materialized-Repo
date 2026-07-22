/**
 * DocuSign eSignature REST integration (JWT Grant auth).
 *
 * Env-gated and lazily configured: reads all config from `process.env` at call
 * time and NEVER throws at import time. When the DOCUSIGN_* vars are absent, the
 * caller (docusignHelper) falls back to the existing static signing link, so the
 * feature is entirely opt-in with zero regression.
 *
 * Only three DocuSign calls are needed, so we use native `fetch` + `node:crypto`
 * plus `jsonwebtoken` for the RS256 assertion — matching the lightweight
 * fetch/error-handling style of shopifyService/woocommerceService rather than
 * pulling in the heavy `docusign-esign` SDK.
 */
import jwt from "jsonwebtoken";

interface DocuSignConfig {
  integrationKey: string;
  userId: string;
  accountId: string;
  privateKey: string;
  baseUrl: string;
  authHost: string;
  templateId?: string;
}

/**
 * True only when every credential DocuSign JWT Grant needs is present. Mirrors
 * `isEmailConfigured()` — callers branch on this to decide real-envelope vs
 * static-link mode. DOCUSIGN_BASE_URL and DOCUSIGN_TEMPLATE_ID are optional.
 */
export function isDocuSignConfigured(): boolean {
  return !!(
    process.env.DOCUSIGN_INTEGRATION_KEY &&
    process.env.DOCUSIGN_USER_ID &&
    process.env.DOCUSIGN_ACCOUNT_ID &&
    process.env.DOCUSIGN_PRIVATE_KEY
  );
}

/**
 * Resolve config from env. The auth host is derived from the base URL: DocuSign's
 * demo/sandbox environment authenticates at account-d.docusign.com, production at
 * account.docusign.com. DOCUSIGN_BASE_URL defaults to the demo REST host.
 * Throws if called while unconfigured — callers gate on isDocuSignConfigured().
 */
function getConfig(): DocuSignConfig {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const rawPrivateKey = process.env.DOCUSIGN_PRIVATE_KEY;

  if (!integrationKey || !userId || !accountId || !rawPrivateKey) {
    throw new Error("DocuSign is not configured");
  }

  const baseUrl = (process.env.DOCUSIGN_BASE_URL ?? "https://demo.docusign.net").replace(/\/$/, "");
  // Demo/sandbox REST hosts (demo.docusign.net) authenticate at account-d.docusign.com;
  // everything else is treated as production (account.docusign.com).
  const isDemo = /demo\.docusign\.net/i.test(baseUrl);
  const authHost = isDemo ? "account-d.docusign.com" : "account.docusign.com";

  // Env-stored PEMs commonly arrive with literal "\n" sequences instead of real
  // newlines; restore them so the RSA key parses.
  const privateKey = rawPrivateKey.replace(/\\n/g, "\n");

  return {
    integrationKey,
    userId,
    accountId,
    privateKey,
    baseUrl,
    authHost,
    templateId: process.env.DOCUSIGN_TEMPLATE_ID || undefined,
  };
}

/**
 * Build the RS256 JWT assertion DocuSign exchanges for an access token.
 * Claims: iss=integration key, sub=impersonated user, aud=auth host,
 * scope "signature impersonation", exp within 1h (DocuSign's max).
 */
export function mintJwtAssertion(): string {
  const config = getConfig();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: config.integrationKey,
    sub: config.userId,
    aud: config.authHost,
    iat: now,
    exp: now + 3600, // 1 hour — DocuSign's maximum assertion lifetime
    scope: "signature impersonation",
  };
  return jwt.sign(payload, config.privateKey, { algorithm: "RS256" });
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Obtain an OAuth access token via the JWT Bearer grant, cached in-module until
 * ~60s before it expires (same spirit as stripeClient's cached credentials).
 * Throws a typed error on non-2xx so the caller can fall back to the static link;
 * the common first-run failure is `consent_required` (grant admin consent once).
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  const config = getConfig();
  const assertion = mintJwtAssertion();

  const response = await fetch(`https://${config.authHost}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DocuSign token error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  cachedToken = {
    accessToken: data.access_token,
    // Refresh 60s early to avoid using a token that expires mid-request.
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };
  return cachedToken.accessToken;
}

/** Reset the cached access token — used by tests to isolate runs. */
export function __resetDocuSignTokenCache(): void {
  cachedToken = null;
}

/**
 * The default inline agreement rendered when no DOCUSIGN_TEMPLATE_ID is set.
 * A minimal HTML document with an anchor string ("**signature**") that the
 * signHere tab binds to, so the signature box lands in a predictable spot.
 */
function defaultAgreementDocumentBase64(brandName: string, signerName: string): string {
  const html = `<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
    <h1>Materialized Brand Agreement</h1>
    <p>This agreement is entered into between Materialized and <strong>${brandName}</strong>.</p>
    <p>
      By signing below, ${signerName} authorises the featured video to be made
      shoppable with ${brandName} products under the Materialized marketplace terms,
      including the agreed commission split on attributed sales.
    </p>
    <p>Signature: <span style="color:white;">**signature**</span></p>
  </body>
</html>`;
  return Buffer.from(html, "utf8").toString("base64");
}

export interface CreateEnvelopeOptions {
  signerName: string;
  signerEmail: string;
  /** Ties the recipient to an embedded (in-app) signing session; any stable id. */
  clientUserId: string;
  /** Where DocuSign redirects the signer's browser after the ceremony. */
  returnUrl: string;
  /** Optional email subject / brand for the inline document copy. */
  emailSubject?: string;
  brandName?: string;
}

export interface CreateEnvelopeResult {
  envelopeId: string;
  signingUrl: string;
}

/**
 * Create a sent envelope for embedded signing and return a short-lived recipient
 * view (signing) URL. Uses DOCUSIGN_TEMPLATE_ID + templateRoles when set,
 * otherwise an inline default agreement document with a signHere tab.
 *
 * Two REST calls: POST .../envelopes then POST .../envelopes/{id}/views/recipient.
 * Any non-2xx throws `DocuSign ... (status): body`, exactly like shopifyService.
 */
export async function createEnvelopeSigningUrl(
  opts: CreateEnvelopeOptions,
): Promise<CreateEnvelopeResult> {
  const config = getConfig();
  const accessToken = await getAccessToken();
  const apiBase = `${config.baseUrl}/restapi/v2.1/accounts/${config.accountId}`;
  const emailSubject = opts.emailSubject ?? "Please sign the Materialized Brand Agreement";
  const brandName = opts.brandName ?? "the brand";

  // Build the envelope definition: template-based when a template id is provided,
  // otherwise an inline document with an anchored signHere tab. Either way the
  // recipient carries a clientUserId, which is what makes signing *embedded*.
  const envelopeDefinition: any = config.templateId
    ? {
        templateId: config.templateId,
        templateRoles: [
          {
            email: opts.signerEmail,
            name: opts.signerName,
            roleName: "Signer",
            clientUserId: opts.clientUserId,
          },
        ],
        status: "sent",
      }
    : {
        emailSubject,
        documents: [
          {
            documentBase64: defaultAgreementDocumentBase64(brandName, opts.signerName),
            name: "Materialized Brand Agreement",
            fileExtension: "html",
            documentId: "1",
          },
        ],
        recipients: {
          signers: [
            {
              email: opts.signerEmail,
              name: opts.signerName,
              recipientId: "1",
              clientUserId: opts.clientUserId,
              tabs: {
                signHereTabs: [
                  {
                    anchorString: "**signature**",
                    anchorUnits: "pixels",
                    anchorXOffset: "0",
                    anchorYOffset: "-6",
                  },
                ],
              },
            },
          ],
        },
        status: "sent",
      };

  const createRes = await fetch(`${apiBase}/envelopes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(envelopeDefinition),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`DocuSign envelope error (${createRes.status}): ${text}`);
  }

  const envelope = await createRes.json();
  const envelopeId: string = envelope.envelopeId;
  if (!envelopeId) {
    throw new Error(`DocuSign envelope error: no envelopeId in response ${JSON.stringify(envelope)}`);
  }

  // Recipient view: the embedded signing URL. clientUserId / email / userName
  // MUST match the recipient on the envelope, or DocuSign rejects the request.
  const viewRes = await fetch(`${apiBase}/envelopes/${envelopeId}/views/recipient`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      returnUrl: opts.returnUrl,
      authenticationMethod: "none",
      email: opts.signerEmail,
      userName: opts.signerName,
      clientUserId: opts.clientUserId,
    }),
  });

  if (!viewRes.ok) {
    const text = await viewRes.text();
    throw new Error(`DocuSign recipient view error (${viewRes.status}): ${text}`);
  }

  const view = await viewRes.json();
  if (!view.url) {
    throw new Error(`DocuSign recipient view error: no url in response ${JSON.stringify(view)}`);
  }

  return { envelopeId, signingUrl: view.url };
}
