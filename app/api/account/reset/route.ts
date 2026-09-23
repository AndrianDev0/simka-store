import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { customerAccounts, customerPasswordResets, customerSessions } from "@/db/schema";
import { getDb } from "@/db";
import { createSession, findPasswordReset, hashPassword, sameOrigin, setAnalyticsIdentityCookie, setSessionCookie, validatePassword } from "@/lib/customer-auth";
import { absoluteUrl } from "@/lib/seo";
import { consumeRateLimit, contentLengthWithin, tooManyRequests } from "@/lib/rate-limit";

function redirect(path: string) {
  return NextResponse.redirect(absoluteUrl(path), 303);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!contentLengthWithin(request, 10_000)) return new Response("Слишком большой запрос", { status: 413 });
  const rateLimit = await consumeRateLimit({ request, action: "password-reset", limit: 10, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);
  const form = await request.formData();
  const token = String(form.get("token") || "");
  const password = String(form.get("password") || "");
  const confirmation = String(form.get("passwordConfirmation") || "");
  const reset = await findPasswordReset(token);
  if (!reset) return redirect("/account/reset?error=Ссылка%20недействительна%20или%20истекла");
  if (!validatePassword(password) || password !== confirmation) return redirect(`/account/reset?error=Пароли%20должны%20совпадать%20и%20содержать%20не%20менее%2012%20символов&token=${encodeURIComponent(token)}`);
  const now = new Date().toISOString();
  const db = getDb();
  const passwordHash = await hashPassword(password);
  const changed = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM customer_accounts WHERE id = ${reset.accountId} FOR UPDATE`);
    const [consumed] = await tx.delete(customerPasswordResets).where(and(eq(customerPasswordResets.id, reset.id), eq(customerPasswordResets.accountId, reset.accountId), sql`${customerPasswordResets.expiresAt}::timestamptz > now()`)).returning({ id: customerPasswordResets.id });
    if (!consumed) return false;
    await tx.update(customerAccounts).set({ passwordHash, updatedAt: now }).where(eq(customerAccounts.id, reset.accountId));
    await tx.delete(customerSessions).where(eq(customerSessions.accountId, reset.accountId));
    await tx.delete(customerPasswordResets).where(eq(customerPasswordResets.accountId, reset.accountId));
    return true;
  });
  if (!changed) return redirect("/account/reset?error=Ссылка%20недействительна%20или%20истекла");
  const response = redirect("/account?analytics=password_reset");
  setSessionCookie(response, await createSession(reset.accountId));
  setAnalyticsIdentityCookie(response, "account-switch");
  return response;
}
