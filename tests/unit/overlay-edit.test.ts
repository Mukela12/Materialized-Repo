/**
 * Editing an overlay, and the price rule that decides the Buy button.
 *
 * ── Two things the client hit ────────────────────────────────────────────────
 * 1. There was no way to change an existing overlay. Correcting a timestamp
 *    meant deleting it and retyping every field.
 * 2. Her two products had no Buy buttons and nothing said why. The rule — a
 *    price makes it buyable — lived only in the server.
 *
 * ── The bug this exposed ─────────────────────────────────────────────────────
 * The create endpoint derives priceCents from the typed price. The PATCH
 * endpoint did not. priceCents is the only thing the Buy button and the
 * in-video checkout read; the typed price is a display label. So adding a price
 * by EDITING would have written the label, left the overlay unbuyable, and
 * looked exactly like the feature being broken a second time.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) =>
  readFileSync(join(__dirname, "../../", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const routes = read("server/routes.ts");
const composer = read("client/src/components/OverlayComposer.tsx");

describe("the update endpoint keeps price and priceCents together", () => {
  const patch = routes.slice(
    routes.indexOf('app.patch("/api/videos/:id/overlays/:overlayId"'),
    routes.indexOf('app.delete("/api/videos/:id/overlays/:overlayId"'),
  );

  it("derives priceCents, as create does", () => {
    expect(patch).toContain("update.priceCents = parsePriceToCents(price)");
  });

  it("sets the currency alongside it", () => {
    expect(patch).toContain("update.currency = getPlatformCurrency()");
  });

  /** Both are set inside the same branch, so clearing the price clears both. */
  it("moves them together, not independently", () => {
    const branch = patch.slice(patch.indexOf("if (price !== undefined)"));
    const close = branch.indexOf("if (brandName !== undefined)");
    const body = branch.slice(0, close);
    expect(body).toContain("update.price = price");
    expect(body).toContain("update.priceCents");
  });
});

describe("an overlay can be edited rather than recreated", () => {
  it("every row offers an edit", () => {
    expect(composer).toContain("button-edit-overlay-");
    expect(composer).toContain("beginEdit(o)");
  });

  it("editing loads the existing values into the form", () => {
    const fn = composer.slice(composer.indexOf("const beginEdit"));
    for (const field of ["setOName", "setOUrl", "setOImageUrl", "setOPrice", "setOBrandName", "setOPosition", "setOStartTime", "setOEndTime"]) {
      expect(fn.slice(0, 900), `beginEdit must restore ${field}`).toContain(field);
    }
  });

  it("saves through PATCH when editing and POST when adding", () => {
    expect(composer).toMatch(/editingId == null[\s\S]{0,200}POST[\s\S]{0,200}PATCH/);
  });

  /** One payload for both, or the two paths drift a field at a time. */
  it("builds one payload for both paths", () => {
    expect(composer).toContain("const overlayPayload = ()");
  });
});

describe("the price rule is stated where it is decided", () => {
  it("next to the price field", () => {
    expect(composer).toContain("text-price-required-note");
    expect(composer).toMatch(/A price is required for the Buy button/);
  });

  it("and mentions that prices can be hidden separately", () => {
    expect(composer).toMatch(/Prices can be hidden in the Editing Suite/);
  });

  it("and on any row that has no price", () => {
    expect(composer).toContain("text-no-price-");
    expect(composer).toMatch(/No price — no Buy button/);
  });
});
