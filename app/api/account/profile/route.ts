import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { customerAccounts } from "@/db/schema";
import { getDb } from "@/db";
import { getCurrentAccount, sameOrigin } from "@/lib/customer-auth";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const account = await getCurrentAccount();
  if (!account) return NextResponse.redirect(new URL("/account/login", request.url), 303);
  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const contact = String(form.get("contact") || "").trim();
  if (name.length < 2 || name.length > 100 || contact.length > 100) return NextResponse.redirect(new URL("/account?error=Проверьте%20имя%20и%20контакт", request.url), 303);
  await getDb().update(customerAccounts).set({ name, contact, updatedAt: new Date().toISOString() }).where(eq(customerAccounts.id, account.id));
  return NextResponse.redirect(new URL("/account?saved=1", request.url), 303);
}
