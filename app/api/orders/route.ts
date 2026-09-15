import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { catalogProducts, orderItems, orders, productVariants } from "@/db/schema";
import { getCatalogProducts } from "@/lib/catalog-repository";
import { escapeHtml, sendTransactionalEmail } from "@/lib/email";

const payloadSchema = z.object({
  requestId: z.string().uuid(),
  customerName: z.string().trim().min(2).max(100),
  customerEmail: z.string().trim().email().max(254),
  customerContact: z.string().trim().max(100).default(""),
  deliveryAddress: z.string().trim().max(500).optional(),
  customerComment: z.string().trim().max(1000).default(""),
  paymentMethod: z.enum(["crypto", "manager"]),
  items: z.array(z.object({ productId: z.number().int().positive(), variantId: z.number().int().positive().optional(), quantity: z.number().int().min(1).max(20) })).min(1).max(30),
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
  currency: string;
  items: Array<{ productName: string; quantity: number }>;
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds = (process.env.TELEGRAM_ADMIN_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!token || !adminIds.length) return false;
  const paymentLabel = order.paymentMethod === "manager" ? "через менеджера" : "криптовалюта (ожидает провайдера)";
  const lines = order.items.map((item) => `• ${item.productName} × ${item.quantity}`).join("\n");
  const text = [
    "Новый заказ SIMKA",
    `№ ${order.orderNumber}`,
    `Клиент: ${order.customerName}`,
    `Email: ${order.customerEmail}`,
    order.customerContact ? `Контакт: ${order.customerContact}` : "",
    `Оплата: ${paymentLabel}`,
    `Сумма: ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`,
    "",
    lines,
    "",
    `Отправьте актуальные реквизиты на email ${order.customerEmail} и подтвердите оплату только после фактического поступления средств.`,
  ].filter(Boolean).join("\n");
  const telegramUsername = order.customerContact.match(/^@([a-zA-Z0-9_]{5,32})$/)?.[1];
  const keyboard = [
    ...(telegramUsername ? [[{ text: "💬 Связаться с клиентом", url: `https://t.me/${telegramUsername}` }]] : []),
    [{ text: "✅ Подтвердить получение оплаты", callback_data: `order:paid_prompt:${order.orderNumber}` }],
    [{ text: "🛒 Открыть заказы", callback_data: "orders:list" }],
  ];
  await Promise.all(adminIds.map(async (chatId) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("TELEGRAM_NOTIFY_FAILED");
  }));
  return true;
}

async function notifyCustomer(order: {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  paymentMethod: "crypto" | "manager";
  totalAmount: number;
  currency: string;
  items: Array<{ productName: string; quantity: number }>;
}) {
  const amount = `${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`;
  const lines = order.items.map((item) => `• ${item.productName} × ${item.quantity}`).join("\n");
  const safeName = escapeHtml(order.customerName);
  const safeNumber = escapeHtml(order.orderNumber);
  const safeAmount = escapeHtml(amount);
  const safeLines = order.items.map((item) => `<li>${escapeHtml(item.productName)} × ${item.quantity}</li>`).join("");
  const paymentText = order.paymentMethod === "manager"
    ? "Менеджер отправит актуальные реквизиты отдельным письмом на этот email. Не оплачивайте по реквизитам из посторонних сообщений."
    : "Платёжная инструкция появится только после подключения защищённого криптопровайдера.";
  return sendTransactionalEmail({
    to: order.customerEmail,
    subject: `Заказ ${order.orderNumber} создан — SIMKA`,
    text: `Здравствуйте, ${order.customerName}!\n\nЗаказ ${order.orderNumber} создан.\nСумма: ${amount}\n\n${lines}\n\n${paymentText}\n\nСохраните номер заказа для обращения в поддержку.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Заказ создан</h1><p>Здравствуйте, ${safeName}!</p><p>Номер заказа: <strong>${safeNumber}</strong><br>Сумма: <strong>${safeAmount}</strong></p><ul>${safeLines}</ul><p>${escapeHtml(paymentText)}</p><p>Сохраните номер заказа для обращения в поддержку.</p></div>`,
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 20_000) return Response.json({ error: "Слишком большой запрос" }, { status: 413 });

  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(request, origin)) return Response.json({ error: "Недопустимый источник запроса" }, { status: 403 });

  let validatedRequestId: string | null = null;
  try {
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Проверьте заполненные поля", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    validatedRequestId = parsed.data.requestId;
    if (parsed.data.paymentMethod === "crypto" && !process.env.CRYPTO_PAYMENT_PROVIDER) {
      return Response.json({ error: "Криптовалютная оплата пока не подключена. Выберите оплату через менеджера." }, { status: 503 });
    }

    const db = getDb();
    const [existing] = await db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).where(eq(orders.requestId, parsed.data.requestId)).limit(1);
    if (existing) return Response.json({ order: { ...existing, managerNotified: false } }, { status: 200, headers: { "Cache-Control": "no-store" } });

    const catalog = await getCatalogProducts({ requireDatabase: true });
    const productById = new Map(catalog.map((product) => [product.id, product]));
    const resolved = parsed.data.items.map((line) => {
      const product = productById.get(line.productId);
      if (!product || !product.available || product.availabilityStatus === "OUT_OF_STOCK" || product.stockQuantity === 0) throw new Error("PRODUCT_UNAVAILABLE");
      const variant = line.variantId
        ? product.variants.find((item) => item.id === line.variantId)
        : product.variants.find((item) => item.sku === product.sku && item.available && item.availabilityStatus !== "OUT_OF_STOCK" && item.stockQuantity !== 0)
          ?? product.variants.find((item) => item.available && item.availabilityStatus !== "OUT_OF_STOCK" && item.stockQuantity !== 0);
      if (line.variantId && !variant) throw new Error("PRODUCT_VARIANT_UNAVAILABLE");
      if (product.variants.length && !variant) throw new Error("PRODUCT_VARIANT_UNAVAILABLE");
      if (variant && (!variant.available || variant.availabilityStatus === "OUT_OF_STOCK" || variant.stockQuantity === 0)) throw new Error("PRODUCT_VARIANT_UNAVAILABLE");
      const unitPrice = variant?.price ?? product.price;
      return { product, variant, quantity: line.quantity, unitPrice, currency: variant?.currency ?? product.currency, lineTotal: unitPrice * line.quantity };
    });
    const quantityByProduct = new Map<number, number>();
    const quantityByVariant = new Map<number, number>();
    for (const line of resolved) {
      quantityByProduct.set(line.product.id, (quantityByProduct.get(line.product.id) ?? 0) + line.quantity);
      if (line.variant) quantityByVariant.set(line.variant.id, (quantityByVariant.get(line.variant.id) ?? 0) + line.quantity);
    }
    for (const [productId, quantity] of quantityByProduct) {
      const product = productById.get(productId)!;
      if (product.stockQuantity !== null && quantity > product.stockQuantity) throw new Error("INSUFFICIENT_STOCK");
    }
    for (const [variantId, quantity] of quantityByVariant) {
      const variant = resolved.find((line) => line.variant?.id === variantId)?.variant;
      if (variant?.stockQuantity !== null && variant?.stockQuantity !== undefined && quantity > variant.stockQuantity) throw new Error("INSUFFICIENT_STOCK");
    }
    const currencies = new Set(resolved.map((line) => line.currency));
    if (currencies.size !== 1) throw new Error("MIXED_CURRENCY");
    const currency = resolved[0].currency;
    const hasPhysicalSim = resolved.some(({ product }) => product.type === "SIM");
    if (hasPhysicalSim && !parsed.data.deliveryAddress) return Response.json({ error: "Укажите адрес доставки физической SIM" }, { status: 400 });

    const id = crypto.randomUUID();
    const number = orderNumber();
    const totalAmount = resolved.reduce((sum, line) => sum + line.lineTotal, 0);
    const status = parsed.data.paymentMethod === "manager" ? "WAITING_FOR_MANAGER" : "WAITING_PAYMENT";
    await db.transaction(async (tx) => {
      for (const [productId, quantity] of quantityByProduct) {
        const product = productById.get(productId)!;
        if (product.stockQuantity === null) continue;
        const updated = await tx.update(catalogProducts).set({
          stockQuantity: sql`${catalogProducts.stockQuantity} - ${quantity}`,
          available: sql`CASE WHEN ${catalogProducts.stockQuantity} - ${quantity} = 0 THEN FALSE ELSE ${catalogProducts.available} END`,
          availabilityStatus: sql`CASE WHEN ${catalogProducts.stockQuantity} - ${quantity} = 0 THEN 'OUT_OF_STOCK' ELSE ${catalogProducts.availabilityStatus} END`,
          updatedAt: new Date().toISOString(),
        }).where(and(eq(catalogProducts.id, productId), gte(catalogProducts.stockQuantity, quantity))).returning({ id: catalogProducts.id });
        if (!updated[0]) throw new Error("INSUFFICIENT_STOCK");
      }
      for (const [variantId, quantity] of quantityByVariant) {
        const variant = resolved.find((line) => line.variant?.id === variantId)?.variant;
        if (!variant || variant.stockQuantity === null) continue;
        const updated = await tx.update(productVariants).set({
          stockQuantity: sql`${productVariants.stockQuantity} - ${quantity}`,
          available: sql`CASE WHEN ${productVariants.stockQuantity} - ${quantity} = 0 THEN FALSE ELSE ${productVariants.available} END`,
          availabilityStatus: sql`CASE WHEN ${productVariants.stockQuantity} - ${quantity} = 0 THEN 'OUT_OF_STOCK' ELSE ${productVariants.availabilityStatus} END`,
          updatedAt: new Date().toISOString(),
        }).where(and(eq(productVariants.id, variantId), gte(productVariants.stockQuantity, quantity))).returning({ id: productVariants.id });
        if (!updated[0]) throw new Error("INSUFFICIENT_STOCK");
      }
      await tx.insert(orders).values({ id, requestId: parsed.data.requestId, orderNumber: number, customerName: parsed.data.customerName, customerEmail: parsed.data.customerEmail.toLowerCase(), customerContact: parsed.data.customerContact, deliveryAddress: parsed.data.deliveryAddress, customerComment: parsed.data.customerComment, paymentMethod: parsed.data.paymentMethod, status, totalAmount, currency, inventoryReserved: true });
      await tx.insert(orderItems).values(resolved.map(({ product, variant, quantity, unitPrice, lineTotal }) => ({ id: crypto.randomUUID(), orderId: id, productId: product.id, variantId: variant?.id, sku: variant?.sku ?? product.sku, productName: variant ? `${product.name} · ${variant.name}` : product.name, simType: product.type, unitPrice, quantity, lineTotal })));
    });
    let managerNotified = false;
    let customerNotified = false;
    const notificationPayload = {
        orderNumber: number,
        customerName: parsed.data.customerName,
        customerEmail: parsed.data.customerEmail.toLowerCase(),
        customerContact: parsed.data.customerContact,
        paymentMethod: parsed.data.paymentMethod,
        totalAmount,
        currency,
        items: resolved.map(({ product, variant, quantity }) => ({ productName: variant ? `${product.name} · ${variant.name}` : product.name, quantity })),
      };
    const [managerResult, customerResult] = await Promise.allSettled([notifyManagers(notificationPayload), notifyCustomer(notificationPayload)]);
    if (managerResult.status === "fulfilled") managerNotified = managerResult.value;
    else console.error("order_manager_notification_failed", { name: managerResult.reason instanceof Error ? managerResult.reason.name : "UnknownError" });
    if (customerResult.status === "fulfilled") customerNotified = customerResult.value.delivered;
    else console.error("order_customer_notification_failed", { name: customerResult.reason instanceof Error ? customerResult.reason.name : "UnknownError" });
    return Response.json({ order: { orderNumber: number, status, totalAmount, currency, managerNotified, customerNotified } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const errorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
    if (errorCode === "23505" && validatedRequestId) {
      try {
        const db = getDb();
        const [existing] = await db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).where(eq(orders.requestId, validatedRequestId)).limit(1);
        if (existing) return Response.json({ order: { ...existing, managerNotified: false, customerNotified: false } }, { status: 200, headers: { "Cache-Control": "no-store" } });
      } catch (lookupError) {
        console.error("duplicate_order_lookup_failed", { name: lookupError instanceof Error ? lookupError.name : "UnknownError" });
      }
    }
    if (error instanceof SyntaxError) return Response.json({ error: "Некорректный формат запроса" }, { status: 400 });
    if (error instanceof Error && error.message === "PRODUCT_UNAVAILABLE") return Response.json({ error: "Один из тарифов больше недоступен" }, { status: 409 });
    if (error instanceof Error && error.message === "PRODUCT_VARIANT_UNAVAILABLE") return Response.json({ error: "Выбранный вариант тарифа больше недоступен" }, { status: 409 });
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") return Response.json({ error: "Выбранное количество превышает остаток" }, { status: 409 });
    if (error instanceof Error && error.message === "MIXED_CURRENCY") return Response.json({ error: "Оформите товары в разных валютах отдельными заказами" }, { status: 409 });
    console.error("order_creation_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Не удалось создать заказ. Попробуйте ещё раз." }, { status: 500 });
  }
}
