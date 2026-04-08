import Stripe from 'stripe';

let cachedCredentials: { publishableKey: string; secretKey: string } | null = null;

/**
 * Get Stripe credentials from env vars first, falling back to Replit Connectors if available.
 */
async function getCredentials(): Promise<{ publishableKey: string; secretKey: string }> {
  if (cachedCredentials) return cachedCredentials;

  // Primary: direct env vars
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY) {
    cachedCredentials = {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      secretKey: process.env.STRIPE_SECRET_KEY,
    };
    return cachedCredentials;
  }

  // Fallback: Replit Connectors API (for Replit deployments)
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (hostname) {
    const xReplitToken = process.env.REPL_IDENTITY
      ? 'repl ' + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? 'depl ' + process.env.WEB_REPL_RENEWAL
        : null;

    if (xReplitToken) {
      const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
      const targetEnvironment = isProduction ? 'production' : 'development';

      const url = new URL(`https://${hostname}/api/v2/connection`);
      url.searchParams.set('include_secrets', 'true');
      url.searchParams.set('connector_names', 'stripe');
      url.searchParams.set('environment', targetEnvironment);

      const response = await fetch(url.toString(), {
        headers: {
          'Accept': 'application/json',
          'X_REPLIT_TOKEN': xReplitToken,
        },
      });

      const data = await response.json();
      const settings = data.items?.[0]?.settings;

      if (settings?.publishable && settings?.secret) {
        cachedCredentials = {
          publishableKey: settings.publishable,
          secretKey: settings.secret,
        };
        return cachedCredentials;
      }
    }
  }

  throw new Error(
    'Stripe credentials not found. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY env vars, ' +
    'or run on Replit with Stripe Connector configured.'
  );
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey);
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey(): Promise<string> {
  const { secretKey } = await getCredentials();
  return secretKey;
}
