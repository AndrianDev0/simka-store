import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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

function databaseClient() {
  return new Client({ connectionString, ssl: /(?:localhost|127\.0\.0\.1)/.test(connectionString) ? false : { rejectUnauthorized: false } });
}

async function listPublicTables() {
  const probe = databaseClient();
  await probe.connect();
  try {
    const result = await probe.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    return new Set(result.rows.map((row) => row.table_name));
  } finally {
    await probe.end();
  }
}

async function initializeEmptyTarget() {
  const initializer = fileURLToPath(new URL("./init-empty-postgres.mjs", import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [initializer], {
      env: { ...process.env, RESTORE_DATABASE_URL: connectionString },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Не удалось подготовить схему целевой PostgreSQL (${signal ? `signal ${signal}` : `exit ${code}`}).`));
    });
  });
}

let targetTables = await listPublicTables();
if (targetTables.size === 0) {
  console.log("Целевая PostgreSQL пустая: создаётся схема без тестовых данных.");
  await initializeEmptyTarget();
  targetTables = await listPublicTables();
}

const client = databaseClient();
await client.connect();

try {
  await client.query("BEGIN");
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
      await client.query(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM json_populate_record(NULL::"${table}", $1::json)`, [JSON.stringify(row)]);
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
