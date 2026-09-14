import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let pool: Pool | null = null;

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is unavailable. Configure the Render Postgres connection string before using the database."
    );
  }

  pool ??= new Pool({
    connectionString: databaseUrl,
    max: 5,
    ssl: { rejectUnauthorized: false },
  });

  return drizzle(pool, { schema });
}
