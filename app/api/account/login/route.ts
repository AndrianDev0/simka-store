import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { customerAccounts } from "@/db/schema";
import { getDb } from "@/db";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/customer-auth";
import { absoluteUrl } from "@/lib/seo";

function redirect(path: string) {
  return NextResponse.redirect(absoluteUrl(path), 303);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const returnTo = String(form.get("returnTo") || "/account");
    const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/account";
    const [account] = await getDb().select({ id: customerAccounts.id, passwordHash: customerAccounts.passwordHash }).from(customerAccounts).where(eq(customerAccounts.email, email)).limit(1);
    if (!account || !(await verifyPassword(password, account.passwordHash))) return redirect(`/account/login?error=Неверный%20email%20или%20пароль&returnTo=${encodeURIComponent(safeReturn)}`);
    const response = redirect(safeReturn);
    setSessionCookie(response, await createSession(account.id));
    return response;
  } catch (error) {
    console.error("customer_login_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return redirect("/account/login?error=Не%20удалось%20выполнить%20вход");
  }
}
