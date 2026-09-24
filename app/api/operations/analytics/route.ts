import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminAuditLog, orders } from "@/db/schema";
import { sendOrderAnalytics } from "@/lib/server-analytics";
import { ANALYTICS_POLICY_VERSION } from "@/lib/analytics-policy";
import { parseTelegramAdminIds, resolveTelegramRole, telegramRoleCan } from "@/lib/telegram-rbac";
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

function reportRecipients() {
  const configured = process.env.TELEGRAM_ADMIN_IDS;
  return parseTelegramAdminIds(configured).filter((id) => {
    const role = resolveTelegramRole(id, configured, process.env.TELEGRAM_ADMIN_ROLES);
    return role && telegramRoleCan(role, "analytics.read");
  });
}

async function sendTelegramOnce(id: string, chatId: string, message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN_NOT_CONFIGURED");
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`analytics:${id}`}))`);
    const [sent] = await tx.select({ id: adminAuditLog.id }).from(adminAuditLog).where(eq(adminAuditLog.id, id)).limit(1);
    if (sent) return false;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { ok?: boolean };
    if (!response.ok || !result.ok) throw new Error("ANALYTICS_TELEGRAM_SEND_FAILED");
    await tx.insert(adminAuditLog).values({
      id,
      adminTelegramId: `system:${chatId}`,
      action: "analytics.scheduled.send",
      entityType: "analytics_report",
      entityId: id,
      metadata: "{}",
      createdAt: new Date().toISOString(),
    });
    return true;
  });
}

function completeUtcRange(kind: "daily" | "weekly", now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (kind === "daily") {
    const end = today.toISOString();
    return { start: new Date(today.getTime() - 86_400_000).toISOString(), end, label: end.slice(0, 10) };
  }
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const thisMonday = new Date(today.getTime() - mondayOffset * 86_400_000);
  return { start: new Date(thisMonday.getTime() - 7 * 86_400_000).toISOString(), end: thisMonday.toISOString(), label: thisMonday.toISOString().slice(0, 10) };
}

async function scheduledReport(kind: "daily" | "weekly") {
  const db = getDb();
  const range = completeUtcRange(kind);
  const [traffic, sales, revenue] = await Promise.all([
    db.execute<{ visitors: number; sessions: number; page_views: number; events: number }>(sql`
      SELECT COUNT(DISTINCT s.client_id)::int AS visitors, COUNT(DISTINCT s.id)::int AS sessions,
        COALESCE(SUM(s.page_views), 0)::int AS page_views,
        (SELECT COUNT(*)::int FROM analytics_events e JOIN analytics_sessions es ON es.id = e.session_id
          WHERE es.traffic_class = 'HUMAN' AND e.occurred_at::timestamptz >= ${range.start}::timestamptz
            AND e.occurred_at::timestamptz < ${range.end}::timestamptz) AS events
      FROM analytics_sessions s WHERE s.traffic_class = 'HUMAN'
        AND s.started_at::timestamptz >= ${range.start}::timestamptz AND s.started_at::timestamptz < ${range.end}::timestamptz
    `),
    db.execute<{ created: number; paid: number; buyers: number; refunds: number; converted: number }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM orders WHERE created_at::timestamptz >= ${range.start}::timestamptz AND created_at::timestamptz < ${range.end}::timestamptz) AS created,
        (SELECT COUNT(*)::int FROM orders WHERE paid_at IS NOT NULL
          AND paid_at::timestamptz >= ${range.start}::timestamptz AND paid_at::timestamptz < ${range.end}::timestamptz) AS paid,
        (SELECT COUNT(DISTINCT first_party_client_id)::int FROM orders WHERE paid_at IS NOT NULL
          AND paid_at::timestamptz >= ${range.start}::timestamptz AND paid_at::timestamptz < ${range.end}::timestamptz) AS buyers,
        (SELECT COUNT(*)::int FROM orders WHERE refunded_at::timestamptz >= ${range.start}::timestamptz AND refunded_at::timestamptz < ${range.end}::timestamptz) AS refunds,
        (SELECT COUNT(DISTINCT o.first_party_client_id)::int FROM orders o WHERE o.paid_at IS NOT NULL
          AND o.paid_at::timestamptz >= ${range.start}::timestamptz AND o.paid_at::timestamptz < ${range.end}::timestamptz
          AND EXISTS (SELECT 1 FROM analytics_sessions s WHERE s.client_id = o.first_party_client_id AND s.traffic_class = 'HUMAN'
            AND s.started_at::timestamptz >= ${range.start}::timestamptz AND s.started_at::timestamptz <= o.created_at::timestamptz)) AS converted
    `),
    db.execute<{ currency: string; amount: number }>(sql`
      SELECT currency, COALESCE(SUM(total_amount), 0)::float AS amount FROM orders
      WHERE paid_at IS NOT NULL
        AND paid_at::timestamptz >= ${range.start}::timestamptz AND paid_at::timestamptz < ${range.end}::timestamptz
      GROUP BY currency
    `),
  ]);
  const visits = traffic.rows[0];
  const transactions = sales.rows[0];
  const rate = Number(visits?.visitors) ? `${(Number(transactions?.converted || 0) / Number(visits.visitors) * 100).toFixed(1).replace(".", ",")}%` : "-";
  const amount = revenue.rows.length ? revenue.rows.map((row) => `${Number(row.amount).toLocaleString("ru-RU")} ${row.currency}`).join(" · ") : "0";
  const message = [
    kind === "daily" ? "📊 Ежедневная сводка SIMKA" : "📊 Недельная сводка SIMKA",
    `${range.start.slice(0, 10)} - ${new Date(new Date(range.end).getTime() - 1).toISOString().slice(0, 10)} (UTC)`,
    "",
    `Посетители: ${visits?.visitors ?? 0} · сессии: ${visits?.sessions ?? 0} · страницы: ${visits?.page_views ?? 0}`,
    `События: ${visits?.events ?? 0}`,
    `Заказы: ${transactions?.created ?? 0} · оплачено: ${transactions?.paid ?? 0} · возвраты: ${transactions?.refunds ?? 0}`,
    `Покупатели: ${transactions?.buyers ?? 0} · конверсия посетитель→покупатель: ${rate}`,
    `Оборот оплаченных заказов: ${amount}`,
    "",
    "Только Human-трафик и посетители с согласием. Конверсия учитывает покупку после посещения в этом периоде. Оборот до вычета возвратов и расходов.",
  ].join("\n");
  const recipients = reportRecipients();
  if (!recipients.length) throw new Error("ANALYTICS_RECIPIENTS_NOT_CONFIGURED");
  let sent = 0;
  for (const chatId of recipients) {
    if (await sendTelegramOnce(`analytics:${kind}:${range.label}:${chatId}`, chatId, message)) sent += 1;
  }
  return { sent, recipients: recipients.length, range: range.label };
}

async function retryGaEvents() {
  if (!process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || !process.env.GA_MEASUREMENT_API_SECRET) return { configured: false, attempted: 0, sent: 0, failed: 0 };
  const db = getDb();
  const pending = await db.select({ id: orders.id, status: orders.status, paidAt: orders.paidAt,
    purchaseSentAt: orders.analyticsPurchaseSentAt, cancellationSentAt: orders.analyticsCancellationSentAt,
    refundSentAt: orders.analyticsRefundSentAt }).from(orders).where(and(or(
    and(isNotNull(orders.paidAt), isNull(orders.analyticsPurchaseSentAt), sql`${orders.paidAt}::timestamptz >= now() - interval '72 hours'`),
    and(eq(orders.status, "CANCELLED"), isNull(orders.analyticsCancellationSentAt), sql`${orders.updatedAt}::timestamptz >= now() - interval '72 hours'`),
    and(eq(orders.status, "REFUNDED"), isNull(orders.analyticsRefundSentAt), sql`${orders.refundedAt}::timestamptz >= now() - interval '72 hours'`),
  ), isNotNull(orders.analyticsClientId), isNotNull(orders.firstPartyClientId), sql`(
    SELECT (p.decision = 'accepted' AND p.policy_version = ${ANALYTICS_POLICY_VERSION})
    FROM privacy_consent_events p WHERE p.consent_id = ${orders.firstPartyClientId}
    ORDER BY p.created_at DESC, p.id DESC LIMIT 1
  ) IS TRUE`)).orderBy(asc(orders.createdAt)).limit(100);
  let attempted = 0;
  let sent = 0;
  let failed = 0;
  for (const order of pending) {
    const events = [
      order.paidAt && !order.purchaseSentAt ? "PAID" : null,
      order.status === "CANCELLED" && !order.cancellationSentAt ? "CANCELLED" : null,
      order.status === "REFUNDED" && !order.refundSentAt ? "REFUNDED" : null,
    ] as const;
    for (const event of events) {
      if (!event) continue;
      attempted += 1;
      try { if (await sendOrderAnalytics(order.id, event)) sent += 1; }
      catch { failed += 1; }
    }
  }
  if (failed) await recordOperationalEvent({ kind: "analytics_delivery_error", severity: "error", area: "analytics", path: "/api/operations/analytics", code: "ga_retry_failed" });
  return { configured: true, attempted, sent, failed, pendingLimitReached: pending.length === 100 };
}

async function hourlyAlerts() {
  const now = new Date();
  const currentEnd = now.toISOString();
  const currentStart = new Date(now.getTime() - 2 * 3_600_000).toISOString();
  const previousStart = new Date(now.getTime() - 4 * 3_600_000).toISOString();
  const db = getDb();
  const metrics = await Promise.all([previousStart, currentStart].map(async (start, index) => {
    const end = index ? currentEnd : currentStart;
    const [result] = (await db.execute<{ sessions: number; events: number; paid: number; payment_failures: number }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM analytics_sessions WHERE traffic_class = 'HUMAN'
          AND started_at::timestamptz >= ${start}::timestamptz AND started_at::timestamptz < ${end}::timestamptz) AS sessions,
        (SELECT COUNT(*)::int FROM analytics_events e JOIN analytics_sessions s ON s.id = e.session_id WHERE s.traffic_class = 'HUMAN'
          AND e.occurred_at::timestamptz >= ${start}::timestamptz AND e.occurred_at::timestamptz < ${end}::timestamptz) AS events,
        (SELECT COUNT(*)::int FROM orders WHERE status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')
          AND paid_at::timestamptz >= ${start}::timestamptz AND paid_at::timestamptz < ${end}::timestamptz) AS paid,
        (SELECT COUNT(*)::int FROM crypto_payments WHERE status IN ('FAILED','CREATE_FAILED','MISMATCH','REVIEW_REQUIRED')
          AND updated_at::timestamptz >= ${start}::timestamptz AND updated_at::timestamptz < ${end}::timestamptz) AS payment_failures
    `)).rows;
    return result;
  }));
  const [previous, current] = metrics;
  const alerts: Array<{ code: string; text: string }> = [];
  if (Number(previous.sessions) >= 20 && Number(previous.events) >= 40 && Number(current.events) === 0) {
    alerts.push({ code: "events_stopped", text: "За последние 2 часа не получено ни одного события после активного предыдущего периода. Возможны остановка трекера или отсутствие трафика; проверьте доступность сайта и сбор событий." });
  }
  if (Number(current.payment_failures) >= 3 && Number(current.payment_failures) / Math.max(1, Number(current.payment_failures) + Number(current.paid)) >= 0.3) {
    alerts.push({ code: "payments", text: `Проблемы с криптооплатой: ${current.payment_failures} неуспешных/требующих проверки платежей за 2 часа, оплачено ${current.paid}.` });
  }
  if (Number(previous.sessions) >= 40 && Number(current.sessions) >= 40 && Number(previous.paid) >= 5
    && Number(current.paid) / Number(current.sessions) < 0.5 * Number(previous.paid) / Number(previous.sessions)) {
    alerts.push({ code: "conversion", text: `Падение отношения оплат к сессиям более чем на 50%: ${previous.paid}/${previous.sessions} → ${current.paid}/${current.sessions}. Проверьте воронку и платежи.` });
  }
  if (Number(previous.sessions) >= 20 && Number(current.sessions) >= 20 && Number(previous.events) >= 40
    && Number(current.events) / Number(current.sessions) < 0.3 * Number(previous.events) / Number(previous.sessions)) {
    alerts.push({ code: "events", text: `Поток событий на сессию упал более чем на 70%: ${previous.events}/${previous.sessions} → ${current.events}/${current.sessions}. Проверьте трекер и согласия.` });
  }
  const recipients = reportRecipients();
  if (!recipients.length) throw new Error("ANALYTICS_RECIPIENTS_NOT_CONFIGURED");
  let sent = 0;
  for (const alert of alerts) for (const chatId of recipients) {
    const message = `⚠️ Аналитика SIMKA\n${alert.text}\n\nПериод: последние 2 часа UTC. Это автоматический сигнал по порогам, проверьте данные вручную.`;
    if (await sendTelegramOnce(`analytics:alert:${alert.code}:${now.toISOString().slice(0, 10)}:${chatId}`, chatId, message)) sent += 1;
  }
  return { activeAlerts: alerts.map((alert) => alert.code), sent };
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  const task = new URL(request.url).searchParams.get("task");
  if (task !== "daily" && task !== "weekly" && task !== "hourly") return Response.json({ error: "Unknown task" }, { status: 400 });
  try {
    const result = task === "hourly" ? { ga: await retryGaEvents(), alerts: await hourlyAlerts() } : await scheduledReport(task);
    return Response.json({ ok: true, task, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("analytics_schedule_failed", { task, name: error instanceof Error ? error.message : "UnknownError" });
    await recordOperationalEvent({ kind: "analytics_schedule_error", severity: "error", area: "analytics", path: "/api/operations/analytics", code: `scheduled_${task}_failed` });
    return Response.json({ error: "Не удалось выполнить задачу аналитики" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
