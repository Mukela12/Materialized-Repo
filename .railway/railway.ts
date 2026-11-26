import { defineRailway, github, preserve, project, service } from "railway/iac";

// Railway settings for the MTRLZD backend, moved here from railway.toml when
// Railway retired Config as Code (cutoff 2026-12-01).
//
// Railway does not read this file during a deploy. It is applied by hand:
//
//   npm install --no-save railway   (the SDK this file imports)
//   railway config plan             (read-only preview)
//   railway config apply            (writes the settings to the service)
//
// Always read the plan before applying. It must show no "Delete" lines.
//
// This file owns the backend service only. The named partial below keeps the
// Postgres database and its volumes out of it, so an apply cannot change or
// delete them.
export const partial = "backend";

export default defineRailway(() => {
  const backend = service("backend", {
    source: github("Mukela12/Materialized-Repo", { checkSuites: false, rootDirectory: "/" }),
    replicas: { "asia-southeast1-eqsg3a": 1 },
    // Names only. preserve() keeps whatever value is set in Railway, so no
    // value is ever written to this public repo. Every variable on the
    // service must be listed: one that is missing here is DELETED by the
    // next apply. After adding a variable in the Railway dashboard, add its
    // name here too. `railway config plan` lists any name that is missing as
    // a "Delete variable" line.
    env: {
      ACCESS_CODE: preserve(),
      ADMIN_EMAIL: preserve(),
      ADMIN_PASSWORD: preserve(),
      BUNNY_API_KEY: preserve(),
      BUNNY_LIBRARY_ID: preserve(),
      BUNNY_STREAM_API_KEY: preserve(),
      BUNNY_STREAM_HOST: preserve(),
      BUNNY_WEBHOOK_TOKEN: preserve(),
      CLOUDINARY_API_KEY: preserve(),
      CLOUDINARY_API_SECRET: preserve(),
      CLOUDINARY_CLOUD_NAME: preserve(),
      CORS_ORIGINS: preserve(),
      DATABASE_URL: preserve(),
      ENCRYPTION_KEY: preserve(),
      FEE_INVOICE_CRON: preserve(),
      GEMINI_API_KEY: preserve(),
      NODE_ENV: preserve(),
      PAYOUT_CRON: preserve(),
      PLATFORM_CURRENCY: preserve(),
      PORT: preserve(),
      RESEND_API_KEY: preserve(),
      RESEND_FROM_EMAIL: preserve(),
      SCHEDULER_ENABLED: preserve(),
      SEED_ADMIN_ACCOUNT: preserve(),
      SESSION_SECRET: preserve(),
      STRIPE_PUBLISHABLE_KEY: preserve(),
      STRIPE_SECRET_KEY: preserve(),
      STRIPE_WEBHOOK_SECRET: preserve(),
      STRIPE_WEBHOOK_SECRET_CONNECT: preserve(),
      // WINK hotels (26 Nov 2026). Test-site values until WINK_ENV=production
      // is set with live-site keys; see server/integrations/wink/winkHotels.ts.
      WINK_ACCOUNT_ID: preserve(),
      WINK_CLIENT_ID: preserve(),
      WINK_CLIENT_SECRET: preserve(),
      WINK_CUSTOMIZATION_ID: preserve(),
    },
    build: {
      // Nixpacks, not Railway's default Railpack: nixpacks.toml at the repo
      // root adds ffmpeg, which detection frame sampling needs
      // (server/ffmpegFrames.ts).
      builder: "NIXPACKS",
      // --include=dev is load-bearing. NODE_ENV=production is set on this
      // service (it gates the dev-only Stripe routes and the Secure cookie
      // flag, so it must stay), and under that npm install SKIPS
      // devDependencies. The build needs several of them: vite.config.ts
      // imports @vitejs/plugin-react, and the build script runs through tsx,
      // so without the flag the client build dies with ERR_MODULE_NOT_FOUND.
      //
      // This failed intermittently rather than always, which is why it went
      // unnoticed: nixpacks caches the node_modules layer, so builds succeeded
      // while a cache populated by an earlier (dev-deps present) install
      // survived, and failed whenever that cache was invalidated. Three
      // failures on 3 Aug and two on 4 Aug interleaved with successes, from
      // commits that never touched package.json.
      buildCommand: "npm install --include=dev && npm run build",
    },
    deploy: {
      startCommand: "node dist/index.cjs",
      // On failure is Railway's default, and Railway does not store a default,
      // so `railway config plan` keeps showing this one line as a change
      // (null -> "ON_FAILURE") even after an apply. It is harmless: the
      // service restarts on failure either way, up to the 3 retries below.
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
  });

  return project("video-commerce-engine", {
    resources: [backend],
  });
});
