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

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

// ── Validate required env vars ───────────────────────────────────────────────
const requiredEnvVars = ['DATABASE_URL', 'SESSION_SECRET'];
const optionalEnvVars = ['RESEND_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'STRIPE_SECRET_KEY', 'ADMIN_EMAIL'];
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

// Tight limit on auth to blunt credential-stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  validate: rlValidate,
  message: { error: "Too many attempts. Please try again in a few minutes." },
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
app.use(
  ["/api/auth/login", "/api/auth/register", "/api/auth/resend-verification", "/api/auth/forgot-password", "/api/auth/reset-password"],
  authLimiter,
);

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
    },
  );
})();
