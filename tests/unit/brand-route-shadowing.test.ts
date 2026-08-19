/**
 * A parameterised route must not swallow the literal ones declared after it.
 *
 * ── The bug this exists for ──────────────────────────────────────────────────
 * Express matches routes in declaration order. `/api/brands/:id` was declared
 * at the top of the file and `/api/brands/stats`, `/api/brands/creator-invites`
 * and `/api/brands/invite-offer` far below it, so all three were answered by
 * the id handler with:
 *
 *     {"error":"Brand not found"}   HTTP 404
 *
 * Measured against production. The Brand dashboard's performance panel and the
 * Sent Invitations list were not empty — they were failing, and a failed query
 * renders as zeros, which is indistinguishable from a new account with no data.
 * The client demoed both screens in that state.
 *
 * The guard is a list, and a list rots. This test is the thing that notices.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "../../server/routes.ts"), "utf8");

/**
 * Literal `/api/brands/<segment>` routes, with their METHOD.
 *
 * Method matters: a GET `:id` route cannot shadow `POST /api/brands/invite-creator`.
 * The first version of this test ignored that and flagged two POST routes that
 * were never at risk — a guard that cries wolf gets deleted by whoever is in a
 * hurry, which is exactly when it is needed.
 */
function literalBrandRoutes(): Array<{ method: string; segment: string; at: number }> {
  const out: Array<{ method: string; segment: string; at: number }> = [];
  const re = /app\.(get|post|patch|delete)\("\/api\/brands\/([a-z][a-z0-9-]*)"/g;
  for (const m of SRC.matchAll(re)) {
    out.push({ method: m[1], segment: m[2], at: m.index ?? 0 });
  }
  return out;
}

describe("/api/brands/:id does not eat its siblings", () => {
  const idAt = SRC.indexOf('app.get("/api/brands/:id"');

  it("the id route exists and hands off", () => {
    expect(idAt).toBeGreaterThan(-1);
    const handler = SRC.slice(idAt, idAt + 400);
    expect(handler).toContain("BRAND_LITERAL_ROUTES.includes(req.params.id)");
    expect(handler).toContain("return next()");
  });

  it("every GET literal declared after it is on the hand-off list", () => {
    const listed = SRC.slice(SRC.indexOf("const BRAND_LITERAL_ROUTES"), idAt);
    // Only GET: the parameterised route is a GET, so it can only swallow GETs.
    const shadowed = literalBrandRoutes().filter((r) => r.at > idAt && r.method === "get");
    expect(shadowed.length, "expected the known literal GET routes to be present").toBeGreaterThan(0);

    for (const r of shadowed) {
      expect(listed, `GET /api/brands/${r.segment} is declared after :id and would 404`).toContain(`"${r.segment}"`);
    }
  });

  it("the three known ones are covered", () => {
    const listed = SRC.slice(SRC.indexOf("const BRAND_LITERAL_ROUTES"), idAt);
    for (const seg of ["stats", "creator-invites", "invite-offer"]) {
      expect(listed).toContain(`"${seg}"`);
    }
  });
});
