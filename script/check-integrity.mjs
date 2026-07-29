/**
 * Build-time integrity check — fails the build if injected code appears.
 *
 * WHY THIS EXISTS
 *   On 8 Apr 2026 an obfuscated payload was appended to postcss.config.js,
 *   hidden behind ~500 spaces so it sat off-screen in editors and in `git diff`.
 *   It shipped in a commit titled "Add CHANGELOG.md documenting all migration
 *   changes" and survived ~3.5 months, executing on every build — local and CI —
 *   because postcss.config.js is loaded by Vite on every run.
 *
 *   Two things made it possible, and this script only addresses the second:
 *     1. An auto-push script doing `git add -A` with no diff review. That is a
 *        process problem; no script can fix it.
 *     2. Nothing ever looked. That is fixable, so: look, on every build.
 *
 * DESIGN
 *   Build-time config files are held to a STRICTER standard than application
 *   code, because they execute during `npm run build` on every developer machine
 *   and every deploy. They are also small, hand-written, and change rarely — so
 *   a strict rule there costs nothing and catches the exact class of attack that
 *   actually happened.
 *
 *   Deliberately NOT a generic malware scanner. It targets the properties that
 *   made this payload work, and is tuned to stay quiet on this repo as it really
 *   is — shadcn/ui components legitimately carry 700-character Tailwind class
 *   strings, and server/crypto.ts legitimately decodes base64. A check that
 *   cries wolf gets deleted, and then protects nothing.
 */
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

/** Files executed by the build itself. Strictest rules apply here. */
const BUILD_CONFIGS = [
  'postcss.config.js',
  'tailwind.config.ts',
  'vite.config.ts',
  'drizzle.config.ts',
];

/**
 * Markers from the payload that actually hit this repo, plus the generic shapes
 * that family of packers emits. Matching any of these anywhere is a hard fail.
 */
const SIGNATURES = [
  { re: /global\s*\[\s*['"][^a-zA-Z0-9_$][^'"]*['"]\s*\]\s*=/, why: "assignment to a global with a non-identifier name (e.g. global['!'])" },
  { re: /var\s+_\$_[0-9a-f]{4}/i, why: 'obfuscator-generated _$_ variable' },
  { re: /String\.fromCharCode\(\s*127\s*\)/, why: 'DEL character used as a string delimiter — a packer trick' },
  { re: /(\\x[0-9a-f]{2}){6,}/i, why: 'long run of hex-escaped characters' },
];

const failures = [];

function scan(file, { strict }) {
  if (!existsSync(file)) return;
  const src = readFileSync(file, 'utf8');

  for (const { re, why } of SIGNATURES) {
    if (re.test(src)) failures.push(`${file}: ${why}`);
  }

  if (!strict) return;

  // A hand-written build config has no reason to contain a 500-character line.
  // This is what actually hid the payload: it was appended to the end of the
  // last line, behind a wall of spaces.
  src.split('\n').forEach((line, i) => {
    if (line.length > 500) {
      failures.push(`${file}:${i + 1}: line is ${line.length} chars — build configs must not contain long lines (this is how the 2026-04 payload hid)`);
    }
  });

  if (/\beval\s*\(|new\s+Function\s*\(/.test(src)) {
    failures.push(`${file}: eval/Function constructor in a build config`);
  }

  // `require` in an ESM config is not inherently wrong, but the payload needed a
  // createRequire shim to work and added one in the same commit. Worth a look.
  if (/createRequire/.test(src)) {
    failures.push(`${file}: createRequire shim — the 2026-04 payload added one so its code could call require(). Verify this is genuinely needed.`);
  }
}

for (const f of BUILD_CONFIGS) scan(f, { strict: true });

// Repo-wide signature sweep over tracked source. Not strict-mode: application
// code is allowed long lines (shadcn) and base64 (crypto).
let tracked = [];
try {
  tracked = execSync("git ls-files -- '*.js' '*.ts' '*.mjs' '*.cjs' '*.jsx' '*.tsx'", { encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch {
  // Not a git checkout (some CI shallow copies) — config scan above still ran.
}
for (const f of tracked) {
  if (BUILD_CONFIGS.includes(f)) continue;
  scan(f, { strict: false });
}

if (failures.length) {
  console.error('\n  INTEGRITY CHECK FAILED — possible injected code\n');
  for (const f of failures) console.error(`   ${f}`);
  console.error('\n  Inspect these before building. If a finding is legitimate, narrow the');
  console.error('  rule in script/check-integrity.mjs rather than deleting the check.\n');
  process.exit(1);
}

console.log(`integrity check passed (${BUILD_CONFIGS.length} configs, ${tracked.length} tracked files)`);
