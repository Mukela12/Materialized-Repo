import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
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
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`[FATAL] Missing required environment variable: ${envVar}`);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

const app = express();
const httpServer = createServer(app);

// ── CORS ─────────────────────────────────────────────────────────────────────
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map(s => s.trim()) || [];
app.use(cors({
  origin: corsOrigins.length > 0 ? corsOrigins : true,
  credentials: true,
}));

// ── Session ──────────────────────────────────────────────────────────────────
const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      tableName: "session",
      createTableIfMissing: true,
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
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  registerAuthRoutes(app);
  await registerRoutes(httpServer, app);
  await seedAdminAccount();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
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
