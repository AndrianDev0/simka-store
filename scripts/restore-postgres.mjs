import { createDecipheriv, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Client } = pg;
const filename = process.argv[2];
const confirmed = process.argv.includes("--confirm-empty-target");
const connectionString = process.env.RESTORE_DATABASE_URL;
const secret = process.env.BACKUP_ENCRYPTION_KEY?.trim() || process.env.FULFILLMENT_ENCRYPTION_KEY?.trim();

if (!filename) throw new Error("Укажите путь к файлу резервной копии.");
if (!connectionString) throw new Error("Задайте отдельную переменную RESTORE_DATABASE_URL с точным адресом целевой базы.");
if (!secret || secret.length < 32) throw new Error("Нужен тот же BACKUP_ENCRYPTION_KEY или FULFILLMENT_ENCRYPTION_KEY, которым зашифрована копия.");

const envelope = JSON.parse(await readFile(filename, "utf8"));
if (envelope?.format !== "simka-encrypted-backup" || envelope?.version !== 1 || envelope?.algorithm !== "aes-256-gcm+scrypt") throw new Error("Неподдерживаемый формат копии.");
const decipher = createDecipheriv("aes-256-gcm", scryptSync(secret, Buffer.from(envelope.salt, "base64"), 32), Buffer.from(envelope.iv, "base64"));
decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
const backup = JSON.parse(plaintext.toString("utf8"));
if (backup?.format !== "simka-database-backup" || backup?.version !== 1 || typeof backup.tables !== "object") throw new Error("Содержимое копии повреждено.");

const allowedTables = new Set([
  "partners", "partner_clicks", "marketing_costs", "customer_accounts", "customer_sessions", "customer_password_resets", "privacy_consent_events", "orders", "order_items", "crypto_payments", "crypto_payment_events",
  "countries", "operators", "categories", "products", "product_variants", "product_images", "product_categories", "admin_audit_log", "operational_events", "store_settings", "seo_redirects",
]);
for (const [table, rows] of Object.entries(backup.tables)) {
  if (!allowedTables.has(table) || !Array.isArray(rows)) throw new Error(`Недопустимая таблица в копии: ${table}`);
}

console.log(`Копия проверена: ${backup.createdAt}; таблиц: ${Object.keys(backup.tables).length}.`);
if (!confirmed) {
  console.log("Проверка завершена без изменений. Для восстановления добавьте --confirm-empty-target. ВНИМАНИЕ: целевая база будет очищена.");
  process.exit(0);
}

const client = new Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false } });
await client.connect();
const insertOrder = ["partners", "partner_clicks", "marketing_costs", "customer_accounts", "privacy_consent_events", "countries", "operators", "categories", "products", "product_variants", "product_images", "product_categories", "orders", "order_items", "crypto_payments", "crypto_payment_events", "customer_sessions", "customer_password_resets", "admin_audit_log", "operational_events", "store_settings", "seo_redirects"];
const present = insertOrder.filter((table) => Array.isArray(backup.tables[table]));

try {
  await client.query("BEGIN");
  if (present.length) await client.query(`TRUNCATE ${present.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`);
  const categoryParents = [];
  for (const table of present) {
    for (const sourceRow of backup.tables[table]) {
      const row = { ...sourceRow };
      if (table === "categories" && row.parent_id) {
        categoryParents.push([row.id, row.parent_id]);
        row.parent_id = null;
      }
      const columns = Object.keys(row);
      if (!columns.length || columns.some((column) => !/^[a-z0-9_]+$/.test(column))) throw new Error(`Недопустимые колонки: ${table}`);
      await client.query(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`, columns.map((column) => row[column]));
    }
  }
  for (const [id, parentId] of categoryParents) await client.query("UPDATE categories SET parent_id = $1 WHERE id = $2", [parentId, id]);
  for (const table of ["countries", "operators", "products", "product_variants", "product_images"]) {
    if (!present.includes(table)) continue;
    await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`);
  }
  await client.query("COMMIT");
  console.log("Восстановление завершено успешно.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
