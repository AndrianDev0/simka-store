import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { adminAuditLog } from "@/db/schema";
import { createEncryptedDatabaseBackup, decodeEncryptedDatabaseBackup, verifyBackupAgainstDatabase } from "@/lib/database-backup";
import { recordOperationalEvent } from "@/lib/operational-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.BACKUP_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!expected || expected.length < 32 || !supplied) return false;
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
}

function backupDestination() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.BACKUP_TELEGRAM_CHAT_ID?.trim()
    || (process.env.TELEGRAM_ADMIN_IDS || "").split(",").map((value) => value.trim()).find(Boolean);
  if (!token || !chatId || !/^-?\d+$/.test(chatId)) throw new Error("BACKUP_DESTINATION_NOT_CONFIGURED");
  return { token, chatId };
}

async function sendBackupDocument(token: string, chatId: string, data: Buffer, filename: string, caption: string) {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set("document", new Blob([new Uint8Array(data)], { type: "application/json" }), filename);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error("BACKUP_TELEGRAM_SEND_FAILED");
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const backup = await createEncryptedDatabaseBackup();
    const decoded = decodeEncryptedDatabaseBackup(backup.data);
    const verification = await verifyBackupAgainstDatabase(decoded);
    const { token, chatId } = backupDestination();
    const filename = `simka-backup-${backup.createdAt.replace(/[:.]/g, "-")}.json.enc`;
    await sendBackupDocument(
      token,
      chatId,
      backup.data,
      filename,
      `Ежедневная зашифрованная копия SIMKA · ${verification.tableCount} таблиц · ${verification.rowCount} строк · ${Math.ceil(backup.byteCount / 1024)} КБ. Архив расшифрован и проверен на совместимость со схемой базы.`,
    );
    await getDb().insert(adminAuditLog).values({
      id: randomUUID(),
      adminTelegramId: "system:backup",
      action: "database.backup.scheduled",
      entityType: "database",
      metadata: JSON.stringify({ tableCount: verification.tableCount, rowCount: verification.rowCount, byteCount: backup.byteCount }),
      createdAt: new Date().toISOString(),
    });
    return Response.json({ ok: true, createdAt: backup.createdAt, tableCount: verification.tableCount, rowCount: verification.rowCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("scheduled_database_backup_failed", { name: error instanceof Error ? error.message : "UnknownError" });
    await recordOperationalEvent({ kind: "backup_error", severity: "critical", area: "database", path: "/api/operations/backup", code: "scheduled_backup_failed" });
    return Response.json({ error: "Не удалось создать резервную копию" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

