import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { orderItems, orders } from "@/db/schema";
import { getProductById } from "@/lib/catalog";

const payloadSchema = z.object({
  requestId: z.string().uuid(),
  customerName: z.string().trim().min(2).max(100),
  customerEmail: z.string().trim().email().max(254),
  customerContact: z.string().trim().max(100).default(""),
  deliveryAddress: z.string().trim().max(500).optional(),
  customerComment: z.string().trim().max(1000).default(""),
  paymentMethod: z.enum(["crypto", "manager"]),
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(20) })).min(1).max(30),
}).strict();

function orderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SIM-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function isAllowedOrigin(request: Request, origin: string) {
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    if (originUrl.origin === requestUrl.origin) return true;

    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = (forwardedHost || request.headers.get("host") || "").toLowerCase();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = (forwardedProto || requestUrl.protocol.slice(0, -1)).toLowerCase();

    return Boolean(host) && originUrl.host.toLowerCase() === host && originUrl.protocol.toLowerCase() === `${protocol}:`;
  } catch {
    return false;
  }
}

async function notifyManagers(order: {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerContact: string;
  paymentMethod: "crypto" | "manager";
  totalAmount: number;
  items: Array<{ productName: string; quantity: number }>;
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds = (process.env.TELEGRAM_ADMIN_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!token || !adminIds.length) return;
  const paymentLabel = order.paymentMethod === "manager" ? "через менеджера" : "криптовалюта (ожидает провайдера)";
  const lines = order.items.map((item) => `• ${item.productName} × ${item.quantity}`).join("\n");
  const text = [
    "Новый заказ SIMKA",
    `№ ${order.orderNumber}`,
    `Клиент: ${order.customerName}`,
    `Email: ${order.customerEmail}`,
    order.customerContact ? `Контакт: ${order.customerContact}` : "",
    `Оплата: ${paymentLabel}`,
    `Сумма: ${order.totalAmount.toLocaleString("ru-RU")} RUB`,
    "",
    lines,
    "",
    `Для подтверждения оплаты: /paid ${order.orderNumber}`,
  ].filter(Boolean).join("\n");
  await Promise.all(adminIds.map(async (chatId) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!response.ok) throw new Error("TELEGRAM_NOTIFY_FAILED");
  }));
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 20_000) return Response.json({ error: "Слишком большой запрос" }, { status: 413 });

  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(request, origin)) return Response.json({ error: "Недопустимый источник запроса" }, { status: 403 });

  try {
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Проверьте заполненные поля", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    if (parsed.data.paymentMethod === "crypto" && !process.env.CRYPTO_PAYMENT_PROVIDER) {
      return Response.json({ error: "Криптовалютная оплата пока не подключена. Выберите оплату через менеджера." }, { status: 503 });
    }

    const db = getDb();
    const [existing] = await db.select({ orderNumber: orders.orderNumber, status: orders.status }).from(orders).where(eq(orders.requestId, parsed.data.requestId)).limit(1);
    if (existing) return Response.json({ order: existing }, { status: 200, headers: { "Cache-Control": "no-store" } });

    const resolved = parsed.data.items.map((line) => {
      const product = getProductById(line.productId);
      if (!product || !product.available) throw new Error("PRODUCT_UNAVAILABLE");
      return { product, quantity: line.quantity, lineTotal: product.price * line.quantity };
    });
    const hasPhysicalSim = resolved.some(({ product }) => product.type === "SIM");
    if (hasPhysicalSim && !parsed.data.deliveryAddress) return Response.json({ error: "Укажите адрес доставки физической SIM" }, { status: 400 });

    const id = crypto.randomUUID();
    const number = orderNumber();
    const totalAmount = resolved.reduce((sum, line) => sum + line.lineTotal, 0);
    const status = parsed.data.paymentMethod === "manager" ? "WAITING_FOR_MANAGER" : "WAITING_PAYMENT";
    await db.transaction(async (tx) => {
      await tx.insert(orders).values({ id, requestId: parsed.data.requestId, orderNumber: number, customerName: parsed.data.customerName, customerEmail: parsed.data.customerEmail.toLowerCase(), customerContact: parsed.data.customerContact, deliveryAddress: parsed.data.deliveryAddress, customerComment: parsed.data.customerComment, paymentMethod: parsed.data.paymentMethod, status, totalAmount });
      await tx.insert(orderItems).values(resolved.map(({ product, quantity, lineTotal }) => ({ id: crypto.randomUUID(), orderId: id, productId: product.id, sku: product.sku, productName: `${product.country} · ${product.data}`, simType: product.type, unitPrice: product.price, quantity, lineTotal })));
    });
    void notifyManagers({
      orderNumber: number,
      customerName: parsed.data.customerName,
      customerEmail: parsed.data.customerEmail.toLowerCase(),
      customerContact: parsed.data.customerContact,
      paymentMethod: parsed.data.paymentMethod,
      totalAmount,
      items: resolved.map(({ product, quantity }) => ({ productName: `${product.country} · ${product.data}`, quantity })),
    }).catch((error) => console.error("order_manager_notification_failed", { name: error instanceof Error ? error.name : "UnknownError" }));
    return Response.json({ order: { orderNumber: number, status, totalAmount, currency: "RUB" } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Некорректный формат запроса" }, { status: 400 });
    if (error instanceof Error && error.message === "PRODUCT_UNAVAILABLE") return Response.json({ error: "Один из тарифов больше недоступен" }, { status: 409 });
    console.error("order_creation_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Не удалось создать заказ. Попробуйте ещё раз." }, { status: 500 });
  }
}
