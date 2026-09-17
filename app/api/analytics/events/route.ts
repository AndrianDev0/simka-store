import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { analyticsEvents, analyticsSessions, analyticsVisitors, privacyConsentEvents } from "@/db/schema";
import { allowsAnalytics } from "@/lib/analytics-policy";
import { getCurrentAccount, sameOrigin } from "@/lib/customer-auth";
import { analyticsSessionExitState, parseAnalyticsUserAgent, safeAnalyticsPath, safeHeaderLocation, sanitizeAnalyticsParams, validAnalyticsEventName } from "@/lib/first-party-analytics";
import { consumeRateLimit, contentLengthWithin, tooManyRequests } from "@/lib/rate-limit";
import { classifyTraffic } from "@/lib/traffic-classification";

export const runtime = "nodejs";

const optionalText = (maximum: number) => z.string().trim().max(maximum).optional();
const payloadSchema = z.object({
  eventId: z.string().uuid(),
  clientId: z.string().uuid(),
  sessionId: z.string().uuid(),
  name: z.string().min(1).max(64).refine(validAnalyticsEventName),
  path: z.string().max(1000),
  occurredAt: z.string().datetime(),
  params: z.record(z.unknown()).optional(),
  attribution: z.object({
    source: optionalText(120), medium: optionalText(120), campaign: optionalText(160),
    content: optionalText(160), term: optionalText(160), referrerHost: optionalText(255),
  }).optional(),
  device: z.object({
    language: optionalText(35), timezone: optionalText(80), connectionType: optionalText(24),
    screenWidth: z.number().int().min(0).max(100_000).optional(), screenHeight: z.number().int().min(0).max(100_000).optional(),
    viewportWidth: z.number().int().min(0).max(100_000).optional(), viewportHeight: z.number().int().min(0).max(100_000).optional(),
    pixelRatio: z.number().finite().min(0.1).max(20).optional(),
    automation: z.boolean().optional(),
  }).optional(),
});

function boundedOccurrence(value: string, now: Date) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 5 * 60_000 || timestamp < now.getTime() - 24 * 60 * 60_000) return now.toISOString();
  return new Date(timestamp).toISOString();
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!contentLengthWithin(request, 32_000)) return new Response("Слишком большой запрос", { status: 413 });
  let json: unknown;
  try { json = await request.json(); }
  catch { return Response.json({ error: "Некорректный запрос" }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Некорректное событие" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const rateLimit = await consumeRateLimit({ request, action: "analytics-event", subject: parsed.data.clientId, limit: 1_000, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);
  const db = getDb();
  const [consent, existingSession, account] = await Promise.all([
    db.select({ decision: privacyConsentEvents.decision, policyVersion: privacyConsentEvents.policyVersion }).from(privacyConsentEvents).where(eq(privacyConsentEvents.consentId, parsed.data.clientId)).orderBy(desc(privacyConsentEvents.createdAt)).limit(1),
    db.select({ clientId: analyticsSessions.clientId, startedAt: analyticsSessions.startedAt, eventCount: analyticsSessions.eventCount, pageViews: analyticsSessions.pageViews, trafficClass: analyticsSessions.trafficClass, trafficReasons: analyticsSessions.trafficReasons }).from(analyticsSessions).where(eq(analyticsSessions.id, parsed.data.sessionId)).limit(1),
    getCurrentAccount(),
  ]);
  if (!allowsAnalytics(consent[0])) {
    return Response.json({ error: "Нет актуального согласия на аналитику" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (existingSession[0] && existingSession[0].clientId !== parsed.data.clientId) return Response.json({ error: "Некорректная сессия" }, { status: 409, headers: { "Cache-Control": "no-store" } });

  const now = new Date();
  const occurredAt = boundedOccurrence(parsed.data.occurredAt, now);
  const path = safeAnalyticsPath(parsed.data.path);
  const params = sanitizeAnalyticsParams(parsed.data.params);
  const exitState = analyticsSessionExitState(parsed.data.name, params, occurredAt);
  const attribution = parsed.data.attribution;
  const detected = parseAnalyticsUserAgent(request.headers.get("user-agent") || "");
  const countryCode = safeHeaderLocation(request.headers.get("cf-ipcountry") || request.headers.get("x-vercel-ip-country") || request.headers.get("x-country"), 8)?.toUpperCase() ?? null;
  const region = safeHeaderLocation(request.headers.get("cf-region") || request.headers.get("x-vercel-ip-country-region"), 120);
  const city = safeHeaderLocation(request.headers.get("cf-ipcity") || request.headers.get("x-vercel-ip-city"), 120);
  const device = parsed.data.device;
  const traffic = classifyTraffic({
    userAgent: request.headers.get("user-agent") || "",
    automation: device?.automation,
    eventName: parsed.data.name,
    sessionStartedAt: existingSession[0]?.startedAt || occurredAt,
    occurredAt,
    priorEventCount: existingSession[0]?.eventCount || 0,
    priorPageViews: existingSession[0]?.pageViews || 0,
    priorClass: existingSession[0]?.trafficClass,
    priorReasons: existingSession[0]?.trafficReasons,
  });

  const recorded = await db.transaction(async (tx) => {
    if (account) await tx.update(privacyConsentEvents).set({ accountId: account.id }).where(and(eq(privacyConsentEvents.consentId, parsed.data.clientId), isNull(privacyConsentEvents.accountId)));
    await tx.insert(analyticsVisitors).values({
      clientId: parsed.data.clientId, accountId: account?.id ?? null,
      firstSource: attribution?.source || null, firstMedium: attribution?.medium || null,
      firstCampaign: attribution?.campaign || null, firstReferrerHost: attribution?.referrerHost || null,
      firstSeenAt: occurredAt, lastSeenAt: occurredAt, sessionsCount: 0,
    }).onConflictDoUpdate({ target: analyticsVisitors.clientId, set: {
      lastSeenAt: occurredAt,
      accountId: sql`COALESCE(${analyticsVisitors.accountId}, ${account?.id ?? null})`,
    } });
    const newSession = await tx.insert(analyticsSessions).values({
      id: parsed.data.sessionId, clientId: parsed.data.clientId, entryPath: path, exitPath: path,
      source: attribution?.source || null, medium: attribution?.medium || null, campaign: attribution?.campaign || null,
      content: attribution?.content || null, term: attribution?.term || null, referrerHost: attribution?.referrerHost || null,
      deviceType: detected.deviceType, operatingSystem: detected.operatingSystem, browser: detected.browser,
      countryCode, region, city, language: device?.language || null, timezone: device?.timezone || null,
      screenWidth: device?.screenWidth, screenHeight: device?.screenHeight,
      viewportWidth: device?.viewportWidth, viewportHeight: device?.viewportHeight,
      pixelRatio: device?.pixelRatio ? Math.round(device.pixelRatio * 100) : null,
      connectionType: device?.connectionType || null, trafficClass: traffic.trafficClass, trafficReasons: traffic.reasons, pageViews: 0, eventCount: 0,
      startedAt: occurredAt, lastSeenAt: occurredAt, ...exitState,
    }).onConflictDoNothing({ target: analyticsSessions.id }).returning({ id: analyticsSessions.id });
    const inserted = await tx.insert(analyticsEvents).values({
      id: parsed.data.eventId, sessionId: parsed.data.sessionId, clientId: parsed.data.clientId,
      accountId: account?.id ?? null, name: parsed.data.name, path, params, occurredAt,
    }).onConflictDoNothing({ target: analyticsEvents.id }).returning({ id: analyticsEvents.id });
    if (!inserted[0]) return false;
    await tx.update(analyticsSessions).set({
      exitPath: path, lastSeenAt: occurredAt,
      trafficClass: sql`CASE WHEN ${analyticsSessions.trafficClass} = 'BOT' OR ${traffic.trafficClass} = 'BOT' THEN 'BOT' WHEN ${analyticsSessions.trafficClass} = 'SUSPICIOUS' OR ${traffic.trafficClass} = 'SUSPICIOUS' THEN 'SUSPICIOUS' ELSE 'HUMAN' END`,
      trafficReasons: traffic.reasons,
      ...exitState,
      eventCount: sql`${analyticsSessions.eventCount} + 1`,
      pageViews: parsed.data.name === "page_view" ? sql`${analyticsSessions.pageViews} + 1` : analyticsSessions.pageViews,
    }).where(and(eq(analyticsSessions.id, parsed.data.sessionId), eq(analyticsSessions.clientId, parsed.data.clientId)));
    if (newSession[0]) await tx.update(analyticsVisitors).set({ sessionsCount: sql`${analyticsVisitors.sessionsCount} + 1` }).where(eq(analyticsVisitors.clientId, parsed.data.clientId));
    return true;
  });

  return Response.json({ recorded }, { status: recorded ? 201 : 200, headers: { "Cache-Control": "no-store" } });
}
