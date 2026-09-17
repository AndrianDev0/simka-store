import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const MAX_PLAINTEXT_BYTES = 20 * 1024 * 1024;
const MAX_ENCRYPTED_BYTES = 30 * 1024 * 1024;

export const BACKUP_TABLES = [
  "customer_accounts",
  "customer_sessions",
  "customer_password_resets",
  "privacy_consent_events",
  "analytics_visitors",
  "analytics_sessions",
  "analytics_events",
  "promo_codes",
  "partners",
  "partner_clicks",
  "marketing_costs",
  "orders",
  "order_items",
  "crypto_payments",
  "crypto_payment_events",
  "countries",
  "operators",
  "categories",
  "products",
  "product_variants",
  "product_images",
  "product_categories",
  "admin_audit_log",
  "store_settings",
  "app_migrations",
  "operational_events",
  "search_analytics",
  "seo_redirects",
] as const;

export const RESTORE_INSERT_ORDER = [
  "partners",
  "partner_clicks",
  "marketing_costs",
  "promo_codes",
  "customer_accounts",
  "privacy_consent_events",
  "countries",
  "operators",
  "categories",
  "products",
  "product_variants",
  "product_images",
  "product_categories",
  "orders",
  "order_items",
  "crypto_payments",
  "crypto_payment_events",
  "analytics_visitors",
  "analytics_sessions",
  "analytics_events",
  "customer_sessions",
  "customer_password_resets",
  "admin_audit_log",
  "operational_events",
  "search_analytics",
  "store_settings",
  "app_migrations",
  "seo_redirects",
] as const;

export type DatabaseBackupPayload = {
  format: "simka-database-backup";
  version: 1;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
};

const allowedTables = new Set<string>(BACKUP_TABLES);

function configuredEncryptionSecret() {
  const value = process.env.BACKUP_ENCRYPTION_KEY?.trim() || process.env.FULFILLMENT_ENCRYPTION_KEY?.trim();
  if (!value || value.length < 32) throw new Error("BACKUP_ENCRYPTION_KEY_NOT_CONFIGURED");
  return value;
}
function databaseClient(connectionString: string) {
  return new Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false } });
}

function assertIsoDate(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("BACKUP_CONTENT_INVALID");
}

function assertBackupPayload(value: unknown): asserts value is DatabaseBackupPayload {
  if (!value || typeof value !== "object") throw new Error("BACKUP_CONTENT_INVALID");
  const backup = value as Partial<DatabaseBackupPayload>;
  if (backup.format !== "simka-database-backup" || backup.version !== 1 || !backup.tables || typeof backup.tables !== "object") throw new Error("BACKUP_CONTENT_INVALID");
  assertIsoDate(backup.createdAt);
  const names = Object.keys(backup.tables);
  if (names.length !== BACKUP_TABLES.length || names.some((name) => !allowedTables.has(name))) throw new Error("BACKUP_SCHEMA_MISMATCH");
  for (const name of BACKUP_TABLES) {
    const rows = backup.tables[name];
    if (!Array.isArray(rows)) throw new Error("BACKUP_SCHEMA_MISMATCH");
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("BACKUP_CONTENT_INVALID");
      if (Object.keys(row).some((column) => !/^[a-z0-9_]+$/.test(column))) throw new Error("BACKUP_CONTENT_INVALID");
    }
  }
}

export function encryptDatabaseBackupPayload(payload: DatabaseBackupPayload, secret = configuredEncryptionSecret()) {
  assertBackupPayload(payload);
  if (secret.length < 32) throw new Error("BACKUP_ENCRYPTION_KEY_NOT_CONFIGURED");
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) throw new Error("BACKUP_TOO_LARGE");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = {
    format: "simka-encrypted-backup",
    version: 1,
    algorithm: "aes-256-gcm+scrypt",
    createdAt: payload.createdAt,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
  return { data: Buffer.from(JSON.stringify(envelope), "utf8"), byteCount: plaintext.byteLength };
}

export function decodeEncryptedDatabaseBackup(data: Buffer | string, secret = configuredEncryptionSecret()): DatabaseBackupPayload {
  const encoded = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  if (!encoded.byteLength || encoded.byteLength > MAX_ENCRYPTED_BYTES) throw new Error("BACKUP_ENVELOPE_INVALID");
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(encoded.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("BACKUP_ENVELOPE_INVALID");
  }
  if (envelope.format !== "simka-encrypted-backup" || envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm+scrypt") throw new Error("BACKUP_ENVELOPE_INVALID");
  if (typeof envelope.salt !== "string" || typeof envelope.iv !== "string" || typeof envelope.authTag !== "string" || typeof envelope.data !== "string") throw new Error("BACKUP_ENVELOPE_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", scryptSync(secret, Buffer.from(envelope.salt, "base64"), 32), Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) throw new Error("BACKUP_TOO_LARGE");
    const backup = JSON.parse(plaintext.toString("utf8")) as unknown;
    assertBackupPayload(backup);
    return backup;
  } catch (error) {
    if (error instanceof Error && ["BACKUP_TOO_LARGE", "BACKUP_SCHEMA_MISMATCH", "BACKUP_CONTENT_INVALID"].includes(error.message)) throw error;
    throw new Error("BACKUP_DECRYPTION_FAILED");
  }
}

export async function verifyBackupAgainstDatabase(backup: DatabaseBackupPayload, connectionString = process.env.DATABASE_URL) {
  assertBackupPayload(backup);
  if (!connectionString) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  const client = databaseClient(connectionString);
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    for (const [index, tableName] of BACKUP_TABLES.entries()) {
      const temporaryName = `backup_verify_${index}`;
      await client.query(`CREATE TEMP TABLE "${temporaryName}" (LIKE public."${tableName}" INCLUDING ALL) ON COMMIT DROP`);
      const rows = backup.tables[tableName];
      if (rows.length) {
        await client.query(`INSERT INTO "${temporaryName}" SELECT * FROM json_populate_recordset(NULL::public."${tableName}", $1::json)`, [JSON.stringify(rows)]);
      }
      const count = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "${temporaryName}"`);
      if (Number(count.rows[0]?.count) !== rows.length) throw new Error("BACKUP_ROW_COUNT_MISMATCH");
    }
    await client.query("ROLLBACK");
    return { tableCount: BACKUP_TABLES.length, rowCount: BACKUP_TABLES.reduce((sum, name) => sum + backup.tables[name].length, 0) };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* connection may already be closed */ }
    throw error;
  } finally {
    await client.end();
  }
}

export async function createEncryptedDatabaseBackup() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  const client = databaseClient(connectionString);
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tableResult = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
    const present = tableResult.rows.map((row) => row.table_name).filter((name) => name !== "request_rate_limits");
    if (present.length !== BACKUP_TABLES.length || present.some((name) => !allowedTables.has(name)) || BACKUP_TABLES.some((name) => !present.includes(name))) throw new Error("BACKUP_SCHEMA_MISMATCH");
    const tables: DatabaseBackupPayload["tables"] = {};
    for (const tableName of BACKUP_TABLES) {
      const result = await client.query<Record<string, unknown>>(`SELECT * FROM "${tableName}"`);
      tables[tableName] = result.rows;
      if (Buffer.byteLength(JSON.stringify(tables)) > MAX_PLAINTEXT_BYTES) throw new Error("BACKUP_TOO_LARGE");
    }
    await client.query("COMMIT");
    const createdAt = new Date().toISOString();
    const payload: DatabaseBackupPayload = { format: "simka-database-backup", version: 1, createdAt, tables };
    const encrypted = encryptDatabaseBackupPayload(payload);
    return { data: encrypted.data, createdAt, tableCount: BACKUP_TABLES.length, rowCount: BACKUP_TABLES.reduce((sum, name) => sum + tables[name].length, 0), byteCount: encrypted.byteCount };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* connection may already be closed */ }
    throw error;
  } finally {
    await client.end();
  }
}
