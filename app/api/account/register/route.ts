import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { customerAccounts } from "@/db/schema";
import { getDb } from "@/db";
import { createSession, hashPassword, sameOrigin, setSessionCookie, validatePassword } from "@/lib/customer-auth";
import { escapeHtml, sendTransactionalEmail } from "@/lib/email";
import { getEmailValidationError } from "@/lib/email-validation";
import { absoluteUrl } from "@/lib/seo";
import { consumeRateLimit, contentLengthWithin, tooManyRequests } from "@/lib/rate-limit";

function redirect(path: string) {
  return NextResponse.redirect(absoluteUrl(path), 303);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!contentLengthWithin(request, 15_000)) return new Response("Слишком большой запрос", { status: 413 });
  const rateLimit = await consumeRateLimit({ request, action: "account-register", limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);
  try {
    const form = await request.formData();
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const contact = String(form.get("contact") || "").trim();
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("passwordConfirmation") || "");
    const emailError = getEmailValidationError(email);
    if (name.length < 2 || name.length > 100 || emailError || contact.length > 100 || !validatePassword(password) || password !== confirmation) {
      if (emailError) return redirect(`/account/register?error=${encodeURIComponent(emailError)}`);
      return redirect("/account/register?error=Проверьте%20данные%20и%20пароль%20(минимум%2012%20символов)");
    }
    const db = getDb();
    if ((await db.select({ id: customerAccounts.id }).from(customerAccounts).where(eq(customerAccounts.email, email)).limit(1))[0]) {
      return redirect("/account/login?error=Аккаунт%20с%20этим%20email%20уже%20существует");
    }
    const [account] = await db.insert(customerAccounts).values({ id: crypto.randomUUID(), email, passwordHash: await hashPassword(password), name, contact }).returning({ id: customerAccounts.id });
    const accountUrl = absoluteUrl("/account");
    const delivery = await sendTransactionalEmail({
      to: email,
      subject: "Добро пожаловать в SIMKA",
      text: `Здравствуйте, ${name}!\n\nВаш личный кабинет SIMKA создан. В нём можно смотреть статусы и историю заказов, повторять заказы и обращаться в поддержку.\n\nОткрыть кабинет: ${accountUrl}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Добро пожаловать в SIMKA</h1><p>Здравствуйте, ${escapeHtml(name)}!</p><p>Ваш личный кабинет создан. В нём можно смотреть статусы и историю заказов, повторять заказы и обращаться в поддержку.</p><p><a href="${escapeHtml(accountUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0b63f6;color:#fff;text-decoration:none">Открыть кабинет</a></p></div>`,
      idempotencyKey: `welcome-account/${account.id}`,
    });
    if (!delivery.delivered) console.warn("customer_welcome_email_not_delivered", { reason: delivery.reason });
    const response = redirect("/account?analytics=sign_up");
    setSessionCookie(response, await createSession(account.id));
    return response;
  } catch (error) {
    console.error("customer_register_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return redirect("/account/register?error=Не%20удалось%20создать%20аккаунт");
  }
}
