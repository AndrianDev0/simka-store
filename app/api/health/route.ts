import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getCryptoPaymentConfig } from "@/lib/crypto-payments";
import { getEmailConfigurationStatus } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await getDb().execute(sql`SELECT 1`);
    return Response.json({
      status: "ok",
      database: "ok",
      emailConfigured: getEmailConfigurationStatus().configured,
      cryptoPaymentsConfigured: Boolean(getCryptoPaymentConfig()),
      checkedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("health_check_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ status: "error", database: "unavailable", checkedAt }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
