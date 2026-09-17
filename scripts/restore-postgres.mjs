import { readFile } from "node:fs/promises";
import pg from "pg";
import { BACKUP_TABLES, decodeEncryptedDatabaseBackup, RESTORE_INSERT_ORDER } from "../lib/database-backup.ts";

const { Client } = pg;
const filename = process.argv[2];
const confirmed = process.argv.includes("--confirm-empty-target");

if (!filename) throw new Error("Укажите путь к файлу резервной копии.");
const backup = decodeEncryptedDatabaseBackup(await readFile(filename));
const rowCount = BACKUP_TABLES.reduce((sum, table) => sum + backup.tables[table].length, 0);
console.log(`Копия проверена: ${backup.createdAt}; таблиц: ${BACKUP_TABLES.length}; строк: ${rowCount}.`);

if (!confirmed) {
  console.log("Проверка завершена без изменений. Для восстановления в отдельную пустую базу задайте RESTORE_DATABASE_URL и добавьте --confirm-empty-target.");
  process.exit(0);
}
const connectionString = process.env.RESTORE_DATABASE_URL;
if (!connectionString) throw new Error("Задайте RESTORE_DATABASE_URL с адресом отдельной пустой базы.");
if (connectionString === process.env.DATABASE_URL) throw new Error("RESTORE_DATABASE_URL не должен совпадать с рабочим DATABASE_URL.");

const client = new Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false } });
await client.connect();

try {
  await client.query("BEGIN");
  const tableResult = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
  const targetTables = new Set(tableResult.rows.map((row) => row.table_name));
  for (const table of BACKUP_TABLES) {
    if (!targetTables.has(table)) throw new Error(`В целевой базе отсутствует таблица: ${table}`);
    const count = await client.query(`SELECT COUNT(*)::text AS count FROM "${table}"`);
    if (Number(count.rows[0]?.count) !== 0) throw new Error(`Целевая база не пустая: в таблице ${table} есть данные.`);
  }

  const categoryParents = [];
  for (const table of RESTORE_INSERT_ORDER) {
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
  for (const table of ["countries", "operators", "products", "product_variants", "product_images", "seo_redirects"]) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`);
  }
  await client.query("COMMIT");
  console.log(`Восстановление завершено: ${BACKUP_TABLES.length} таблиц, ${rowCount} строк.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
