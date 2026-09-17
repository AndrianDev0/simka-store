import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BACKUP_TABLES } from "../lib/database-backup.ts";

const migrationUrl = new URL("../drizzle/0000_postgres_baseline.sql", import.meta.url);
const journalUrl = new URL("../drizzle/meta/_journal.json", import.meta.url);
const initializerUrl = new URL("../scripts/init-empty-postgres.mjs", import.meta.url);
const restoreUrl = new URL("../scripts/restore-postgres.mjs", import.meta.url);

test("Drizzle baseline is PostgreSQL and contains every restorable table", async () => {
  const [migration, journalText] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(journalUrl, "utf8"),
  ]);
  const journal = JSON.parse(journalText);

  assert.equal(journal.dialect, "postgresql");
  assert.doesNotMatch(migration, /AUTOINCREMENT|sqlite_/i);
  for (const table of BACKUP_TABLES) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`), `missing PostgreSQL table ${table}`);
  }
});

test("empty-target initialization uses PostgreSQL migrations and restore invokes it", async () => {
  const [initializer, restore] = await Promise.all([
    readFile(initializerUrl, "utf8"),
    readFile(restoreUrl, "utf8"),
  ]);

  assert.match(initializer, /migrate\(drizzle\(pool\), \{ migrationsFolder \}\)/);
  assert.doesNotMatch(initializer, /INSERT INTO (?:countries|products)/i);
  assert.match(restore, /if \(targetTables\.size === 0\)/);
  assert.match(restore, /init-empty-postgres\.mjs/);
  assert.match(restore, /spawn\(process\.execPath, \[initializer\]/);
});
