import * as Sentry from "@sentry/react";

// Env-gated Sentry initialization for the frontend.
//
// VITE_SENTRY_DSN is inlined by Vite at build time. When it is unset, the
// `if (!dsn) return` short-circuits and Sentry.init becomes dead code the
// minifier can drop — no runtime cost, no network I/O.

// Single-use tokens live in URL path segments and query params
// (/reset-password/:token, /verify-email/:token, /brand-authorize/:token,
// /api/brand-outreach/authorize/:token, /affiliate/accept/:token &
// /api/affiliates/accept/:token). A leaked token is an account-takeover vector,
// so redact them before an event leaves the browser. Defensive: never throws,
// and no-ops on non-string / missing input.
const TOKEN_PATH_RE =
  /(\/(?:reset-password|verify-email|brand-authorize|authorize|accept)\/)[^/?#]+/g;
const TOKEN_QUERY_RE = /((?:access_token|token|code)=)[^&#]*/gi;

function redactUrl(url: string): string {
  return url.replace(TOKEN_PATH_RE, "$1:token").replace(TOKEN_QUERY_RE, "$1:redacted");
}

function redactMaybe<T>(value: T): T {
  return typeof value === "string" ? (redactUrl(value) as unknown as T) : value;
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // NO-OP when unset (Vite tree-shakes)
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    tracesSampleRate: 0, // errors only, no perf
    sendDefaultPii: false, // no IP/emails
    beforeSend(event) {
      // The URL (path + query) carries single-use tokens; redact, never leak.
      if (event.request) {
        if (typeof event.request.url === "string") {
          event.request.url = redactUrl(event.request.url);
        }
        if (typeof event.request.query_string === "string") {
          event.request.query_string = redactUrl(event.request.query_string);
        }
      }
      // Navigation/fetch breadcrumbs record URLs in data.url / data.to / data.from
      // (navigation crumbs put the PRIOR url in data.from) and in the message;
      // redact each one the same way.
      if (Array.isArray(event.breadcrumbs)) {
        for (const crumb of event.breadcrumbs) {
          if (!crumb) continue;
          crumb.message = redactMaybe(crumb.message);
          if (crumb.data) {
            crumb.data.url = redactMaybe(crumb.data.url);
            crumb.data.to = redactMaybe(crumb.data.to);
            crumb.data.from = redactMaybe(crumb.data.from);
          }
        }
      }
      return event;
    },
  });
}

export { Sentry };
