import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { customerAccounts } from "@/db/schema";
import { getDb } from "@/db";
import { createSession, hashPassword, setSessionCookie, validatePassword } from "@/lib/customer-auth";
import { absoluteUrl } from "@/lib/seo";

function redirect(path: string) {
  return NextResponse.redirect(absoluteUrl(path), 303);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const contact = String(form.get("contact") || "").trim();
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("passwordConfirmation") || "");
    if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || contact.length > 100 || !validatePassword(password) || password !== confirmation) {
      return redirect("/account/register?error=Проверьте%20данные%20и%20пароль%20(минимум%208%20символов)");
    }
    const db = getDb();
    if ((await db.select({ id: customerAccounts.id }).from(customerAccounts).where(eq(customerAccounts.email, email)).limit(1))[0]) {
      return redirect("/account/login?error=Аккаунт%20с%20этим%20email%20уже%20существует");
    }
    const [account] = await db.insert(customerAccounts).values({ id: crypto.randomUUID(), email, passwordHash: await hashPassword(password), name, contact }).returning({ id: customerAccounts.id });
    const response = redirect("/account");
    setSessionCookie(response, await createSession(account.id));
    return response;
  } catch (error) {
    console.error("customer_register_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return redirect("/account/register?error=Не%20удалось%20создать%20аккаунт");
  }
}
