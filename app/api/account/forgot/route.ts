import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { customerAccounts } from "@/db/schema";
import { getDb } from "@/db";
import { createPasswordResetToken, sameOrigin } from "@/lib/customer-auth";
import { escapeHtml, sendTransactionalEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/seo";

function response() {
  return NextResponse.redirect(absoluteUrl("/account/forgot?sent=1"), 303);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return response();
  const [account] = await getDb().select({ id: customerAccounts.id, name: customerAccounts.name, email: customerAccounts.email }).from(customerAccounts).where(eq(customerAccounts.email, email)).limit(1);
  if (account) {
    const token = await createPasswordResetToken(account.id);
    const resetUrl = absoluteUrl(`/account/reset?token=${encodeURIComponent(token)}`);
    try {
      await sendTransactionalEmail({
        to: account.email,
        subject: "Восстановление доступа — SIMKA",
        text: `Здравствуйте, ${account.name}!\n\nЧтобы задать новый пароль, откройте ссылку: ${resetUrl}\n\nСсылка действует один час. Если вы не запрашивали восстановление, просто проигнорируйте это письмо.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1>Восстановление доступа</h1><p>Здравствуйте, ${escapeHtml(account.name)}!</p><p><a href="${escapeHtml(resetUrl)}">Задать новый пароль</a></p><p>Ссылка действует один час. Если вы не запрашивали восстановление, проигнорируйте письмо.</p></div>`,
      });
    } catch (error) {
      console.error("customer_password_reset_email_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    }
  }
  return response();
}
