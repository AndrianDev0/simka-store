import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const MAX_PLAINTEXT_BYTES = 20 * 1024 * 1024;

function encryptionSecret() {
  const value = process.env.BACKUP_ENCRYPTION_KEY?.trim() || process.env.FULFILLMENT_ENCRYPTION_KEY?.trim();
  if (!value || value.length < 32) throw new Error("BACKUP_ENCRYPTION_KEY_NOT_CONFIGURED");
  return value;
}

export async function createEncryptedDatabaseBackup() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  const client = new Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tableResult = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
    const tables: Record<string, unknown[]> = {};
    for (const { table_name: tableName } of tableResult.rows) {
      if (!/^[a-z0-9_]+$/.test(tableName) || tableName === "request_rate_limits") continue;
      const result = await client.query(`SELECT * FROM "${tableName}"`);
      tables[tableName] = result.rows;
      if (Buffer.byteLength(JSON.stringify(tables)) > MAX_PLAINTEXT_BYTES) throw new Error("BACKUP_TOO_LARGE");
    }
    await client.query("COMMIT");
    const createdAt = new Date().toISOString();
    const plaintext = Buffer.from(JSON.stringify({ format: "simka-database-backup", version: 1, createdAt, tables }), "utf8");
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(encryptionSecret(), salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = {
      format: "simka-encrypted-backup",
      version: 1,
      algorithm: "aes-256-gcm+scrypt",
      createdAt,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      data: ciphertext.toString("base64"),
    };
    return { data: Buffer.from(JSON.stringify(envelope), "utf8"), createdAt, tableCount: Object.keys(tables).length, byteCount: plaintext.byteLength };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* connection may already be closed */ }
    throw error;
  } finally {
    await client.end();
  }
}
