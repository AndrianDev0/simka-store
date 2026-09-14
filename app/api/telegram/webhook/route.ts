import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { adminAuditLog, categories, orders, productCategories } from "@/db/schema";
import { getProductById } from "@/lib/catalog";

const updateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({
    text: z.string().max(4096).optional(),
    chat: z.object({ id: z.number().int() }),
    from: z.object({ id: z.number().int() }).optional(),
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

type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

async function sendMessage(token: string, chatId: number, text: string, replyMarkup?: InlineKeyboard) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  });
  if (!response.ok) throw new Error("TELEGRAM_SEND_FAILED");
}

async function answerCallback(token: string, callbackId: string) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId }),
  });
}

function mainKeyboard(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "📂 Категории", callback_data: "categories:list" }, { text: "🛒 Заказы", callback_data: "orders:list" }],
    [{ text: "📊 Статус магазина", callback_data: "status" }, { text: "➕ Создать категорию", callback_data: "category:create_help" }],
  ] };
}

function backKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[{ text: "◀️ В меню", callback_data: "menu" }]] };
}

async function audit(db: ReturnType<typeof getDb>, adminId: number, action: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  await db.insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    adminTelegramId: String(adminId),
    action,
    entityType: "category",
    entityId,
    metadata: JSON.stringify(metadata),
  });
}

const editableCategoryFields = new Set([
  "name", "description", "image_url", "seo_title", "seo_description", "h1", "seo_text",
  "canonical_url", "og_title", "og_description", "og_image", "sort_order",
]);

function categoryKeyboard(list: Array<{ id: string; name: string }>): InlineKeyboard {
  const rows = list.map((category) => [{ text: `📁 ${category.name}`, callback_data: `category:view:${category.id}` }]);
  rows.push([{ text: "➕ Создать категорию", callback_data: "category:create_help" }]);
  rows.push([{ text: "◀️ В меню", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function categoryActionKeyboard(category: { id: string; isPublished: boolean; noindex: boolean; archivedAt: string | null }, productIds: Set<number>): InlineKeyboard {
  const productButtons = [1, 2, 3, 4, 5, 6].map((productId) => ({
    text: `${productIds.has(productId) ? "✅ Снять" : "➕ Назначить"} товар ${productId}`,
    callback_data: `category:${productIds.has(productId) ? "unassign" : "assign"}:${category.id}:${productId}`,
  }));
  return { inline_keyboard: [
    [{ text: category.isPublished ? "⏸ Снять с публикации" : "▶️ Опубликовать", callback_data: `category:publish:${category.id}` }],
    [{ text: category.noindex ? "🔓 Разрешить индексацию" : "🔒 Закрыть индексацию", callback_data: `category:index:${category.id}` }],
    [{ text: category.archivedAt ? "♻️ Восстановить" : "📦 Архивировать", callback_data: `category:${category.archivedAt ? "restore" : "archive"}:${category.id}` }],
    [{ text: "✏️ Изменить текст / SEO", callback_data: `category:edit_help:${category.id}` }],
    productButtons.slice(0, 2), productButtons.slice(2, 4), productButtons.slice(4, 6),
    [{ text: "🗑 Удалить категорию", callback_data: `category:delete:${category.id}` }],
    [{ text: "◀️ К списку", callback_data: "categories:list" }],
  ] };
}

async function sendCategoryDetails(db: ReturnType<typeof getDb>, token: string, chatId: number, categoryId: string) {
  const [category] = await db.select({ id: categories.id, name: categories.name, slug: categories.slug, description: categories.description, isPublished: categories.isPublished, noindex: categories.noindex, archivedAt: categories.archivedAt, sortOrder: categories.sortOrder }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!category) {
    await sendMessage(token, chatId, "Категория не найдена.", backKeyboard());
    return;
  }
  const links = await db.select({ productId: productCategories.productId }).from(productCategories).where(eq(productCategories.categoryId, categoryId));
  const productIds = new Set(links.map((link) => link.productId));
  const status = category.archivedAt ? "ARCHIVED" : category.isPublished ? "PUBLISHED" : "DRAFT";
  const text = `📁 ${category.name}\nSlug: ${category.slug}\nСтатус: ${status}\nИндексация: ${category.noindex ? "NOINDEX" : "INDEX"}\nПорядок: ${category.sortOrder}\nТовары: ${productIds.size ? [...productIds].join(", ") : "нет"}\n\n${category.description || "Описание не задано."}`;
  await sendMessage(token, chatId, text, categoryActionKeyboard(category, productIds));
}

async function handleCallback(token: string, chatId: number, adminId: number, data: string) {
  const db = getDb();
  const [scope, action, first, second] = data.split(":");
  if (data === "menu") {
    await sendMessage(token, chatId, "SIMKA Admin\nВыберите раздел:", mainKeyboard());
    return;
  }
  if (data === "status") {
    const recent = await db.select({ status: orders.status }).from(orders).orderBy(desc(orders.createdAt)).limit(100);
    const active = recent.filter((order) => !["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"].includes(order.status)).length;
    await sendMessage(token, chatId, `SIMKA работает.\nЗаказов: ${recent.length}\nАктивных: ${active}`, backKeyboard());
    return;
  }
  if (scope === "orders" && action === "list") {
    const recent = await db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).orderBy(desc(orders.createdAt)).limit(5);
    const lines = recent.length ? recent.map((order) => `${order.orderNumber} · ${order.status} · ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`).join("\n") : "Заказов пока нет.";
    await sendMessage(token, chatId, `Последние заказы:\n\n${lines}`, backKeyboard());
    return;
  }
  if (scope === "categories" && action === "list") {
    const list = await db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(categories.sortOrder, categories.name);
    await sendMessage(token, chatId, list.length ? "Выберите категорию:" : "Категорий пока нет. Создайте первую:", categoryKeyboard(list));
    return;
  }
  if (scope === "category" && action === "create_help") {
    await sendMessage(token, chatId, "Чтобы создать категорию, отправьте одной строкой:\n/category_create slug | Название | Описание\n\nПосле создания остальные действия доступны кнопками.", backKeyboard());
    return;
  }
  if (scope === "category" && action === "edit_help" && first) {
    await sendMessage(token, chatId, "Изменение текстовых полей:\n/category_set slug field value\n\nКнопки управляют публикацией, архивом, SEO-индексацией и товарами.", { inline_keyboard: [[{ text: "◀️ К категории", callback_data: `category:view:${first}` }]] });
    return;
  }
  if (scope === "category" && action === "view" && first) {
    await sendCategoryDetails(db, token, chatId, first);
    return;
  }
  if (scope === "category" && ["publish", "index", "archive", "restore", "delete", "assign", "unassign"].includes(action) && first) {
    const [category] = await db.select({ id: categories.id, slug: categories.slug, name: categories.name, isPublished: categories.isPublished, noindex: categories.noindex, archivedAt: categories.archivedAt }).from(categories).where(eq(categories.id, first)).limit(1);
    if (!category) { await sendMessage(token, chatId, "Категория не найдена.", backKeyboard()); return; }
    if (action === "publish") await db.update(categories).set({ isPublished: !category.isPublished, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    if (action === "index") await db.update(categories).set({ noindex: !category.noindex, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    if (action === "archive" || action === "restore") await db.update(categories).set({ archivedAt: action === "archive" ? new Date().toISOString() : null, isPublished: action === "archive" ? false : category.isPublished, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    if (action === "delete") {
      const [linked] = await db.select({ productId: productCategories.productId }).from(productCategories).where(eq(productCategories.categoryId, first)).limit(1);
      if (linked) { await sendMessage(token, chatId, "Удаление запрещено: к категории привязаны товары.", { inline_keyboard: [[{ text: "◀️ К категории", callback_data: `category:view:${first}` }]] }); return; }
      await db.delete(categories).where(eq(categories.id, first));
      await audit(db, adminId, "category.delete", first, { slug: category.slug });
      await sendMessage(token, chatId, `Категория ${category.name} удалена.`, { inline_keyboard: [[{ text: "◀️ К списку", callback_data: "categories:list" }]] });
      return;
    }
    if ((action === "assign" || action === "unassign") && second) {
      const productId = Number(second);
      if (!getProductById(productId)) { await sendMessage(token, chatId, "Неизвестный товар."); return; }
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

    const { text = "" } = message!;

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
        const [order] = await db.select({ id: orders.id, status: orders.status, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.orderNumber, number)).limit(1);
        if (!order) {
          await sendMessage(token, chatId, "Заказ не найден.");
        } else if (!["WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status)) {
          await sendMessage(token, chatId, `Нельзя подтвердить заказ в статусе ${order.status}.`);
        } else {
          await db.update(orders).set({ status: "PAID" }).where(eq(orders.id, order.id));
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
      } else {
        const db = getDb();
        const id = crypto.randomUUID();
        await db.insert(categories).values({ id, slug, name, description, noindex: true, isPublished: false, sortOrder: 0 });
        await audit(db, from.id, "category.create", id, { slug, name });
        await sendMessage(token, chatId, `Категория создана: ${name} (${slug}). По умолчанию скрыта и закрыта от индексации.`, { inline_keyboard: [[{ text: "📂 Открыть список", callback_data: "categories:list" }]] });
      }
    } else if (command === "/category_set") {
      const match = text.trim().match(/^\/category_set\s+(\S+)\s+(\S+)\s+([\\s\\S]+)$/i);
      if (!match || !editableCategoryFields.has(match[2])) {
        await sendMessage(token, chatId, "Формат: /category_set slug field value\nДопустимые field перечислены в /help.");
      } else {
        const [, slug, field, rawValue] = match;
        const db = getDb();
        const [category] = await db.select({ id: categories.id, slug: categories.slug }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else {
          const value = field === "sort_order" ? Number(rawValue) : rawValue.trim();
          if (field === "sort_order" && (!Number.isInteger(value) || value < 0 || value > 100000)) {
            await sendMessage(token, chatId, "sort_order должен быть целым числом от 0 до 100000.");
          } else {
            const update: Record<string, unknown> = { updatedAt: new Date().toISOString(), [field.replaceAll("_", "")] : value };
            const columnMap: Record<string, string> = { image_url: "imageUrl", seo_title: "seoTitle", seo_description: "seoDescription", seo_text: "seoText", canonical_url: "canonicalUrl", og_title: "ogTitle", og_description: "ogDescription", og_image: "ogImage", sort_order: "sortOrder" };
            const key = columnMap[field] ?? field;
            delete update[field.replaceAll("_", "")];
            update[key] = value;
            await db.update(categories).set(update as typeof categories.$inferInsert).where(eq(categories.id, category.id));
            await audit(db, from.id, "category.update", category.id, { field, value });
            await sendMessage(token, chatId, `Категория ${slug}: поле ${field} обновлено.`);
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
            await db.delete(categories).where(eq(categories.id, category.id));
            await audit(db, from.id, "category.delete", category.id, { slug });
            await sendMessage(token, chatId, `Категория ${slug} удалена.`);
          }
        }
      }
    } else if (command === "/category_assign" || command === "/category_unassign") {
      const args = text.trim().split(/\s+/);
      const slug = args[1];
      const productId = Number(args[2]);
      if (!slug || !Number.isInteger(productId) || !getProductById(productId)) {
        await sendMessage(token, chatId, `Формат: ${command} slug productId (productId 1–6)`);
      } else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
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
