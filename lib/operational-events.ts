import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { operationalEvents } from "@/db/schema";
import { isIgnoredOperationalPath, normalizeOperationalEvent, type NormalizedOperationalEvent, type OperationalEvent } from "@/lib/operational-event-shape";

async function notifyCriticalEvent(event: NormalizedOperationalEvent, occurredAt: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const adminIds = (process.env.TELEGRAM_ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!token || !adminIds.length) return;
  const text = [
    "🔴 Критическая ошибка SIMKA",
    `Код: ${event.code}`,
    `Раздел: ${event.area}`,
    `Путь: ${event.path}`,
    `Время: ${occurredAt} UTC`,
    "Повторения агрегируются. Подробности: «⚠️ Ошибки» в меню бота.",
  ].join("\n");
  await Promise.allSettled(adminIds.map(async (chatId) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: [[{ text: "⚠️ Открыть ошибки", callback_data: "errors:period:24" }]] } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("TELEGRAM_CRITICAL_ALERT_FAILED");
  }));
}

export async function recordOperationalEvent(event: OperationalEvent) {
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const normalized = normalizeOperationalEvent(event);
  if (isIgnoredOperationalPath(normalized.path)) return;
  const { kind, area, path, code } = normalized;
  const id = createHash("sha256").update(`${day}|${kind}|${event.severity}|${area}|${path}|${code}`).digest("hex");
  try {
    const [stored] = await getDb().insert(operationalEvents).values({ id, kind, severity: event.severity, area, path, code, count: 1, firstSeenAt: now, lastSeenAt: now }).onConflictDoUpdate({
      target: operationalEvents.id,
      set: { count: sql`${operationalEvents.count} + 1`, lastSeenAt: now },
    }).returning({ count: operationalEvents.count });
    if (event.severity === "critical" && stored?.count === 1) await notifyCriticalEvent(normalized, now);
  } catch (error) {
    console.warn("operational_event_record_failed", { name: error instanceof Error ? error.name : "UnknownError" });
  }
}
