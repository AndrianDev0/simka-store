import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { privacyConsentEvents, searchAnalytics } from "@/db/schema";
import { sameOrigin } from "@/lib/customer-auth";
import { consumeRateLimit, contentLengthWithin, tooManyRequests } from "@/lib/rate-limit";
import { normalizeSearchQuery } from "@/lib/search-analytics";

export const runtime = "nodejs";

const payloadSchema = z.object({
  consentId: z.string().uuid(),
  query: z.string().max(100),
  results: z.number().int().min(0).max(10_000),
}).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!contentLengthWithin(request, 2_000)) return new Response(null, { status: 413 });
  let input: unknown;
  try { input = await request.json(); } catch { return new Response(null, { status: 400 }); }
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return new Response(null, { status: 400 });
  const query = normalizeSearchQuery(parsed.data.query);
  if (!query) return new Response(null, { status: 204 });

  const rateLimit = await consumeRateLimit({ request, action: "search-analytics", subject: parsed.data.consentId, limit: 120, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);
  const db = getDb();
  const [latestConsent] = await db.select({ decision: privacyConsentEvents.decision }).from(privacyConsentEvents).where(eq(privacyConsentEvents.consentId, parsed.data.consentId)).orderBy(desc(privacyConsentEvents.createdAt)).limit(1);
  if (latestConsent?.decision !== "accepted") return new Response(null, { status: 403 });

  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const id = createHash("sha256").update(`${day}\n${query}`).digest("hex");
  const noResults = parsed.data.results === 0 ? 1 : 0;
  await db.insert(searchAnalytics).values({ id, day, query, searches: 1, noResultSearches: noResults, totalResults: parsed.data.results, firstSeenAt: now, lastSeenAt: now }).onConflictDoUpdate({
    target: searchAnalytics.id,
    set: {
      searches: sql`${searchAnalytics.searches} + 1`,
      noResultSearches: sql`${searchAnalytics.noResultSearches} + ${noResults}`,
      totalResults: sql`${searchAnalytics.totalResults} + ${parsed.data.results}`,
      lastSeenAt: now,
    },
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

