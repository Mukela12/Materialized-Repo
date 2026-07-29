import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import { execFileSync } from "child_process";

// Server deps to bundle for faster cold starts
const allowlist = [
  "cloudinary",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-session",
  "multer",
  "nanoid",
  "p-limit",
  "p-retry",
  "pg",
  "resend",
  "@sentry/node",
  "stripe",
  "ws",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  // Integrity check FIRST, in a separate process, before vite imports anything.
  // postcss.config.js is executed by vite as the client build starts, so a check
  // that ran later — or in this process — would run after the payload did.
  // See script/check-integrity.mjs for the incident this prevents.
  execFileSync("node", ["script/check-integrity.mjs"], { stdio: "inherit" });

  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll()
  .then(() => {
    // vite/esbuild leave background service daemons running, which keep Node's
    // event loop alive — without this the process hangs indefinitely after the
    // artifacts are written (and any CI that waits for it stalls until timeout).
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
