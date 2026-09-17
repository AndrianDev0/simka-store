import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_TABLES, decodeEncryptedDatabaseBackup, encryptDatabaseBackupPayload } from "../lib/database-backup.ts";

const secret = "backup-test-secret-that-is-longer-than-32-characters";

function payload() {
  return {
    format: "simka-database-backup",
    version: 1,
    createdAt: "2026-09-17T00:00:00.000Z",
    tables: Object.fromEntries(BACKUP_TABLES.map((table) => [table, []])),
  };
}

test("encrypted database backup round-trips every supported table", () => {
  const original = payload();
  original.tables.customer_accounts.push({ id: "account-1", email: "client@example.com" });
  const encrypted = encryptDatabaseBackupPayload(original, secret);
  const decoded = decodeEncryptedDatabaseBackup(encrypted.data, secret);
  assert.deepEqual(decoded, original);
});

test("backup verification rejects missing tables", () => {
  const incomplete = payload();
  delete incomplete.tables.analytics_events;
  assert.throws(() => encryptDatabaseBackupPayload(incomplete, secret), /BACKUP_SCHEMA_MISMATCH/);
});

test("backup verification rejects authentication failure and tampering", () => {
  const encrypted = encryptDatabaseBackupPayload(payload(), secret);
  assert.throws(() => decodeEncryptedDatabaseBackup(encrypted.data, `${secret}-wrong`), /BACKUP_DECRYPTION_FAILED/);
  const envelope = JSON.parse(encrypted.data.toString("utf8"));
  envelope.data = `${envelope.data.slice(0, -4)}AAAA`;
  assert.throws(() => decodeEncryptedDatabaseBackup(JSON.stringify(envelope), secret), /BACKUP_DECRYPTION_FAILED/);
});

