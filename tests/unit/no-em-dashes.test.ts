/**
 * No em dashes in what people read (29 Sep 2026).
 *
 * The client asked for the site's copy without them: they read as machine
 * written, and a full stop, comma, colon or brackets almost always says the
 * same thing more plainly. Comments are free to use them. A lone "—" standing
 * in for an empty table cell is a placeholder, not prose, and is allowed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");

function visibleDashes(file: string): string[] {
  const src = readFileSync(join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block and JSX comments
    .replace(/<!--[\s\S]*?-->/g, "")      // HTML comments in email templates
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .map((l) => l.replace(/(^|\s)\/\/\s.*$/, ""));
  return src.filter((l) => {
    const withoutPlaceholders = l.replace(/(["'])—\1|>—</g, "");
    return withoutPlaceholders.includes("—");
  });
}

describe("site copy has no em dashes", () => {
  const files = [
    ...globSync("client/src/**/*.{ts,tsx}", { cwd: root }),
    "shared/playlists.ts",
    "server/emailService.ts",
    "server/mailbox.ts",
    "server/docusignHelper.ts",
    "server/inviteVoucher.ts",
  ];

  it("in the app, the emails and the messages people see", () => {
    const offenders = files.flatMap((f) => visibleDashes(f).map((l) => `${f}: ${l.trim().slice(0, 100)}`));
    expect(offenders).toEqual([]);
  });

  it("emails don't use the HTML entity either", () => {
    expect(readFileSync(join(root, "server/emailService.ts"), "utf8")).not.toMatch(/&mdash;|&#8212;/);
  });
});
