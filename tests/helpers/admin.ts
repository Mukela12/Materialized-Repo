/**
 * Seeded test-admin account credentials.
 * These can be overridden via environment variables for portability;
 * they fall back to the values seeded by the application on startup.
 *
 * In production the seed account is only created when SEED_ADMIN_ACCOUNT=true.
 * In development the account is always seeded, so the fallback values work
 * for local test runs without any extra configuration.
 */
export const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'missbethanieashton@gmail.com';
export const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'test1233*';
