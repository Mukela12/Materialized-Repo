/**
 * Vercel's build entry point (see vercel.json `buildCommand`).
 *
 * Why this exists instead of calling `npx vite build` directly:
 *
 * vite/esbuild leave background esbuild "service" daemons running after a build
 * finishes. Two esbuild copies are installed here (esbuild@0.25.12 at the root and
 * esbuild@0.27.2 under vite/), and their child processes keep Node's event loop
 * alive, so `npx vite build` prints "✓ built in Ns" and then NEVER EXITS.
 *
 * Vercel waits for the build command to exit before it collects the output into
 * /vercel/output. Because the command never returned, every production deploy from
 * 25 July 2026 onward hung at exactly that point and died at the 45-minute build
 * timeout — the log showed a successful build followed by silence, and
 * "Build Completed in /vercel/output" never appeared.
 *
 * Running the build through vite's JS API and then exiting explicitly makes the
 * process terminate as soon as the artifacts are on disk.
 */
import { build } from "vite";

build()
  .then(() => {
    // Artifacts are written; don't wait on leaked esbuild service daemons.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
