import { and, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { orders, promoCodes } from "@/db/schema";
import { evaluatePromoCode, isValidPromoCodeFormat, normalizePromoCode } from "@/lib/promo-codes";
import { consumeRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { sameRequestOrigin } from "@/lib/request-security";

const schema = z.object({
  code: z.string().trim().min(3).max(32),
  subtotalAmount: z.number().int().positive().max(100_000_000),
  currency: z.string().trim().min(3).max(8),
}).strict();

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 2_000) return Response.json({ error: "Слишком большой запрос" }, { status: 413 });
  if (!sameRequestOrigin(request)) return Response.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const rateLimit = await consumeRateLimit({ request, action: "promo-validate", limit: 30, windowMs: 10 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds, "Слишком много проверок. Подождите и попробуйте снова.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isValidPromoCodeFormat(parsed.data?.code ?? "")) {
    return Response.json({ error: "Проверьте промокод" }, { status: 400 });
  }
  const code = normalizePromoCode(parsed.data.code);
  const db = getDb();
  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
  if (!promo) return Response.json({ error: "Промокод не найден" }, { status: 404 });
  const [usage] = await db.select({ count: sql<number>`count(*)::int` }).from(orders)
    .where(and(eq(orders.promoCode, code), notInArray(orders.status, ["CANCELLED", "REFUNDED", "FAILED"])));
  const result = evaluatePromoCode(promo, { subtotalAmount: parsed.data.subtotalAmount, currency: parsed.data.currency, usedCount: usage?.count ?? 0 });
  if (!result.valid) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ promo: { code: result.code, discountAmount: result.discountAmount } }, { headers: { "Cache-Control": "no-store" } });
}
