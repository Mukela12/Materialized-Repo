import * as Sentry from "@sentry/node";

// Idempotent, env-gated Sentry initialization for the backend.
//
// This is a HARD NO-OP when SENTRY_DSN is unset: it returns before Sentry.init
// runs, so no OpenTelemetry instrumentation is installed, no global
// unhandledRejection/uncaughtException handlers are registered, and no HTTP
// patching happens. Importing this module has import cost only.
let started = false;

// Single-use tokens live in URL path segments and query params
// (/reset-password/:token, /verify-email/:token, /brand-authorize/:token,
// /api/brand-outreach/authorize/:token, /api/affiliates/accept/:token). A leaked
// token is an account-takeover vector, so redact them before an event leaves the
// process. Defensive: never throws, and no-ops on non-string / missing input.
const TOKEN_PATH_RE =
  /(\/(?:reset-password|verify-email|brand-authorize|authorize|accept)\/)[^/?#]+/g;
const TOKEN_QUERY_RE = /((?:access_token|token|code)=)[^&#]*/gi;

function redactUrl(url: string): string {
  return url.replace(TOKEN_PATH_RE, "$1:token").replace(TOKEN_QUERY_RE, "$1:redacted");
}

function redactQueryString(qs: string): string {
  return qs.replace(TOKEN_QUERY_RE, "$1:redacted");
}

export function initSentry() {
  if (started || !process.env.SENTRY_DSN) return; // NO-OP when unset
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate: 0, // errors only; no transaction/perf overhead
    sendDefaultPii: false, // never attach IP/cookies/bodies
    beforeSend(event) {
      // Defensively strip anything request-shaped that could carry PII.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        // URLs carry single-use tokens (path + query); redact, never leak.
        if (typeof event.request.url === "string") {
          event.request.url = redactUrl(event.request.url);
        }
        if (typeof event.request.query_string === "string") {
          event.request.query_string = redactQueryString(
            event.request.query_string,
          );
        }
      }
      return event;
    },
  });
  started = true;
}

export { Sentry };
