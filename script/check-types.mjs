/**
 * Typecheck gate — fails the build on NEW type errors, not on existing ones.
 *
 * WHY THIS EXISTS
 *   `npm run build` uses vite/esbuild, which transpiles without typechecking.
 *   On 4 Aug 2026 that let a landing-page button ship that threw
 *   "ReferenceError: handleRoleSelect is not defined" on every click — a
 *   function called from a component it was not in scope for. tsc had been
 *   reporting it as TS2304 the entire time; nothing was reading tsc.
 *
 * WHY A BASELINE RATHER THAN ZERO
 *   The repo carries ~25 pre-existing errors, mostly schema drift in seeded
 *   rows and a few prop-shape mismatches. Blocking every build until all of
 *   them are fixed would stop work outright, so instead the current set is
 *   recorded and only NEW signatures fail. The baseline is meant to shrink:
 *   fixing an error and re-running with --update removes it, and it can never
 *   silently come back.
 *
 * SIGNATURE
 *   file + error code + message, deliberately WITHOUT line/column. Otherwise
 *   inserting a line at the top of a file would renumber every error below it
 *   and flood the report with false "new" entries.
 *
 * USAGE
 *   node script/check-types.mjs            check against the baseline
 *   node script/check-types.mjs --update   rewrite the baseline (review the diff)
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";

const BASELINE = "script/type-baseline.json";
const update = process.argv.includes("--update");

let raw = "";
try {
  execSync("npx tsc --noEmit", { encoding: "utf8", stdio: "pipe" });
} catch (err) {
  // tsc exits non-zero when it reports errors; the output is what we want.
  raw = `${err.stdout ?? ""}${err.stderr ?? ""}`;
}

/** "client/src/x.tsx(12,3): error TS2304: Cannot find name 'y'." -> signature */
function parse(output) {
  const out = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^([^(]+)\(\d+,\d+\): (error TS\d+): (.*)$/);
    if (!m) continue;
    const [, file, code, message] = m;
    // Collapse the message so incidental type-name churn does not read as new.
    out.push(`${file} :: ${code} :: ${message.slice(0, 120)}`);
  }
  return out;
}

const current = parse(raw);
const currentSet = new Set(current);

if (update) {
  writeFileSync(BASELINE, JSON.stringify([...currentSet].sort(), null, 2) + "\n");
  console.log(`type baseline updated: ${currentSet.size} known error(s) recorded`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`No ${BASELINE}. Run: node script/check-types.mjs --update`);
  process.exit(1);
}

const baseline = new Set(JSON.parse(readFileSync(BASELINE, "utf8")));
const added = [...currentSet].filter((s) => !baseline.has(s));
const fixed = [...baseline].filter((s) => !currentSet.has(s));

if (added.length) {
  console.error(`\n  TYPECHECK FAILED — ${added.length} new type error(s)\n`);
  for (const s of added) {
    const [file, code, message] = s.split(" :: ");
    console.error(`   ${file}\n     ${code}: ${message}\n`);
  }
  console.error("  These are NEW since the recorded baseline. Fix them, or if the");
  console.error("  change is deliberate, re-record with:");
  console.error("     node script/check-types.mjs --update\n");
  process.exit(1);
}

let msg = `typecheck passed (${currentSet.size} known, 0 new)`;
if (fixed.length) {
  msg += ` — ${fixed.length} baseline error(s) now fixed; run --update to lock that in`;
}
console.log(msg);
