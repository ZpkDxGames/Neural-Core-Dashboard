import { readFile } from "node:fs/promises";
import pg from "pg";
import { applyMigration } from "../../backend/migrate.mjs";
import { applyVaultMigration } from "../../backend/v2/migrate.mjs";
import { applyPrivateMigration } from "../../backend/v2/private/migrate.mjs";
export async function privateDatabase() {
  let admin, pool, issuerPool, close, runtime;
  if (process.env.NCORE_V2_PGLITE_PACKAGE) {
    const { PGlite } = await import(process.env.NCORE_V2_PGLITE_PACKAGE),
      db = new PGlite();
    await db.waitReady;
    let tail = Promise.resolve();
    const acquire = async () => {
      let unlock;
      const previous = tail;
      tail = new Promise((r) => (unlock = r));
      await previous;
      return unlock;
    };
    const raw = (sql, args) =>
      args?.length
        ? db.query(sql, args)
        : /^\s*(--|DO |CREATE TABLE IF NOT EXISTS sources|BEGIN;)/.test(sql)
          ? db.exec(sql).then((r) => r.at(-1))
          : db.query(sql);
    admin = { query: raw };
    const rolePool = (role) => ({
      async connect() {
        const unlock = await acquire();
        await db.query("SET ROLE " + role);
        return {
          query: raw,
          release() {
            void db.query("RESET ROLE").then(unlock);
          },
        };
      },
      async query(sql, args) {
        const c = await this.connect();
        try {
          return await c.query(sql, args);
        } finally {
          c.release();
        }
      },
    });
    pool = rolePool("neuralcore_api");
    issuerPool = rolePool("neuralcore_issuer");
    close = () => db.close();
    runtime = "serialized PostgreSQL WASM";
  } else {
    const url = process.env.NCORE_PHASE3_TEST_URL;
    if (
      !url ||
      !["127.0.0.1", "localhost"].includes(new URL(url).hostname) ||
      new URL(url).pathname !== "/ncore_phase3_test"
    )
      throw Error("Fresh disposable loopback ncore_phase3_test required");
    for (const key of ["NCORE_PHASE3_API_URL", "NCORE_PHASE3_ISSUER_URL"])
      if (
        !process.env[key] ||
        new URL(process.env[key]).pathname !== "/ncore_phase3_test" ||
        !["127.0.0.1", "localhost"].includes(new URL(process.env[key]).hostname)
      )
        throw Error("Isolated role URLs required");
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    if (
      (await admin.query("SELECT to_regclass('vault_principals') AS populated"))
        .rows[0].populated
    )
      throw Error("Fresh disposable database required");
    pool = new pg.Pool({
      connectionString: process.env.NCORE_PHASE3_API_URL,
      max: 2,
      connectionTimeoutMillis: 2000,
    });
    issuerPool = new pg.Pool({
      connectionString: process.env.NCORE_PHASE3_ISSUER_URL,
      max: 2,
      connectionTimeoutMillis: 2000,
    });
    close = async () => {
      await pool.end();
      await issuerPool.end();
      await admin.end();
    };
    runtime = "native PostgreSQL, separate API and issuer logins";
  }
  await admin.query(
    "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='neuralcore_api') THEN CREATE ROLE neuralcore_api LOGIN PASSWORD 'synthetic-ci-role'; END IF; END $$",
  );
  await admin.query(
    await readFile(new URL("../../db/001_init.sql", import.meta.url), "utf8"),
  );
  await applyMigration(admin);
  await applyVaultMigration(admin);
  let rolledBack = false;
  try {
    await applyPrivateMigration({
      query: (sql, args) => {
        if (sql.startsWith("INSERT INTO schema_migrations"))
          throw Error("SYNTHETIC_COMMIT_FAILURE");
        return admin.query(sql, args);
      },
    });
  } catch (e) {
    if (e.message !== "SYNTHETIC_COMMIT_FAILURE") throw e;
    rolledBack = true;
  }
  if (
    !rolledBack ||
    (
      await admin.query(
        "SELECT to_regclass('vault_private_sessions') AS present",
      )
    ).rows[0].present !== null
  )
    throw Error("Migration 004 did not roll back");
  await applyPrivateMigration(admin);
  if (!process.env.NCORE_V2_PGLITE_PACKAGE)
    await admin.query(
      "ALTER ROLE neuralcore_issuer LOGIN PASSWORD 'synthetic-issuer-role'",
    );
  return { admin, pool, issuerPool, close, runtime };
}
