/**
 * Versioned, forward-only DB migration runner.
 *
 * Run with:  npm run db:migrate   (tsx server/migrate.ts)
 *
 * Design goals (see migrations/*.sql for the DDL history):
 *   - Connects EXACTLY like server/db.ts: a node-postgres Pool over DATABASE_URL,
 *     with the same "DATABASE_URL must be set" guard. TLS is negotiated via the
 *     connection string / pg defaults — no extra SSL config, same as db.ts.
 *   - Tracks applied files in a `schema_migrations` ledger and only runs pending ones,
 *     in ascending filename order (0001, 0002, ...).
 *   - Every migration file is idempotent (IF NOT EXISTS / ADD VALUE IF NOT EXISTS), so
 *     the FIRST run against prod — where all this DDL was already applied by hand — is a
 *     safe no-op that simply back-fills the ledger. On a fresh DB (staging) the same files
 *     build the full post-baseline delta.
 *   - ADDITIVE ONLY. This runner never issues DROP TABLE / TRUNCATE / DELETE, never calls
 *     drizzle-kit, and never touches the connect-pg-simple `session` table (which is NOT in
 *     shared/schema.ts — that is exactly why `drizzle-kit push` is forbidden operationally).
 *     The only DROP anywhere is `DROP INDEX IF EXISTS` for a superseded index in 0007, which
 *     is non-destructive to row data.
 *   - Files whose first line is `-- migrate:no-transaction` run each statement in autocommit
 *     (required for `ALTER TYPE ... ADD VALUE`, which cannot run inside a transaction block
 *     that also runs other DDL). All other files run atomically inside a single BEGIN/COMMIT,
 *     rolling back and aborting the whole run on the first error.
 */

import { readdir, readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import pg from "pg";

const { Pool } = pg;

// Same guard and connection path as server/db.ts.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/migrate.ts -> ../migrations
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

const NO_TX_MARKER = "-- migrate:no-transaction";

/**
 * Split a SQL file into individual statements on top-level semicolons, ignoring
 * semicolons inside single-quoted strings, dollar-quoted blocks ($$...$$ / $tag$...$tag$),
 * line comments (-- ...) and block comments. Used only for the no-transaction path, where
 * statements must be sent one at a time in autocommit.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment
    if (ch === "-" && next === "-") {
      const eol = sql.indexOf("\n", i);
      const end = eol === -1 ? n : eol;
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    // Single-quoted string literal ('' is an escaped quote)
    if (ch === "'") {
      current += ch;
      i++;
      while (i < n) {
        current += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            current += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Dollar-quoted block: $tag$ ... $tag$
    if (ch === "$") {
      const tagMatch = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        current += sql.slice(i, end);
        i = end;
        continue;
      }
    }

    // Statement terminator
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function ensureLedger(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function appliedFilenames(pool: pg.Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations",
  );
  return new Set(rows.map((r) => r.filename));
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((f) => /^\d+.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** Atomic path: whole file inside one transaction, then record it. */
async function applyInTransaction(
  pool: pg.Pool,
  filename: string,
  sql: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [filename],
    );
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback error; original error is what matters */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Autocommit path for `-- migrate:no-transaction` files. Each statement runs on its own
 * (no wrapping BEGIN/COMMIT) because `ALTER TYPE ... ADD VALUE` cannot run inside a
 * transaction block that also runs other DDL. Statements are individually idempotent,
 * so re-running after a mid-file failure is safe.
 */
async function applyAutocommit(
  pool: pg.Pool,
  filename: string,
  sql: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    for (const stmt of splitStatements(sql)) {
      await client.query(stmt);
    }
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [filename],
    );
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await ensureLedger(pool);

    const [files, applied] = await Promise.all([
      listMigrationFiles(),
      appliedFilenames(pool),
    ]);

    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log(
        `[migrate] up to date — ${files.length} migration(s), 0 pending.`,
      );
      return;
    }

    console.log(`[migrate] ${pending.length} pending migration(s):`);
    for (const f of pending) console.log(`  - ${f}`);

    for (const filename of pending) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, filename), "utf-8");
      const noTx = sql
        .split(/\r?\n/, 1)[0]
        .trim()
        .startsWith(NO_TX_MARKER);

      process.stdout.write(
        `[migrate] applying ${filename}${noTx ? " (no-transaction)" : ""} ... `,
      );
      if (noTx) {
        await applyAutocommit(pool, filename, sql);
      } else {
        await applyInTransaction(pool, filename, sql);
      }
      console.log("done");
    }

    console.log(`[migrate] applied ${pending.length} migration(s). OK.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] FAILED — aborting run.");
  console.error(err);
  process.exit(1);
});
