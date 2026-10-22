import { readFile } from "node:fs/promises";
import { hash } from "../note.mjs";
export async function applyPrivateMigration(client) {
  const sql = await readFile(
      new URL("../../../db/004_private_integration.sql", import.meta.url),
      "utf8",
    ),
    sha256 = hash(sql);
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(17620,104)");
    if (
      !(await client.query("SELECT 1 FROM schema_migrations WHERE version=3"))
        .rows.length
    )
      throw Error("Migration 003 required");
    const prior = await client.query(
      "SELECT sha256 FROM schema_migrations WHERE version=4",
    );
    if (prior.rows.length) {
      if (prior.rows[0].sha256 !== sha256)
        throw Error("Migration checksum drift");
      await client.query("COMMIT");
      return { state: "already-applied", sha256 };
    }
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations(version,sha256) VALUES(4,$1)",
      [sha256],
    );
    await client.query("COMMIT");
    return { state: "applied", sha256 };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
