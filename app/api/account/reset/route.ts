import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { customerAccounts, customerPasswordResets, customerSessions } from "@/db/schema";
import { getDb } from "@/db";
import { createSession, findPasswordReset, hashPassword, sameOrigin, setSessionCookie, validatePassword } from "@/lib/customer-auth";
import { absoluteUrl } from "@/lib/seo";

function redirect(path: string) {
  return NextResponse.redirect(absoluteUrl(path), 303);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const form = await request.formData();
  const token = String(form.get("token") || "");
  const password = String(form.get("password") || "");
  const confirmation = String(form.get("passwordConfirmation") || "");
  const reset = await findPasswordReset(token);
  if (!reset || !validatePassword(password) || password !== confirmation) return redirect(`/account/reset?error=Ссылка%20недействительна%20или%20пароли%20не%20совпадают&token=${encodeURIComponent(token)}`);
  const now = new Date().toISOString();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(customerAccounts).set({ passwordHash: await hashPassword(password), updatedAt: now }).where(eq(customerAccounts.id, reset.accountId));
    await tx.delete(customerSessions).where(eq(customerSessions.accountId, reset.accountId));
    await tx.delete(customerPasswordResets).where(and(eq(customerPasswordResets.id, reset.id), eq(customerPasswordResets.accountId, reset.accountId)));
  });
  const response = redirect("/account?analytics=password_reset");
  setSessionCookie(response, await createSession(reset.accountId));
  return response;
}
