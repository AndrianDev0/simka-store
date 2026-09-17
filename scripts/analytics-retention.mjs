import pg from "pg";

const { Client } = pg;
export const ANALYTICS_RETENTION_DAYS = 400;

export async function purgeExpiredAnalytics() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN");
    const parameters = [ANALYTICS_RETENTION_DAYS];
    const events = await client.query("DELETE FROM analytics_events WHERE created_at::timestamptz < NOW() - make_interval(days => $1)", parameters);
    const sessions = await client.query("DELETE FROM analytics_sessions WHERE last_seen_at::timestamptz < NOW() - make_interval(days => $1)", parameters);
    const visitors = await client.query("DELETE FROM analytics_visitors WHERE last_seen_at::timestamptz < NOW() - make_interval(days => $1)", parameters);
    await client.query("COMMIT");
    return { events: events.rowCount ?? 0, sessions: sessions.rowCount ?? 0, visitors: visitors.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
