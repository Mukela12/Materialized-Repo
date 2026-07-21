/**
 * Global test setup.
 *
 * Some server modules (e.g. server/db.ts) throw at import time when required env
 * vars are absent. A few pure unit tests transitively import those modules
 * (stripe-plans -> webhookHandlers -> storage -> db). Provide an inert default so
 * those tests load deterministically, in isolation or in any run order.
 *
 * The dummy connection string is never connected to: pg.Pool connects lazily on
 * first query, and these unit tests mock storage/Stripe and never issue one.
 */
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/materialized_test";
