/**
 * The app's own page-view counter, read by the admin Activity tab.
 *
 * Two random ids, both kept by this browser and nothing else: a visitor id that
 * lasts, and a session id that renews after 30 minutes without a page. They
 * are what let the admin see "12 people opened a code link, 3 made an account"
 * without any third-party analytics. The server adds who is signed in, if
 * anyone; it never sees an IP address in what it stores.
 */
import { useEffect } from "react";

const VISITOR_KEY = "mtrlzd-vid";
const SESSION_KEY = "mtrlzd-sid";
const IDLE_MS = 30 * 60 * 1000;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) { id = newId(); localStorage.setItem(VISITOR_KEY, id); }
    return id;
  } catch {
    return newId();
  }
}

function sessionId(): string {
  const now = Date.now();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const [id, last] = raw ? raw.split("|") : [];
    const fresh = id && now - Number(last) < IDLE_MS ? id : newId();
    sessionStorage.setItem(SESSION_KEY, `${fresh}|${now}`);
    return fresh;
  } catch {
    return newId();
  }
}

function device(): "mobile" | "tablet" | "desktop" {
  const w = window.innerWidth;
  return w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop";
}

let lastSent = "";

/** A browser that asks not to be tracked is not counted, and gets no ids. */
function optedOut(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.globalPrivacyControl === true || n.doNotTrack === "1";
}

export function sendPageView(path: string): void {
  if (typeof window === "undefined" || path === lastSent || optedOut()) return;
  lastSent = path;
  const params = new URLSearchParams(window.location.search);
  // Only another site counts as a referrer; moving around the app is not one.
  const ref = document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : "";
  const body = JSON.stringify({
    visitorId: visitorId(),
    sessionId: sessionId(),
    path,
    referrer: ref,
    device: device(),
    code: params.get("code") ?? undefined,
  });
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/activity", blob)) return;
  } catch { /* fall through */ }
  fetch("/api/activity", {
    method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "include", keepalive: true,
  }).catch(() => {});
}

/** One page view per route the person actually lands on. */
export function usePageViews(location: string): void {
  useEffect(() => {
    // The app lower-cases mixed-case addresses with a redirect; count the result.
    if (location !== location.toLowerCase()) return;
    sendPageView(location);
  }, [location]);
}
