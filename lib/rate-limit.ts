import { lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { requestRateLimits } from "@/db/schema";
import { rateLimitSubjectHash } from "@/lib/request-security";

export { contentLengthWithin, rateLimitSubjectHash, requestNetworkIdentity } from "@/lib/request-security";

type RateLimitInput = {
  request: Request;
  action: string;
  limit: number;
  windowMs: number;
  subject?: string;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export async function consumeRateLimit({ request, action, limit, windowMs, subject = "" }: RateLimitInput): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const windowStartedAt = new Date(windowStartMs).toISOString();
  const subjectHash = rateLimitSubjectHash(request, action, subject);
  const key = `${action}:${windowStartMs}:${subjectHash}`;
  const db = getDb();
  const [row] = await db.insert(requestRateLimits).values({ key, action, subjectHash, windowStartedAt, count: 1, updatedAt: new Date(nowMs).toISOString() }).onConflictDoUpdate({
    target: requestRateLimits.key,
    set: { count: sql`${requestRateLimits.count} + 1`, updatedAt: new Date(nowMs).toISOString() },
  }).returning({ count: requestRateLimits.count });

  // Opportunistic cleanup keeps the table bounded without requiring a scheduler.
  if (row.count === 1 && nowMs % 97 === 0) {
    await db.delete(requestRateLimits).where(lt(requestRateLimits.updatedAt, new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString()));
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000));
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count), retryAfterSeconds };
}

export function tooManyRequests(retryAfterSeconds: number, message = "Слишком много запросов. Попробуйте позже.") {
  return Response.json({ error: message }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } });
}
