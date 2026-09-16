import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { partnerClicks, partners } from "@/db/schema";
import { sameOrigin } from "@/lib/customer-auth";
import { consumeRateLimit, contentLengthWithin, tooManyRequests } from "@/lib/rate-limit";
import { createPartnerCookie, isValidPartnerCode, normalizePartnerCode, PARTNER_COOKIE, PARTNER_COOKIE_MAX_AGE, PARTNER_VISITOR_COOKIE, cookieValue } from "@/lib/partner-attribution";

const bodySchema = z.object({
  code: z.string().trim().min(3).max(32),
  landingPath: z.string().trim().max(300).default("/"),
}).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!contentLengthWithin(request, 2_000)) return new Response("Слишком большой запрос", { status: 413 });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "Некорректный запрос" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success || !isValidPartnerCode(parsed.data.code)) return Response.json({ error: "Partner ID указан неверно" }, { status: 400 });
  const code = normalizePartnerCode(parsed.data.code);
  const limiter = await consumeRateLimit({ request, action: "partner-visit", subject: code, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!limiter.allowed) return tooManyRequests(limiter.retryAfterSeconds);
  const db = getDb();
  const [partner] = await db.select({ code: partners.code }).from(partners).where(and(eq(partners.code, code), eq(partners.active, true))).limit(1);
  if (!partner) return Response.json({ error: "Партнёрская ссылка неактивна" }, { status: 404 });
  const visitorId = cookieValue(request, PARTNER_VISITOR_COOKIE) || randomUUID();
  const visitorHash = createHash("sha256").update(`partner-visitor:${visitorId}`).digest("base64url");
  const landingPath = parsed.data.landingPath.startsWith("/") ? parsed.data.landingPath.split(/[?#]/, 1)[0] || "/" : "/";
  const now = new Date().toISOString();
  await db.insert(partnerClicks).values({ id: randomUUID(), partnerCode: code, visitorHash, landingPath, firstSeenAt: now, lastSeenAt: now })
    .onConflictDoUpdate({ target: [partnerClicks.partnerCode, partnerClicks.visitorHash], set: { clickCount: sql`${partnerClicks.clickCount} + 1`, landingPath, lastSeenAt: now } });
  const response = NextResponse.json({ ok: true, partnerId: code }, { headers: { "Cache-Control": "no-store" } });
  const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: PARTNER_COOKIE_MAX_AGE };
  response.cookies.set(PARTNER_COOKIE, createPartnerCookie(code), options);
  response.cookies.set(PARTNER_VISITOR_COOKIE, visitorId, options);
  return response;
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(PARTNER_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  response.cookies.set(PARTNER_VISITOR_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
