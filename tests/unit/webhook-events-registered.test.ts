/**
 * Every event the server handles must be registered with Stripe.
 *
 * ── The asymmetry that makes this dangerous ──────────────────────────────────
 * An event REGISTERED but not handled is noise: it arrives, hits the `default`
 * branch, and nothing happens. Harmless.
 *
 * An event HANDLED but not registered is a feature that silently does not
 * exist. Stripe never sends it, so the handler never runs, and there is no
 * error anywhere — not in the logs, not in the dashboard, not in the database.
 * The only evidence is money in the wrong place, found later.
 *
 * ── How this was found ───────────────────────────────────────────────────────
 * The list of events was written out by hand, by reading the switch in
 * dispatchStripeEvent. `transfer.reversed` is handled ABOVE that switch, in an
 * early-return before it — so it was not in the list, and the refund clawback
 * path could never have fired. A reversed transfer would have left the
 * commission standing and the money paid out.
 *
 * Hand-transcribing one list from another is the whole problem. This reads both
 * from source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HANDLERS = readFileSync(join(__dirname, "../../server/webhookHandlers.ts"), "utf8");
const SCRIPT = readFileSync(join(__dirname, "../../script/setup-live-webhook.ts"), "utf8");

/** Only the dispatcher — handler bodies mention event names in comments. */
function dispatchBody(): string {
  const start = HANDLERS.indexOf("export async function dispatchStripeEvent");
  expect(start, "dispatchStripeEvent not found").toBeGreaterThan(-1);
  return HANDLERS.slice(start);
}

/**
 * Event names the dispatcher acts on: `case 'x':` in the switch AND the
 * `eventType === 'x'` comparisons in the early-return above it. Missing the
 * second kind is exactly the bug this file exists for.
 */
function handledEvents(): string[] {
  const body = dispatchBody();
  const cases = [...body.matchAll(/case\s+'([a-z_]+\.[a-z_.]+)'/g)].map((m) => m[1]);
  const guards = [...body.matchAll(/eventType\s*===\s*'([a-z_]+\.[a-z_.]+)'/g)].map((m) => m[1]);
  return [...new Set([...cases, ...guards])];
}

/** The names in the EVENTS array the setup script registers. */
function registeredEvents(): string[] {
  const start = SCRIPT.indexOf("const EVENTS = [");
  const body = SCRIPT.slice(start, SCRIPT.indexOf("] as const;", start));
  return [...body.matchAll(/"([a-z_]+\.[a-z_.]+)"/g)].map((m) => m[1]);
}

/**
 * Matched defensively in the dispatcher but NOT registerable with Stripe — it
 * is not a real event type in the current API, so asking for it is rejected.
 */
const NOT_REGISTERABLE = new Set(["transfer.failed"]);

describe("the registered event list", () => {
  it("finds both lists, so this cannot pass by reading nothing", () => {
    expect(handledEvents().length).toBeGreaterThan(8);
    expect(registeredEvents().length).toBeGreaterThan(8);
  });

  it("registers every event the dispatcher handles", () => {
    const registered = new Set(registeredEvents());
    const missing = handledEvents()
      .filter((e) => !NOT_REGISTERABLE.has(e))
      .filter((e) => !registered.has(e));
    expect(
      missing,
      `handled but never registered — these silently never fire: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("includes the clawback event that was missed, by name", () => {
    // Named explicitly: it is handled in an early return rather than the
    // switch, so a future refactor of the regex above must not lose it.
    expect(handledEvents()).toContain("transfer.reversed");
    expect(registeredEvents()).toContain("transfer.reversed");
  });

  it("does not ask Stripe for an event type it will reject", () => {
    for (const e of registeredEvents()) {
      expect(NOT_REGISTERABLE.has(e), `${e} is not registerable`).toBe(false);
    }
  });

  it("registers nothing twice — a duplicate is a rejected API call", () => {
    const all = registeredEvents();
    expect(new Set(all).size).toBe(all.length);
  });
});
