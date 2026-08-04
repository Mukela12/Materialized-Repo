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
 * SIGNATURE: file + error code, counted. Nothing else.
 *   Not the line/column — inserting a line at the top of a file would renumber
 *   every error below it and the whole file would read as new.
 *   Not the message either, which was the first attempt and broke the build.
 *   TypeScript embeds the INFERRED TYPE in messages like "Property 'name' does
 *   not exist on type '{ id: string; username: string; ... }'", and it renders
 *   those property lists in a different order on CI than locally. Identical
 *   errors therefore produced different signatures, and every deploy failed
 *   with four "new" errors that had been in the baseline all along.
 *
 *   file + code + count is deterministic across environments, and still catches
 *   what matters: a file gaining an error code it did not have, or gaining more
 *   of one it did.
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

/** "client/src/x.tsx(12,3): error TS2304: ..." -> { "client/src/x.tsx :: TS2304": n } */
function parse(output) {
  const counts = {};
  for (const line of output.split("\n")) {
    const m = line.match(/^([^(]+)\(\d+,\d+\): error (TS\d+):/);
    if (!m) continue;
    const key = `${m[1]} :: ${m[2]}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const current = parse(raw);
const currentTotal = Object.values(current).reduce((a, b) => a + b, 0);

if (update) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`type baseline updated: ${currentTotal} known error(s) across ${Object.keys(current).length} file/code pair(s)`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`No ${BASELINE}. Run: node script/check-types.mjs --update`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));

const regressions = [];
for (const [key, n] of Object.entries(current)) {
  const allowed = baseline[key] ?? 0;
  if (n > allowed) regressions.push({ key, n, allowed });
}

if (regressions.length) {
  console.error(`\n  TYPECHECK FAILED — ${regressions.length} regression(s)\n`);
  for (const { key, n, allowed } of regressions) {
    const [file, code] = key.split(" :: ");
    console.error(`   ${file}`);
    console.error(`     ${code}: ${n} error(s), baseline allows ${allowed}\n`);
  }
  console.error("  Run `npx tsc --noEmit` to see them in full. Fix them, or if the");
  console.error("  change is deliberate, re-record with:");
  console.error("     node script/check-types.mjs --update\n");
  process.exit(1);
}

const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
let msg = `typecheck passed (${currentTotal} known, 0 new)`;
if (currentTotal < baselineTotal) {
  msg += ` — ${baselineTotal - currentTotal} baseline error(s) now fixed; run --update to lock that in`;
}
console.log(msg);
