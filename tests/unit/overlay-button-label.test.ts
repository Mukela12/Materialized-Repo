/**
 * Per-product button text, and a title that reads the same everywhere.
 *
 * ── What the client asked for ────────────────────────────────────────────────
 * "Button text is presently only set to the Editing Suite across all products
 * in the video, however the user is to have final control on modifying the
 * Button text per item. For instance, OpenHouse text can be APPLY NOW while the
 * silver pumps are BUY NOW."
 *
 * Plus a 25-character cap on the product title, and 5px more air between the
 * brand line, the title and the button.
 *
 * ── The rule that must not break ─────────────────────────────────────────────
 * A blank override means "use the video's setting" — not an empty button. Every
 * overlay that exists today has no override, so an empty string leaking through
 * would blank the call to action on every product already published.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) =>
  readFileSync(join(__dirname, "../../", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const routes = read("server/routes.ts");
const composer = read("client/src/components/OverlayComposer.tsx");
const schema = read("shared/schema.ts");

describe("the override is stored", () => {
  it("as a nullable column, so existing overlays are unaffected", () => {
    expect(schema).toContain('buttonLabel: text("button_label")');
    expect(schema).not.toMatch(/buttonLabel: text\("button_label"\)\.notNull/);
  });

  it("is accepted on create and on update", () => {
    expect(routes).toMatch(/const \{ name, productUrl, imageUrl, price, brandName, buttonLabel,/);
    expect(routes).toMatch(/const \{ position, startTime, endTime, name, productUrl, imageUrl, price, brandName, buttonLabel \}/);
  });

  /** The load-bearing one: blank must mean "inherit", never "no text". */
  it("stores blank as null on both paths", () => {
    const occurrences = routes.match(/buttonLabel\.trim\(\) \? buttonLabel\.trim\(\)\.slice\(0, 24\) : null/g) ?? [];
    expect(occurrences.length).toBe(2);
  });
});

describe("the player prefers the product's own label", () => {
  it("falls back to the video-wide setting", () => {
    expect(routes).toContain("b.textContent=p.buttonLabel||BUY_LABEL");
  });

  it("sends it to the page", () => {
    expect(routes).toMatch(/buttonLabel: \(o\.buttonLabel \|\| ""\)/);
  });
});

describe("the product title is capped at 25", () => {
  it("server-side, so every viewer sees the same text", () => {
    expect(routes).toContain("const NAME_LIMIT = 25");
    expect(routes).toMatch(/capName\(\(o\.name \|\| ""\)/);
  });

  it("keeps short names untouched and ellipsises long ones", () => {
    const NAME_LIMIT = 25;
    const capName = (n: string) => (n.length > NAME_LIMIT ? n.slice(0, NAME_LIMIT - 1).trimEnd() + "…" : n);
    expect(capName("Silver Pointed Pumps")).toBe("Silver Pointed Pumps");
    expect(capName("A".repeat(25))).toBe("A".repeat(25));
    expect(capName("A".repeat(40))).toBe("A".repeat(24) + "…");
    expect(capName("A".repeat(40)).length).toBe(25);
  });

  it("and is enforced where it is typed", () => {
    expect(composer).toContain("maxLength={25}");
    expect(composer).toMatch(/\{oName\.length\}\/25 characters/);
  });
});

describe("the extra spacing the client asked for", () => {
  it("5px more between the brand line and the title", () => {
    expect(routes).toMatch(/\.product-name\{[^}]*margin-top:calc\(clamp\(2px,0\.5vw,4px\) \+ 5px\)/);
  });

  it("and before the button", () => {
    expect(routes).toMatch(/\.buy-btn\{margin-top:8px/);
  });
});
