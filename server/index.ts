import { initSentry, Sentry } from "./sentry";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { registerAuthRoutes, seedAdminAccount } from "./authRoutes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { getUncachableStripeClient } from "./stripeClient";
import { dispatchStripeEvent } from "./webhookHandlers";
import Stripe from 'stripe';
import { Scheduler } from "./scheduler";
import { makePayoutJob, makeFeeInvoiceJob, schedulerEnabled } from "./scheduledJobs";
import { runPayouts } from "./payoutRunner";
import { feeInvoiceStripeAdapter } from "./feeInvoiceStripe";
import { storage } from "./storage";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

// ── Validate required env vars ───────────────────────────────────────────────
const requiredEnvVars = ['DATABASE_URL', 'SESSION_SECRET'];
const optionalEnvVars = ['RESEND_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'STRIPE_SECRET_KEY', 'ADMIN_EMAIL', 'AI_INTEGRATIONS_GEMINI_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`[FATAL] Missing required environment variable: ${envVar}`);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}
const missing = optionalEnvVars.filter(v => !process.env[v]);
if (missing.length) {
  console.log(`[Config] Optional env vars not set: ${missing.join(', ')} — some features will be disabled`);
}

/**
 * Say out loud which Stripe mode this process is in, and refuse the one
 * combination that is silently, expensively wrong.
 *
 * Stripe's test and live modes are separate object spaces with separate webhook
 * endpoints and separate secrets. The dangerous failure is not a loud error, it
 * is silence: a live secret key paired with a test webhook secret means real
 * cards are charged while every webhook fails signature verification, so no
 * subscription is ever recorded, nobody is granted access, and nothing in the
 * app reports a problem. Refusing to boot is far cheaper than discovering that
 * from customers.
 *
 * The publishable key is the cross-check because it carries the same mode
 * prefix and is the one value that cannot be mismatched by accident without
 * also being wrong for the client.
 */
const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (stripeSecret) {
  const isLive = stripeSecret.startsWith('sk_live');
  const pk = process.env.STRIPE_PUBLISHABLE_KEY;

  if (pk && isLive !== pk.startsWith('pk_live')) {
    console.error(
      `[FATAL] Stripe key mode mismatch: secret key is ${isLive ? 'LIVE' : 'TEST'} ` +
      `but publishable key is ${pk.startsWith('pk_live') ? 'LIVE' : 'TEST'}. ` +
      `Set both from the same Stripe mode.`,
    );
    process.exit(1);
  }

  console.log(
    `[Stripe] ${isLive ? 'LIVE MODE — real money' : 'TEST MODE — no real money moves'}`,
  );
}

// Initialize Sentry as early as possible so its Node instrumentation and the
// global unhandledRejection/uncaughtException handlers attach before the app
// handles traffic. Hard no-op when SENTRY_DSN is unset (see server/sentry.ts).
initSentry();

const app = express();
const httpServer = createServer(app);

// Trust proxy (Railway is behind a reverse proxy, and Vercel proxies API calls)
app.set("trust proxy", 1);

// ── Security headers ─────────────────────────────────────────────────────────
// CSP/frameguard/COEP are disabled because the app serves its own SPA and, more
// importantly, a shoppable video player + widget.js that are meant to be embedded
// on third-party sites cross-origin. Everything else (HSTS, nosniff, referrer
// policy, etc.) is applied.
// NOTE: If Content-Security-Policy is ever enabled here, `connect-src` must
// include the Sentry ingest host (e.g. `*.sentry.io` and the project-specific
// ingest domain) or browser-side error reporting will be blocked.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    frameguard: false,
  }),
);

// ── Rate limiting ────────────────────────────────────────────────────────────
// Key on the originating client IP (leftmost X-Forwarded-For) so that traffic
// proxied through Vercel/Railway isn't all bucketed under one proxy IP.
const clientIp = (req: Request) => {
  const xff = req.headers["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : (xff || "").split(",")[0].trim();
  return first || req.ip || "unknown";
};
const rlValidate = { trustProxy: false, xForwardedForHeader: false } as const;

/**
 * Credential-stuffing / brute-force protection.
 *
 * WHY THIS IS KEYED ON THE ACCOUNT, NOT THE IP
 *   Measured against production on 4 Aug 2026: requests arriving through
 *   www.mtrlzd.com do NOT carry a stable client IP. Vercel rewrites /api/* to
 *   Railway as a fresh outbound request and does not forward the caller's
 *   address (the same reason x-vercel-ip-country never arrives, and the reason
 *   viewer hashing had to move — see server/viewerIdentity.ts). Five identical
 *   logins through Vercel returned remaining 49, 49, 48, 48, 49; the same five
 *   sent straight to Railway returned 49, 48, 47, 46, 45.
 *
 *   So an IP-keyed limiter is close to useless on the path real users take: an
 *   attacker's attempts scatter across Vercel's egress addresses. Keying on the
 *   targeted EMAIL instead protects the thing actually under attack, and holds
 *   regardless of how many addresses the attacker has.
 *
 *   The IP limiter is kept as well. It is not redundant — it still bites on
 *   direct-to-Railway traffic, which is exactly the path someone bypassing the
 *   front end would use.
 *
 * WHY SUCCESSFUL REQUESTS ARE NOT COUNTED
 *   Brute force is a burst of FAILURES. Legitimate load — a demo room, a launch,
 *   a busy morning — is a burst of successes. Counting only failures means a
 *   hundred people signing in normally consume nothing, while a hundred wrong
 *   passwords for one account still trip at the tenth.
 *
 *   Deliberately NOT applied to the email-sending routes below: for
 *   forgot-password and resend-verification a *successful* request is the abuse
 *   (mailbombing someone), so those must count every call.
 */
const emailKey = (req: Request) => {
  const raw = (req.body?.email ?? "").toString().trim().toLowerCase();
  return raw || clientIp(req);
};

/** Per-account: a wrong password for one email, from anywhere. */
const accountAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailKey,
  validate: rlValidate,
  skipSuccessfulRequests: true,
  message: { error: "Too many failed attempts for this account. Please try again in a few minutes." },
});

/** Per-IP, failures only. Defence in depth; effective on direct traffic. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  validate: rlValidate,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

/**
 * Email-sending routes. Every call counts, successes included, because a
 * successful request here puts mail in someone else's inbox.
 */
const emailSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailKey,
  validate: rlValidate,
  message: { error: "Too many requests for this address. Please try again in a few minutes." },
});
// Generous global API limit — a floor against floods, never trips for real use.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  validate: rlValidate,
  skip: (req) => !req.path.startsWith("/api") || req.path.startsWith("/api/webhooks"),
});
app.use(apiLimiter);
// NOTE: the auth limiters are registered AFTER express.json() further down —
// they key on req.body.email, which does not exist until the body is parsed.

// ── CORS ─────────────────────────────────────────────────────────────────────
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [];
app.use(cors({
  origin: corsOrigins.length > 0 ? corsOrigins : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret'],
}));

// ── Session ──────────────────────────────────────────────────────────────────
const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      tableName: "session",
      createTableIfMissing: false,
    }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      // No `domain` — the cookie stays host-only, so a session is valid on
      // exactly the host that issued it. That is the posture we want, but it
      // only holds together because ONE host is canonical.
      //
      // Both mtrlzd.com and www.mtrlzd.com used to serve the app with a 200 and
      // no redirect between them, which made them two separate cookie jars:
      // signing in on one left you signed out on the other, with no error and
      // no way for the user to tell why. vercel.json now 308s the apex to www,
      // which is also the host Stripe posts webhooks to (docs/LIVE_CUTOVER.md).
      //
      // Do NOT "fix" a future recurrence by setting domain: ".mtrlzd.com" —
      // that shares the session with every present and future subdomain,
      // including previews and staging. Keep it host-only; keep www canonical.
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// ── Stripe Initialization (optional — gracefully skip if not configured) ─────
async function initStripe() {
  if (!process.env.STRIPE_SECRET_KEY && !process.env.REPLIT_CONNECTORS_HOSTNAME) {
    console.log("[Stripe] No Stripe credentials found, skipping initialization");
    return;
  }

  try {
    console.log("[Stripe] Initializing...");
    const client = await getUncachableStripeClient();
    console.log("[Stripe] Client ready");
  } catch (error) {
    console.error("[Stripe] Failed to initialize:", error);
  }
}

initStripe();

// ── Stripe webhook: POST /api/webhooks/stripe ────────────────────────────────
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn(
    '[Stripe] STRIPE_WEBHOOK_SECRET is not set. The /api/webhooks/stripe endpoint will ' +
    'reject all incoming events.'
  );
}

app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("[Stripe] STRIPE_WEBHOOK_SECRET is not set. Rejecting event.");
      return res.status(400).json({ error: "Webhook secret not configured" });
    }
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature header" });
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;
    let event: Stripe.Event;
    try {
      const stripeInstance = await getUncachableStripeClient();
      event = stripeInstance.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Stripe] Webhook signature verification failed:", message);
      return res.status(400).json({ error: `Signature verification failed: ${message}` });
    }

    try {
      await dispatchStripeEvent(event);
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Stripe] Error dispatching webhook event:", message);
      res.status(400).json({ error: "Webhook handler error" });
    }
  }
);

app.use(
  express.json({
    // base64-encoded PDFs/images (e.g. brand-guideline uploads) are sent in the
    // JSON body and routinely exceed the body-parser default of 100kb; raise the
    // ceiling so those requests reach the handler instead of failing with 413.
    limit: "25mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

/**
 * Auth rate limiting — registered HERE, after the body parsers, not up with the
 * other middleware.
 *
 * accountAuthLimiter and emailSendLimiter key on req.body.email. Mounted before
 * express.json() that property does not exist yet, so every request would fall
 * through to the IP key and the per-account protection would silently do
 * nothing — the precise failure this design exists to avoid, and invisible
 * because the limiter still appears to work.
 */

// Sign-in and sign-up: failures only, capped per account and per IP. A room full
// of people signing in successfully consumes neither budget.
app.use(["/api/auth/login", "/api/auth/register"], accountAuthLimiter, authLimiter);

// Anything that sends mail to an address the caller typed: count every request.
app.use(
  ["/api/auth/resend-verification", "/api/auth/forgot-password", "/api/auth/reset-password"],
  emailSendLimiter,
  authLimiter,
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  // Attach session user id (only) to Sentry scope so captured errors are
  // attributable. Uses req.session.userId — never req.user.email — to keep PII
  // out. Guarded so it is free when Sentry is off.
  if (process.env.SENTRY_DSN && req.session?.userId) {
    Sentry.setUser({ id: req.session.userId });
  }
  // Log method/path/status/duration only — never response bodies (they contain
  // PII, tokens, and secrets).
  res.on("finish", () => {
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`);
    }
  });
  next();
});

(async () => {
  registerAuthRoutes(app);
  await registerRoutes(httpServer, app);
  await seedAdminAccount();

  // Sentry's Express error handler must run BEFORE the terminal custom handler
  // below. It reports errors passed to next(err) / thrown in handlers to Sentry
  // and then delegates to the next error handler, so the existing handler still
  // logs and sends the JSON response. No-op when SENTRY_DSN is unset.
  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    // Log server-side and respond — do NOT re-throw (that crashed the request).
    console.error(`[error] ${status} ${message}`);
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      startScheduler();
    },
  );
})();

/**
 * Bring up the payout + invoicing scheduler, if it has been switched on.
 *
 * OFF UNLESS SCHEDULER_ENABLED=true. Automated money movement should be enabled
 * once, deliberately, by someone who means it — never acquired as a side effect
 * of a deploy. When it is off this logs that fact rather than staying silent, so
 * "why did nobody get paid" has an answer in the logs.
 *
 * Safe to start on every instance: each schedule occurrence is claimed as a row
 * under a unique index, so exactly one instance runs it. See server/scheduler.ts.
 */
function startScheduler() {
  if (!schedulerEnabled()) {
    log("[Scheduler] disabled (set SCHEDULER_ENABLED=true to enable payouts + fee invoicing)");
    return;
  }
  try {
    const scheduler = new Scheduler(storage, [
      makePayoutJob({ runPayouts }),
      makeFeeInvoiceJob(storage as any, feeInvoiceStripeAdapter),
    ], (m) => log(m));
    scheduler.start();
  } catch (err) {
    // A bad cron expression must not take the API down with it.
    console.error("[Scheduler] failed to start:", err);
  }
}
