import { readFile } from "node:fs/promises";
import { hash } from "../note.mjs";

/** Explicit administrator client only; never called by a server or startup path. */
export async function applyDeliveryMigration(client) {
  const sql = await readFile(
      new URL("../../../db/005_agent_delivery.sql", import.meta.url),
      "utf8",
    ),
    sha256 = hash(sql);
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(17620,105)");
    if (
      !(await client.query("SELECT 1 FROM schema_migrations WHERE version=4"))
        .rows.length
    )
      throw Error("Migration 004 required");
    const prior = await client.query(
      "SELECT sha256 FROM schema_migrations WHERE version=5",
    );
    if (prior.rows.length) {
      if (prior.rows[0].sha256 !== sha256)
        throw Error("Migration checksum drift");
      await client.query("COMMIT");
      return { state: "already-applied", sha256 };
    }
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations(version,sha256) VALUES(5,$1)",
      [sha256],
    );
    await client.query("COMMIT");
    return { state: "applied", sha256 };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
