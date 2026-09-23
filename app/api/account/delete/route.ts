import { and, eq, inArray, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { analyticsEvents, analyticsVisitors, customerAccounts, orderItems, orders } from "@/db/schema";
import { clearSessionCookie, getCurrentAccount, sameOrigin, setAnalyticsIdentityCookie, verifyPassword } from "@/lib/customer-auth";
import { absoluteUrl } from "@/lib/seo";
import { consumeRateLimit, contentLengthWithin, tooManyRequests } from "@/lib/rate-limit";
import { recordOperationalEvent } from "@/lib/operational-events";

const terminalOrderStatuses = ["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"];

function redirect(path: string) {
  return NextResponse.redirect(absoluteUrl(path), 303);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!contentLengthWithin(request, 10_000)) return new Response("Слишком большой запрос", { status: 413 });
  const rateLimit = await consumeRateLimit({ request, action: "account-delete", limit: 3, windowMs: 24 * 60 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);

  const account = await getCurrentAccount();
  if (!account) return redirect("/account/login?returnTo=/account/privacy");
  const form = await request.formData();
  const password = String(form.get("password") || "");
  const confirmed = String(form.get("confirm") || "") === "yes";
  const db = getDb();
  const [storedAccount] = await db.select({ passwordHash: customerAccounts.passwordHash }).from(customerAccounts).where(eq(customerAccounts.id, account.id)).limit(1);
  if (!storedAccount || !confirmed || !(await verifyPassword(password, storedAccount.passwordHash))) {
    return redirect("/account/privacy?error=Подтвердите%20удаление%20и%20введите%20верный%20пароль");
  }

  try {
    await db.transaction(async (tx) => {
      const [activeOrder] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.customerAccountId, account.id), notInArray(orders.status, terminalOrderStatuses))).limit(1);
      if (activeOrder) throw new Error("ACTIVE_ORDERS");

      const ownedOrders = await tx.select({ id: orders.id }).from(orders).where(eq(orders.customerAccountId, account.id));
      const orderIds = ownedOrders.map((order) => order.id);
      const now = new Date().toISOString();
      if (orderIds.length) {
        await tx.update(orderItems).set({
          activationCodeEncrypted: null,
          fulfillmentInstructions: null,
          trackingNumber: null,
          trackingUrl: null,
          updatedAt: now,
        }).where(inArray(orderItems.orderId, orderIds));
        await tx.update(orders).set({
          customerAccountId: null,
          customerName: "Удалённый клиент",
          customerEmail: `deleted-${crypto.randomUUID()}@invalid.local`,
          customerContact: "",
          deliveryAddress: null,
          customerComment: "",
          analyticsClientId: null,
          firstPartyClientId: null,
          updatedAt: now,
        }).where(eq(orders.customerAccountId, account.id));
      }
      await tx.delete(analyticsEvents).where(eq(analyticsEvents.accountId, account.id));
      await tx.delete(analyticsVisitors).where(eq(analyticsVisitors.accountId, account.id));
      await tx.delete(customerAccounts).where(eq(customerAccounts.id, account.id));
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ACTIVE_ORDERS") {
      return redirect("/account/privacy?error=Сначала%20дождитесь%20завершения%20или%20отмены%20активных%20заказов");
    }
    console.error("customer_account_deletion_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    await recordOperationalEvent({ kind: "api_error", severity: "error", area: "account", path: "/api/account/delete", code: "account_deletion_failed" });
    return redirect("/account/privacy?error=Не%20удалось%20удалить%20аккаунт.%20Попробуйте%20позже");
  }

  const response = redirect("/account/login?deleted=1");
  clearSessionCookie(response);
  setAnalyticsIdentityCookie(response, "guest");
  return response;
}
