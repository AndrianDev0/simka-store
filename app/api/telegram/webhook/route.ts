import { and, asc, desc, eq, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { adminAuditLog, catalogProducts, categories, orderItems, orders, productCategories, productVariants } from "@/db/schema";
import { escapeHtml, sendTransactionalEmail } from "@/lib/email";
import { recordSlugRedirect } from "@/lib/slug-redirects";
import { handleCatalogAdminCallback, handleCatalogAdminMessage } from "@/lib/telegram-catalog-admin";

const updateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({
    text: z.string().max(4096).optional(),
    chat: z.object({ id: z.number().int() }),
    from: z.object({ id: z.number().int() }).optional(),
    reply_to_message: z.object({ text: z.string().max(4096).optional() }).optional(),
  }).optional(),
  callback_query: z.object({
    id: z.string(),
    data: z.string().max(128).optional(),
    from: z.object({ id: z.number().int() }),
    message: z.object({ chat: z.object({ id: z.number().int() }) }).optional(),
  }).optional(),
}).passthrough();

type BotEnvironment = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ADMIN_IDS?: string;
};

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

type InlineButton = { text: string; callback_data?: string; url?: string };
type InlineKeyboard = { inline_keyboard: Array<Array<InlineButton>> };
type ReplyMarkup = InlineKeyboard | { force_reply: true; selective: true; input_field_placeholder?: string };

async function sendMessage(token: string, chatId: number, text: string, replyMarkup?: ReplyMarkup) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("TELEGRAM_SEND_FAILED");
}

async function answerCallback(token: string, callbackId: string) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId }),
    signal: AbortSignal.timeout(10_000),
  });
}

function mainKeyboard(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "📦 Товары", callback_data: "products:list" }, { text: "📂 Категории", callback_data: "categories:list" }],
    [{ text: "🌍 Страны", callback_data: "countries:list" }, { text: "📡 Операторы", callback_data: "operators:list" }],
    [{ text: "🛒 Заказы", callback_data: "orders:list" }, { text: "📊 Статус магазина", callback_data: "status" }],
  ] };
}

function backKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[{ text: "◀️ В меню", callback_data: "menu" }]] };
}

function orderListKeyboard(list: Array<{ orderNumber: string; status: string }>): InlineKeyboard {
  return { inline_keyboard: [
    ...list.map((order) => [{ text: `${order.status === "WAITING_FOR_MANAGER" ? "🟡" : order.status === "PAID" ? "🟢" : "📦"} ${order.orderNumber}`, callback_data: `order:view:${order.orderNumber}` }]),
    [{ text: "◀️ В меню", callback_data: "menu" }],
  ] };
}

async function sendOrderDetails(db: ReturnType<typeof getDb>, token: string, chatId: number, orderNumber: string) {
  const [order] = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  if (!order) {
    await sendMessage(token, chatId, "Заказ не найден.", backKeyboard());
    return;
  }
  const items = await db.select({ productName: orderItems.productName, simType: orderItems.simType, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, order.id));
  const hasPhysicalSim = items.some((item) => item.simType === "SIM");
  const lines = items.map((item) => `• ${item.productName} × ${item.quantity}`).join("\n");
  const actions: Array<Array<InlineButton>> = [];
  if (order.paymentMethod === "manager" && order.status === "WAITING_FOR_MANAGER") actions.push([{ text: "✅ Подтвердить получение оплаты", callback_data: `order:paid_prompt:${order.orderNumber}` }]);
  if (order.status === "PAID") actions.push([{ text: "⚙️ Начать выполнение", callback_data: `order:process:${order.orderNumber}` }]);
  if (order.status === "PROCESSING") actions.push([{ text: hasPhysicalSim ? "📦 Отметить отправленным" : "✅ Отметить eSIM выданной", callback_data: `order:${hasPhysicalSim ? "ship" : "complete"}:${order.orderNumber}` }]);
  if (order.status === "SHIPPED") actions.push([{ text: "🚚 Отметить доставленным", callback_data: `order:deliver:${order.orderNumber}` }]);
  if (order.status === "DELIVERED") actions.push([{ text: "✅ Завершить заказ", callback_data: `order:complete:${order.orderNumber}` }]);
  if (["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING", "PAID", "PROCESSING"].includes(order.status)) actions.push([{ text: "❌ Отменить заказ", callback_data: `order:cancel_prompt:${order.orderNumber}` }]);
  actions.push([{ text: "◀️ К заказам", callback_data: "orders:list" }]);
  const text = [
    `🛒 ${order.orderNumber}`,
    `Статус: ${order.status}`,
    `Клиент: ${order.customerName}`,
    `Email: ${order.customerEmail}`,
    order.customerContact ? `Контакт: ${order.customerContact}` : "",
    order.deliveryAddress ? `Доставка: ${order.deliveryAddress}` : "",
    order.customerComment ? `Комментарий: ${order.customerComment}` : "",
    `Оплата: ${order.paymentMethod === "manager" ? "через менеджера" : "криптовалюта"}`,
    `Сумма: ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`,
    "",
    lines,
  ].filter(Boolean).join("\n");
  await sendMessage(token, chatId, text, { inline_keyboard: actions });
}

async function audit(db: ReturnType<typeof getDb>, adminId: number, action: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  await db.insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    adminTelegramId: String(adminId),
    action,
    entityType: action.split(".")[0] || "admin",
    entityId,
    metadata: JSON.stringify(metadata),
  });
}

const editableCategoryFields = new Set([
  "name", "slug", "description", "image_url", "seo_title", "seo_description", "h1", "seo_text",
  "canonical_url", "og_title", "og_description", "og_image", "sort_order",
]);
const reservedCategorySlugs = new Set(["esim", "sim", "europe", "asia", "america"]);
const nullableCategoryFields = new Set(["image_url", "seo_title", "seo_description", "h1", "seo_text", "canonical_url", "og_title", "og_description", "og_image"]);

function validAdminUrl(value: string, allowRelative = false) {
  if (allowRelative && value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const categoryFieldByCode = {
  n: "name",
  s: "slug",
  d: "description",
  im: "image_url",
  st: "seo_title",
  sd: "seo_description",
  h: "h1",
  sx: "seo_text",
  cu: "canonical_url",
  ot: "og_title",
  od: "og_description",
  oi: "og_image",
  so: "sort_order",
} as const;

function categoryKeyboard(list: Array<{ id: string; name: string }>): InlineKeyboard {
  const rows = list.slice(0, 80).map((category) => [{ text: `📁 ${category.name.slice(0, 54)}`, callback_data: `category:view:${category.id}` }]);
  rows.push([{ text: "➕ Создать категорию", callback_data: "category:create" }]);
  rows.push([{ text: "◀️ В меню", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function categoryActionKeyboard(category: { id: string; isPublished: boolean; noindex: boolean; archivedAt: string | null }, productIds: Set<number>, products: Array<{ id: number; name: string }>): InlineKeyboard {
  const productButtons = products.slice(0, 80).map((product) => ({
    text: `${productIds.has(product.id) ? "✅ Снять" : "➕ Назначить"} ${product.id} · ${product.name.slice(0, 28)}`,
    callback_data: `ca:${category.id.slice(0, 12)}:${product.id}`,
  }));
  const productRows: Array<Array<InlineButton>> = [];
  for (let index = 0; index < productButtons.length; index += 2) productRows.push(productButtons.slice(index, index + 2));
  return { inline_keyboard: [
    [{ text: category.isPublished ? "⏸ Снять с публикации" : "▶️ Опубликовать", callback_data: `category:publish:${category.id}` }],
    [{ text: category.noindex ? "🔓 Разрешить индексацию" : "🔒 Закрыть индексацию", callback_data: `category:index:${category.id}` }],
    [{ text: category.archivedAt ? "♻️ Восстановить" : "📦 Архивировать", callback_data: `category:${category.archivedAt ? "restore" : "archive"}:${category.id}` }],
    [{ text: "🗂 Выбрать родительскую категорию", callback_data: `category:parents:${category.id}` }],
    [{ text: "✏️ Изменить текст / SEO", callback_data: `category:edit:${category.id}` }],
    ...productRows,
    [{ text: "🗑 Удалить категорию", callback_data: `category:delete_prompt:${category.id}` }],
    [{ text: "◀️ К списку", callback_data: "categories:list" }],
  ] };
}

function categoryEditKeyboard(categoryId: string): InlineKeyboard {
  const fields = [
    ["Название", "n"], ["Slug", "s"], ["Описание", "d"], ["Изображение", "im"],
    ["SEO title", "st"], ["SEO description", "sd"], ["H1", "h"], ["SEO-текст", "sx"],
    ["Canonical", "cu"], ["OG title", "ot"], ["OG description", "od"], ["OG image", "oi"],
    ["Порядок", "so"],
  ];
  const rows = fields.map(([label, fieldCode]) => [{ text: `✏️ ${label}`, callback_data: `category:field:${categoryId}:${fieldCode}` }]);
  rows.push([{ text: "◀️ К категории", callback_data: `category:view:${categoryId}` }]);
  return { inline_keyboard: rows };
}

async function sendCategoryDetails(db: ReturnType<typeof getDb>, token: string, chatId: number, categoryId: string) {
  const [category] = await db.select({ id: categories.id, parentId: categories.parentId, name: categories.name, slug: categories.slug, description: categories.description, isPublished: categories.isPublished, noindex: categories.noindex, archivedAt: categories.archivedAt, sortOrder: categories.sortOrder }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!category) {
    await sendMessage(token, chatId, "Категория не найдена.", backKeyboard());
    return;
  }
  const links = await db.select({ productId: productCategories.productId }).from(productCategories).where(eq(productCategories.categoryId, categoryId));
  const products = await db.select({ id: catalogProducts.id, name: catalogProducts.name }).from(catalogProducts).where(isNull(catalogProducts.archivedAt)).orderBy(asc(catalogProducts.sortOrder), asc(catalogProducts.id));
  const [parent] = category.parentId ? await db.select({ name: categories.name }).from(categories).where(eq(categories.id, category.parentId)).limit(1) : [];
  const productIds = new Set(links.map((link) => link.productId));
  const status = category.archivedAt ? "ARCHIVED" : category.isPublished ? "PUBLISHED" : "DRAFT";
  const description = category.description ? `${category.description.slice(0, 2999)}${category.description.length > 3000 ? "…" : ""}` : "Описание не задано.";
  const text = `📁 ${category.name.slice(0, 160)}\nSlug: ${category.slug}\nРодитель: ${parent?.name || "нет"}\nСтатус: ${status}\nИндексация: ${category.noindex ? "NOINDEX" : "INDEX"}\nПорядок: ${category.sortOrder}\nТовары: ${productIds.size ? [...productIds].join(", ") : "нет"}\n\n${description}`;
  await sendMessage(token, chatId, text, categoryActionKeyboard(category, productIds, products));
}

async function resolveCategoryByPrefix(db: ReturnType<typeof getDb>, prefix: string) {
  if (!/^[0-9a-f-]{8,36}$/i.test(prefix)) return null;
  const matches = await db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).where(like(categories.id, `${prefix}%`)).limit(2);
  return matches.length === 1 ? matches[0] : null;
}

async function createsCategoryCycle(db: ReturnType<typeof getDb>, childId: string, proposedParentId: string) {
  const hierarchy = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
  const parentById = new Map(hierarchy.map((item) => [item.id, item.parentId]));
  let cursor: string | null = proposedParentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === childId || visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  return false;
}

async function handleCallback(token: string, chatId: number, adminId: number, data: string) {
  const db = getDb();
  const [scope, action, first, second] = data.split(":");
  if (data === "menu") {
    await sendMessage(token, chatId, "SIMKA Admin\nВыберите раздел:", mainKeyboard());
    return;
  }
  if (await handleCatalogAdminCallback({ token, chatId, adminId }, data)) return;
  if (data === "status") {
    const recent = await db.select({ status: orders.status }).from(orders).orderBy(desc(orders.createdAt)).limit(100);
    const active = recent.filter((order) => !["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"].includes(order.status)).length;
    await sendMessage(token, chatId, `SIMKA работает.\nЗаказов: ${recent.length}\nАктивных: ${active}`, backKeyboard());
    return;
  }
  if (scope === "orders" && action === "list") {
    const recent = await db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).orderBy(desc(orders.createdAt)).limit(5);
    const lines = recent.length ? recent.map((order) => `${order.orderNumber} · ${order.status} · ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`).join("\n") : "Заказов пока нет.";
    await sendMessage(token, chatId, `Последние заказы:\n\n${lines}`, orderListKeyboard(recent));
    return;
  }
  if (scope === "order" && action === "view" && first) {
    await sendOrderDetails(db, token, chatId, first);
    return;
  }
  if (scope === "order" && action === "paid_prompt" && first) {
    await sendMessage(token, chatId, `Подтвердить фактическое получение оплаты по заказу ${first}?`, { inline_keyboard: [[{ text: "Да, деньги получены", callback_data: `order:paid_confirm:${first}` }], [{ text: "Отмена", callback_data: `order:view:${first}` }]] });
    return;
  }
  if (scope === "order" && action === "cancel_prompt" && first) {
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order) { await sendMessage(token, chatId, "Заказ не найден.", backKeyboard()); return; }
    const paidWarning = ["PAID", "PROCESSING"].includes(order.status) ? "\n\nВнимание: заказ уже оплачен. Отмена не возвращает деньги автоматически — возврат нужно провести отдельно." : "";
    await sendMessage(token, chatId, `Точно отменить заказ ${first}?${paidWarning}`, { inline_keyboard: [[{ text: "❌ Да, отменить заказ", callback_data: `order:cancel_confirm:${first}` }], [{ text: "Не отменять", callback_data: `order:view:${first}` }]] });
    return;
  }
  if (scope === "order" && action === "cancel_confirm" && first) {
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, customerName: orders.customerName, customerEmail: orders.customerEmail, inventoryReserved: orders.inventoryReserved }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order) { await sendMessage(token, chatId, "Заказ не найден.", backKeyboard()); return; }
    const cancellableStatuses = ["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING", "PAID", "PROCESSING"];
    if (!cancellableStatuses.includes(order.status)) {
      await sendMessage(token, chatId, `Заказ в статусе ${order.status} отменить нельзя.`, { inline_keyboard: [[{ text: "◀️ К заказу", callback_data: `order:view:${order.orderNumber}` }]] });
      return;
    }
    const cancelledItems = await db.select({ productId: orderItems.productId, variantId: orderItems.variantId, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, order.id));
    await db.transaction(async (tx) => {
      const changed = await tx.update(orders).set({ status: "CANCELLED", inventoryReserved: false }).where(and(eq(orders.id, order.id), eq(orders.status, order.status))).returning({ id: orders.id });
      if (!changed[0]) throw new Error("ORDER_STATUS_CHANGED");
      const productQuantities = new Map<number, number>();
      const variantQuantities = new Map<number, number>();
      for (const item of order.inventoryReserved ? cancelledItems : []) {
        productQuantities.set(item.productId, (productQuantities.get(item.productId) ?? 0) + item.quantity);
        if (item.variantId) variantQuantities.set(item.variantId, (variantQuantities.get(item.variantId) ?? 0) + item.quantity);
      }
      for (const [productId, quantity] of productQuantities) {
        await tx.update(catalogProducts).set({
          stockQuantity: sql`${catalogProducts.stockQuantity} + ${quantity}`,
          available: sql`CASE WHEN ${catalogProducts.stockQuantity} = 0 THEN TRUE ELSE ${catalogProducts.available} END`,
          availabilityStatus: sql`CASE WHEN ${catalogProducts.stockQuantity} = 0 THEN 'IN_STOCK' ELSE ${catalogProducts.availabilityStatus} END`,
          updatedAt: new Date().toISOString(),
        }).where(and(eq(catalogProducts.id, productId), sql`${catalogProducts.stockQuantity} IS NOT NULL`));
      }
      for (const [variantId, quantity] of variantQuantities) {
        await tx.update(productVariants).set({
          stockQuantity: sql`${productVariants.stockQuantity} + ${quantity}`,
          available: sql`CASE WHEN ${productVariants.stockQuantity} = 0 THEN TRUE ELSE ${productVariants.available} END`,
          availabilityStatus: sql`CASE WHEN ${productVariants.stockQuantity} = 0 THEN 'IN_STOCK' ELSE ${productVariants.availabilityStatus} END`,
          updatedAt: new Date().toISOString(),
        }).where(and(eq(productVariants.id, variantId), sql`${productVariants.stockQuantity} IS NOT NULL`));
      }
    });
    await audit(db, adminId, "order.cancel", order.id, { orderNumber: order.orderNumber, from: order.status, to: "CANCELLED" });
    let cancellationEmailDelivered = false;
    try {
      const safeName = escapeHtml(order.customerName);
      const safeNumber = escapeHtml(order.orderNumber);
      const delivery = await sendTransactionalEmail({
        to: order.customerEmail,
        subject: `Заказ ${order.orderNumber} отменён — SIMKA`,
        text: `Здравствуйте, ${order.customerName}!\n\nЗаказ ${order.orderNumber} отменён. Если вы уже оплатили заказ, свяжитесь с поддержкой и укажите номер заказа — возврат обрабатывается отдельно.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Заказ отменён</h1><p>Здравствуйте, ${safeName}!</p><p>Заказ <strong>${safeNumber}</strong> отменён.</p><p>Если вы уже оплатили заказ, свяжитесь с поддержкой и укажите номер заказа — возврат обрабатывается отдельно.</p></div>`,
      });
      cancellationEmailDelivered = delivery.delivered;
    } catch (error) {
      console.error("order_cancellation_email_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    }
    await audit(db, adminId, "order.cancellation_email", order.id, { delivered: cancellationEmailDelivered });
    await sendMessage(token, chatId, `Заказ ${order.orderNumber} отменён. Статус → CANCELLED.\n${cancellationEmailDelivered ? "Клиенту отправлено письмо об отмене." : "Автоматическое письмо клиенту не доставлено — сообщите об отмене вручную."}`, { inline_keyboard: [[{ text: "🛒 К списку заказов", callback_data: "orders:list" }], [{ text: "📄 Открыть заказ", callback_data: `order:view:${order.orderNumber}` }]] });
    return;
  }
  if (scope === "order" && ["paid_confirm", "process", "ship", "deliver", "complete"].includes(action) && first) {
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod, status: orders.status }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order) { await sendMessage(token, chatId, "Заказ не найден.", backKeyboard()); return; }
    const transitions: Record<string, { from: string; to: string }> = {
      paid_confirm: { from: "WAITING_FOR_MANAGER", to: "PAID" },
      process: { from: "PAID", to: "PROCESSING" },
      ship: { from: "PROCESSING", to: "SHIPPED" },
      deliver: { from: "SHIPPED", to: "DELIVERED" },
      complete: { from: order.status === "DELIVERED" ? "DELIVERED" : "PROCESSING", to: "COMPLETED" },
    };
    const transition = transitions[action];
    if (action === "paid_confirm" && order.paymentMethod !== "manager") {
      await sendMessage(token, chatId, "Криптовалютную оплату может подтвердить только защищённый webhook платёжного провайдера.");
      return;
    }
    if (order.status !== transition.from) {
      await sendMessage(token, chatId, `Переход недоступен для статуса ${order.status}.`);
      return;
    }
    await db.update(orders).set({ status: transition.to }).where(and(eq(orders.id, order.id), eq(orders.status, transition.from)));
    await audit(db, adminId, `order.${action}`, order.id, { orderNumber: order.orderNumber, from: transition.from, to: transition.to });
    await sendOrderDetails(db, token, chatId, order.orderNumber);
    return;
  }
  if (scope === "categories" && action === "list") {
    const list = await db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(categories.sortOrder, categories.name);
    await sendMessage(token, chatId, list.length ? "Выберите категорию:" : "Категорий пока нет. Создайте первую:", categoryKeyboard(list));
    return;
  }
  if (scope === "category" && action === "create") {
    await sendMessage(token, chatId, "[CREATE_CATEGORY]\nВведите данные новой категории:\nslug | Название | Описание", { force_reply: true, selective: true, input_field_placeholder: "slug | Название | Описание" });
    return;
  }
  if (scope === "category" && action === "edit" && first) {
    await sendMessage(token, chatId, "Выберите поле, которое хотите изменить:", categoryEditKeyboard(first));
    return;
  }
  if (scope === "category" && action === "parents" && first) {
    const [current, candidates] = await Promise.all([
      db.select({ id: categories.id }).from(categories).where(eq(categories.id, first)).limit(1),
      db.select({ id: categories.id, name: categories.name }).from(categories).where(isNull(categories.archivedAt)).orderBy(asc(categories.sortOrder), asc(categories.name)).limit(80),
    ]);
    if (!current[0]) { await sendMessage(token, chatId, "Категория не найдена.", backKeyboard()); return; }
    const rows: Array<Array<InlineButton>> = [[{ text: "Без родительской категории", callback_data: `cp:${first.slice(0, 12)}:root` }]];
    for (const candidate of candidates.filter((item) => item.id !== first)) {
      rows.push([{ text: `📁 ${candidate.name.slice(0, 40)}`, callback_data: `cp:${first.slice(0, 12)}:${candidate.id.slice(0, 12)}` }]);
    }
    rows.push([{ text: "◀️ К категории", callback_data: `category:view:${first}` }]);
    await sendMessage(token, chatId, "Выберите родительскую категорию:", { inline_keyboard: rows });
    return;
  }
  if (scope === "cp" && action && first) {
    const child = await resolveCategoryByPrefix(db, action);
    const parent = first === "root" ? null : await resolveCategoryByPrefix(db, first);
    if (!child || (first !== "root" && !parent)) { await sendMessage(token, chatId, "Категория не найдена или короткий идентификатор неоднозначен.", backKeyboard()); return; }
    if (parent && await createsCategoryCycle(db, child.id, parent.id)) {
      await sendMessage(token, chatId, "Такую связь создать нельзя: получится циклическая вложенность.", { inline_keyboard: [[{ text: "◀️ К категории", callback_data: `category:view:${child.id}` }]] });
      return;
    }
    await db.update(categories).set({ parentId: parent?.id ?? null, updatedAt: new Date().toISOString() }).where(eq(categories.id, child.id));
    await audit(db, adminId, "category.set_parent", child.id, { parentId: parent?.id ?? null });
    await sendCategoryDetails(db, token, chatId, child.id);
    return;
  }
  if (scope === "ca" && action && first) {
    const category = await resolveCategoryByPrefix(db, action);
    const productId = Number(first);
    const [product] = Number.isInteger(productId) ? await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1) : [];
    if (!category || !product) { await sendMessage(token, chatId, "Категория или товар не найдены.", backKeyboard()); return; }
    const [linked] = await db.select({ productId: productCategories.productId }).from(productCategories).where(and(eq(productCategories.categoryId, category.id), eq(productCategories.productId, productId))).limit(1);
    if (linked) await db.delete(productCategories).where(and(eq(productCategories.categoryId, category.id), eq(productCategories.productId, productId)));
    else await db.insert(productCategories).values({ categoryId: category.id, productId });
    await audit(db, adminId, linked ? "category.unassign" : "category.assign", category.id, { productId });
    await sendCategoryDetails(db, token, chatId, category.id);
    return;
  }
  if (scope === "category" && action === "field" && first && second) {
    const field = categoryFieldByCode[second as keyof typeof categoryFieldByCode];
    if (!field) return;
    await sendMessage(token, chatId, `[EDIT_CATEGORY:${first}:${field}]\nВведите новое значение поля ${field}:`, { force_reply: true, selective: true, input_field_placeholder: "Новое значение" });
    return;
  }
  if (scope === "category" && action === "delete_prompt" && first) {
    await sendMessage(token, chatId, "Точно удалить категорию? Это действие нельзя отменить.", { inline_keyboard: [[{ text: "Да, удалить", callback_data: `category:delete_confirm:${first}` }], [{ text: "Отмена", callback_data: `category:view:${first}` }]] });
    return;
  }
  if (scope === "category" && action === "view" && first) {
    await sendCategoryDetails(db, token, chatId, first);
    return;
  }
  if (scope === "category" && ["publish", "index", "archive", "restore", "delete_confirm", "assign", "unassign"].includes(action) && first) {
    const [category] = await db.select({ id: categories.id, slug: categories.slug, name: categories.name, isPublished: categories.isPublished, noindex: categories.noindex, archivedAt: categories.archivedAt }).from(categories).where(eq(categories.id, first)).limit(1);
    if (!category) { await sendMessage(token, chatId, "Категория не найдена.", backKeyboard()); return; }
    if (action === "publish") await db.update(categories).set({ isPublished: !category.isPublished, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    if (action === "index") await db.update(categories).set({ noindex: !category.noindex, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    if (action === "archive" || action === "restore") await db.update(categories).set({ archivedAt: action === "archive" ? new Date().toISOString() : null, isPublished: action === "archive" ? false : category.isPublished, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    if (action === "delete_confirm") {
      const [linked] = await db.select({ productId: productCategories.productId }).from(productCategories).where(eq(productCategories.categoryId, first)).limit(1);
      if (linked) { await sendMessage(token, chatId, "Удаление запрещено: к категории привязаны товары.", { inline_keyboard: [[{ text: "◀️ К категории", callback_data: `category:view:${first}` }]] }); return; }
      const [child] = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, first)).limit(1);
      if (child) { await sendMessage(token, chatId, "Удаление запрещено: у категории есть подкатегории.", { inline_keyboard: [[{ text: "◀️ К категории", callback_data: `category:view:${first}` }]] }); return; }
      await db.delete(categories).where(eq(categories.id, first));
      await audit(db, adminId, "category.delete", first, { slug: category.slug });
      await sendMessage(token, chatId, `Категория ${category.name} удалена.`, { inline_keyboard: [[{ text: "◀️ К списку", callback_data: "categories:list" }]] });
      return;
    }
    if ((action === "assign" || action === "unassign") && second) {
      const productId = Number(second);
      const [product] = Number.isInteger(productId) ? await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1) : [];
      if (!product) { await sendMessage(token, chatId, "Неизвестный товар."); return; }
      if (action === "assign") await db.insert(productCategories).values({ categoryId: first, productId }).onConflictDoNothing();
      else await db.delete(productCategories).where(and(eq(productCategories.categoryId, first), eq(productCategories.productId, productId)));
    }
    await audit(db, adminId, `category.${action}`, first, second ? { productId: Number(second) } : {});
    await sendCategoryDetails(db, token, chatId, first);
  }
}

export async function POST(request: Request) {
  const botEnv = process.env as BotEnvironment;
  const secret = botEnv.TELEGRAM_WEBHOOK_SECRET;
  const token = botEnv.TELEGRAM_BOT_TOKEN;
  if (!secret || !token) return new Response(null, { status: 503 });

  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(suppliedSecret, secret)) return new Response(null, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 32_000) return new Response(null, { status: 413 });

  try {
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ ok: true });

    const message = parsed.data.message;
    const callback = parsed.data.callback_query;
    const from = message?.from ?? callback?.from;
    const chatId = message?.chat.id ?? callback?.message?.chat.id;
    if (!from || chatId === undefined) return Response.json({ ok: true });
    const allowedIds = new Set((botEnv.TELEGRAM_ADMIN_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
    if (!allowedIds.has(String(from.id))) return Response.json({ ok: true });

    if (callback) {
      await answerCallback(token, callback.id);
      if (callback.data) await handleCallback(token, chatId, from.id, callback.data);
      return Response.json({ ok: true });
    }

    let { text = "" } = message!;
    const replyContext = message?.reply_to_message?.text ?? "";
    if (await handleCatalogAdminMessage({ token, chatId, adminId: from.id }, text, replyContext)) return Response.json({ ok: true });
    if (replyContext.startsWith("[CREATE_CATEGORY]")) {
      text = `/category_create ${text}`;
    } else {
      const editReply = replyContext.match(/^\[EDIT_CATEGORY:([^:]+):([^\]]+)\]/);
      if (editReply && editableCategoryFields.has(editReply[2])) {
        const db = getDb();
        const [category] = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, editReply[1])).limit(1);
        if (!category) {
          await sendMessage(token, chatId, "Категория больше не существует.", backKeyboard());
          return Response.json({ ok: true });
        }
        text = `/category_set ${category.slug} ${editReply[2]} ${text}`;
      }
    }

    const command = text.trim().split(/\s+/)[0].toLowerCase().split("@")[0];
    if (command === "/start" || command === "/help") {
      await sendMessage(token, chatId, "SIMKA Admin\nВыберите раздел:", mainKeyboard());
    } else if (command === "/status") {
      const db = getDb();
      const recent = await db.select({ status: orders.status }).from(orders).orderBy(desc(orders.createdAt)).limit(100);
      const active = recent.filter((order) => !["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"].includes(order.status)).length;
      await sendMessage(token, chatId, `SIMKA работает.\nЗаказов в последней выборке: ${recent.length}\nАктивных: ${active}`, backKeyboard());
    } else if (command === "/orders") {
      const db = getDb();
      const recent = await db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).orderBy(desc(orders.createdAt)).limit(5);
      const lines = recent.length ? recent.map((order) => `${order.orderNumber} · ${order.status} · ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`).join("\n") : "Заказов пока нет.";
      await sendMessage(token, chatId, `Последние заказы:\n\n${lines}`, backKeyboard());
    } else if (command === "/paid") {
      const number = text.trim().split(/\s+/)[1]?.toUpperCase();
      if (!number) {
        await sendMessage(token, chatId, "Укажите номер: /paid SIM-YYYYMMDD-XXXXXXXX");
      } else {
        const db = getDb();
        const [order] = await db.select({ id: orders.id, status: orders.status, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod }).from(orders).where(eq(orders.orderNumber, number)).limit(1);
        if (!order) {
          await sendMessage(token, chatId, "Заказ не найден.");
        } else if (order.paymentMethod !== "manager") {
          await sendMessage(token, chatId, "Криптовалютную оплату может подтвердить только защищённый webhook платёжного провайдера.");
        } else if (order.status !== "WAITING_FOR_MANAGER") {
          await sendMessage(token, chatId, `Нельзя подтвердить заказ в статусе ${order.status}.`);
        } else {
          await db.update(orders).set({ status: "PAID" }).where(eq(orders.id, order.id));
          await audit(db, from.id, "order.payment_confirmed", order.id, { orderNumber: order.orderNumber, method: "manager" });
          await sendMessage(token, chatId, `Оплата подтверждена. Заказ ${order.orderNumber} → PAID.`);
        }
      }
    } else if (command === "/categories") {
      const db = getDb();
      const list = await db.select({ name: categories.name, slug: categories.slug, isPublished: categories.isPublished, noindex: categories.noindex, archivedAt: categories.archivedAt, sortOrder: categories.sortOrder }).from(categories).orderBy(categories.sortOrder, categories.name);
      const lines = list.length ? list.map((category) => `${category.sortOrder}. ${category.name} (${category.slug}) · ${category.archivedAt ? "ARCHIVED" : category.isPublished ? "PUBLISHED" : "DRAFT"} · ${category.noindex ? "NOINDEX" : "INDEX"}`).join("\n") : "Категорий пока нет.";
      await sendMessage(token, chatId, `Категории:\n\n${lines}`, mainKeyboard());
    } else if (command === "/category_create") {
      const parts = text.slice(command.length).trim().split("|").map((part) => part.trim());
      const [slug, name, description = ""] = parts;
      if (!slug || !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120 || name.length > 160) {
        await sendMessage(token, chatId, "Формат: /category_create slug | Название | Описание\nSlug: латиница, цифры и дефисы.");
      } else if (reservedCategorySlugs.has(slug)) {
        await sendMessage(token, chatId, `Slug ${slug} зарезервирован системной категорией. Выберите другой slug.`);
      } else {
        const db = getDb();
        const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (existing) await sendMessage(token, chatId, `Категория со slug ${slug} уже существует.`);
        else {
          const id = crypto.randomUUID();
          await db.insert(categories).values({ id, slug, name, description, noindex: true, isPublished: false, sortOrder: 0 });
          await audit(db, from.id, "category.create", id, { slug, name });
          await sendMessage(token, chatId, `Категория создана: ${name} (${slug}). По умолчанию скрыта и закрыта от индексации.`, { inline_keyboard: [[{ text: "📂 Открыть список", callback_data: "categories:list" }]] });
        }
      }
    } else if (command === "/category_set") {
      const match = text.trim().match(/^\/category_set\s+(\S+)\s+(\S+)\s+([\s\S]+)$/i);
      if (!match || !editableCategoryFields.has(match[2])) {
        await sendMessage(token, chatId, "Формат: /category_set slug field value\nДопустимые field перечислены в /help.");
      } else {
        const [, slug, field, rawValue] = match;
        const db = getDb();
        const [category] = await db.select({ id: categories.id, slug: categories.slug }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else {
          const trimmedValue = rawValue.trim();
          const value: string | number | null = field === "sort_order" ? Number(rawValue) : nullableCategoryFields.has(field) && trimmedValue === "-" ? null : trimmedValue;
          const numericValue = typeof value === "number" ? value : Number.NaN;
          if (field === "sort_order" && (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 100000)) {
            await sendMessage(token, chatId, "sort_order должен быть целым числом от 0 до 100000.");
          } else if (field === "slug" && (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 120)) {
            await sendMessage(token, chatId, "Slug должен содержать только латинские буквы, цифры и дефисы.");
          } else if (field === "slug" && typeof value === "string" && reservedCategorySlugs.has(value)) {
            await sendMessage(token, chatId, `Slug ${value} зарезервирован системной категорией.`);
          } else if (field === "name" && (typeof value !== "string" || !value || value.length > 160)) {
            await sendMessage(token, chatId, "Название должно содержать от 1 до 160 символов.");
          } else if (["seo_title", "h1", "og_title"].includes(field) && typeof value === "string" && value.length > 300) {
            await sendMessage(token, chatId, "Значение слишком длинное: максимум 300 символов.");
          } else if (["seo_description", "og_description"].includes(field) && typeof value === "string" && value.length > 1000) {
            await sendMessage(token, chatId, "Описание слишком длинное: максимум 1000 символов.");
          } else if (["description", "seo_text"].includes(field) && typeof value === "string" && value.length > 4000) {
            await sendMessage(token, chatId, "Текст слишком длинный: максимум 4000 символов.");
          } else if (["image_url", "og_image"].includes(field) && typeof value === "string" && !validAdminUrl(value)) {
            await sendMessage(token, chatId, "Укажите полный URL изображения с http:// или https:// либо отправьте - для очистки.");
          } else if (field === "canonical_url" && typeof value === "string" && !validAdminUrl(value, true)) {
            await sendMessage(token, chatId, "Canonical должен быть полным http(s)-URL или относительным путём, начинающимся с /.");
          } else {
            const [conflict] = field === "slug" && typeof value === "string" ? await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, value)).limit(1) : [];
            if (conflict && conflict.id !== category.id) await sendMessage(token, chatId, `Категория со slug ${value} уже существует.`);
            else {
              const update: Record<string, unknown> = { updatedAt: new Date().toISOString(), [field.replaceAll("_", "")] : value };
              const columnMap: Record<string, string> = { image_url: "imageUrl", seo_title: "seoTitle", seo_description: "seoDescription", seo_text: "seoText", canonical_url: "canonicalUrl", og_title: "ogTitle", og_description: "ogDescription", og_image: "ogImage", sort_order: "sortOrder" };
              const key = columnMap[field] ?? field;
              delete update[field.replaceAll("_", "")];
              update[key] = value;
              await db.update(categories).set(update as typeof categories.$inferInsert).where(eq(categories.id, category.id));
              if (field === "slug" && typeof value === "string") await recordSlugRedirect("category", category.id, category.slug, value);
              await audit(db, from.id, "category.update", category.id, { field, value });
              await sendMessage(token, chatId, `Категория ${slug}: поле ${field} обновлено.`);
            }
          }
        }
      }
    } else if (command === "/category_publish" || command === "/category_index") {
      const args = text.trim().split(/\s+/);
      const slug = args[1];
      const choice = args[2]?.toLowerCase();
      const isPublish = command === "/category_publish";
      const valid = isPublish ? ["on", "off"] : ["index", "noindex"];
      if (!slug || !valid.includes(choice)) {
        await sendMessage(token, chatId, isPublish ? "Формат: /category_publish slug on|off" : "Формат: /category_index slug index|noindex");
      } else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else {
          const update = isPublish ? { isPublished: choice === "on", updatedAt: new Date().toISOString() } : { noindex: choice === "noindex", updatedAt: new Date().toISOString() };
          await db.update(categories).set(update).where(eq(categories.id, category.id));
          await audit(db, from.id, isPublish ? "category.publish" : "category.indexation", category.id, { value: choice });
          await sendMessage(token, chatId, `Категория ${slug}: ${isPublish ? (choice === "on" ? "опубликована" : "снята с публикации") : (choice === "index" ? "открыта для индексации" : "закрыта от индексации")}.`);
        }
      }
    } else if (["/category_archive", "/category_restore"].includes(command)) {
      const slug = text.trim().split(/\s+/)[1];
      if (!slug) await sendMessage(token, chatId, `Формат: ${command} slug`);
      else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else {
          const archived = command === "/category_archive";
          await db.update(categories).set({ archivedAt: archived ? new Date().toISOString() : null, isPublished: archived ? false : undefined, updatedAt: new Date().toISOString() }).where(eq(categories.id, category.id));
          await audit(db, from.id, archived ? "category.archive" : "category.restore", category.id);
          await sendMessage(token, chatId, archived ? `Категория ${slug} архивирована.` : `Категория ${slug} восстановлена.`);
        }
      }
    } else if (command === "/category_delete") {
      const slug = text.trim().split(/\s+/)[1];
      if (!slug) await sendMessage(token, chatId, "Формат: /category_delete slug");
      else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else {
          const [linked] = await db.select({ productId: productCategories.productId }).from(productCategories).where(eq(productCategories.categoryId, category.id)).limit(1);
          if (linked) await sendMessage(token, chatId, "Нельзя удалить категорию: к ней привязаны товары. Сначала используйте /category_unassign.");
          else {
            const [child] = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, category.id)).limit(1);
            if (child) await sendMessage(token, chatId, "Нельзя удалить категорию: у неё есть подкатегории.");
            else {
              await db.delete(categories).where(eq(categories.id, category.id));
              await audit(db, from.id, "category.delete", category.id, { slug });
              await sendMessage(token, chatId, `Категория ${slug} удалена.`);
            }
          }
        }
      }
    } else if (command === "/category_assign" || command === "/category_unassign") {
      const args = text.trim().split(/\s+/);
      const slug = args[1];
      const productId = Number(args[2]);
      if (!slug || !Number.isInteger(productId)) {
        await sendMessage(token, chatId, `Формат: ${command} slug productId`);
      } else {
        const db = getDb();
        const [product] = await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1);
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!product) await sendMessage(token, chatId, "Товар не найден.");
        else if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else if (command === "/category_assign") {
          await db.insert(productCategories).values({ categoryId: category.id, productId }).onConflictDoNothing();
          await audit(db, from.id, "category.assign_product", category.id, { productId });
          await sendMessage(token, chatId, `Товар ${productId} назначен категории ${slug}.`);
        } else {
          await db.delete(productCategories).where(and(eq(productCategories.categoryId, category.id), eq(productCategories.productId, productId)));
          await audit(db, from.id, "category.unassign_product", category.id, { productId });
          await sendMessage(token, chatId, `Товар ${productId} снят с категории ${slug}.`);
        }
      }
    } else {
      await sendMessage(token, chatId, "Неизвестная команда. Откройте меню кнопкой /start.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("telegram_webhook_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return new Response(null, { status: 500 });
  }
}
