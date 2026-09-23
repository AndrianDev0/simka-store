import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { customerAccounts } from "@/db/schema";
import { getDb } from "@/db";
import { createSession, getCurrentAccount, hashPassword, passwordHashNeedsUpgrade, sameOrigin, setAnalyticsIdentityCookie, setSessionCookie, verifyPasswordWithFallback } from "@/lib/customer-auth";
import { absoluteUrl } from "@/lib/seo";
import { consumeRateLimit, contentLengthWithin, tooManyRequests } from "@/lib/rate-limit";
import { safeAccountReturnPath } from "@/lib/account-return";

function redirect(path: string) {
  return NextResponse.redirect(absoluteUrl(path), 303);
}

function withAnalytics(path: string, event: string) {
  const url = new URL(path, "https://simka.local");
  url.searchParams.set("analytics", event);
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!contentLengthWithin(request, 10_000)) return new Response("Слишком большой запрос", { status: 413 });
  const rateLimit = await consumeRateLimit({ request, action: "account-login", limit: 10, windowMs: 15 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);
  try {
    const form = await request.formData();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const requestedReturn = new URL(request.url).searchParams.get("returnTo") ?? form.get("returnTo");
    const safeReturn = safeAccountReturnPath(requestedReturn);
    const [account] = await getDb().select({ id: customerAccounts.id, passwordHash: customerAccounts.passwordHash, isBlocked: customerAccounts.isBlocked }).from(customerAccounts).where(eq(customerAccounts.email, email)).limit(1);
    const passwordAccepted = await verifyPasswordWithFallback(password, account && !account.isBlocked ? account.passwordHash : undefined);
    if (!account || account.isBlocked || !passwordAccepted) return redirect(`/account/login?error=Неверный%20email%20или%20пароль&returnTo=${encodeURIComponent(safeReturn)}`);
    if (passwordHashNeedsUpgrade(account.passwordHash)) {
      await getDb().update(customerAccounts).set({ passwordHash: await hashPassword(password) }).where(eq(customerAccounts.id, account.id));
    }
    const previousAccount = await getCurrentAccount();
    const response = redirect(withAnalytics(safeReturn, "login"));
    setSessionCookie(response, await createSession(account.id));
    setAnalyticsIdentityCookie(response, previousAccount && previousAccount.id !== account.id ? "account-switch" : "account");
    return response;
  } catch (error) {
    console.error("customer_login_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return redirect("/account/login?error=Не%20удалось%20выполнить%20вход");
  }
}
