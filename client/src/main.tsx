import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { initSentry } from "./sentry";
import App from "./App";
import "./index.css";

initSentry();

// Wrap the whole app in Sentry's error boundary so React render errors are
// captured. This is the app's first error boundary. When Sentry is not
// initialized (VITE_SENTRY_DSN unset) it still catches render errors and shows
// the fallback, but performs no network I/O — captureException is a no-op.
createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary
    fallback={<div style={{ padding: 24 }}>Something went wrong. Please refresh.</div>}
  >
    <App />
  </Sentry.ErrorBoundary>,
);
