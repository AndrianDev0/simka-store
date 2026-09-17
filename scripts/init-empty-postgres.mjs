import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.RESTORE_DATABASE_URL;

if (!connectionString) throw new Error("Задайте RESTORE_DATABASE_URL с адресом отдельной пустой базы.");
if (connectionString === process.env.DATABASE_URL) throw new Error("RESTORE_DATABASE_URL не должен совпадать с рабочим DATABASE_URL.");

const pool = new Pool({
  connectionString,
  ssl: /(?:localhost|127\.0\.0\.1)/.test(connectionString) ? false : { rejectUnauthorized: false },
  max: 1,
});

try {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  await migrate(drizzle(pool), { migrationsFolder });
  console.log("Пустая PostgreSQL-схема подготовлена без тестовых данных.");
} finally {
  await pool.end();
}
