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

async function sendMessage(token: string, chatId: number, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) throw new Error("TELEGRAM_SEND_FAILED");
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

function categoryHelp() {
  return [
    "Управление категориями:",
    "/categories — список категорий",
    "/category_create slug | Название | Описание",
    "/category_set slug field value",
    "  field: name, description, image_url, seo_title, seo_description, h1, seo_text, canonical_url, og_title, og_description, og_image, sort_order",
    "/category_publish slug on|off",
    "/category_index slug index|noindex",
    "/category_archive slug — архивировать",
    "/category_restore slug — вернуть из архива",
    "/category_delete slug — удалить, если нет товаров",
    "/category_assign slug productId — назначить товар",
    "/category_unassign slug productId — снять товар",
  ].join("\n");
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
    if (!parsed.success || !parsed.data.message?.from) return Response.json({ ok: true });

    const { chat, from, text = "" } = parsed.data.message;
    const allowedIds = new Set((botEnv.TELEGRAM_ADMIN_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
    if (!allowedIds.has(String(from.id))) return Response.json({ ok: true });

    const command = text.trim().split(/\s+/)[0].toLowerCase().split("@")[0];
    if (command === "/start" || command === "/help") {
      await sendMessage(token, chat.id, `SIMKA Admin\n\n/status — состояние магазина\n/orders — последние заказы\n/paid <номер> — подтвердить оплату\n\n${categoryHelp()}`);
    } else if (command === "/status") {
      const db = getDb();
      const recent = await db.select({ status: orders.status }).from(orders).orderBy(desc(orders.createdAt)).limit(100);
      const active = recent.filter((order) => !["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"].includes(order.status)).length;
      await sendMessage(token, chat.id, `SIMKA работает.\nЗаказов в последней выборке: ${recent.length}\nАктивных: ${active}`);
    } else if (command === "/orders") {
      const db = getDb();
      const recent = await db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).orderBy(desc(orders.createdAt)).limit(5);
      const lines = recent.length ? recent.map((order) => `${order.orderNumber} · ${order.status} · ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`).join("\n") : "Заказов пока нет.";
      await sendMessage(token, chat.id, `Последние заказы:\n\n${lines}`);
    } else if (command === "/paid") {
      const number = text.trim().split(/\s+/)[1]?.toUpperCase();
      if (!number) {
        await sendMessage(token, chat.id, "Укажите номер: /paid SIM-YYYYMMDD-XXXXXXXX");
      } else {
        const db = getDb();
        const [order] = await db.select({ id: orders.id, status: orders.status, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.orderNumber, number)).limit(1);
        if (!order) {
          await sendMessage(token, chat.id, "Заказ не найден.");
        } else if (!["WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status)) {
          await sendMessage(token, chat.id, `Нельзя подтвердить заказ в статусе ${order.status}.`);
        } else {
          await db.update(orders).set({ status: "PAID" }).where(eq(orders.id, order.id));
          await sendMessage(token, chat.id, `Оплата подтверждена. Заказ ${order.orderNumber} → PAID.`);
        }
      }
    } else if (command === "/categories") {
      const db = getDb();
      const list = await db.select({ name: categories.name, slug: categories.slug, isPublished: categories.isPublished, noindex: categories.noindex, archivedAt: categories.archivedAt, sortOrder: categories.sortOrder }).from(categories).orderBy(categories.sortOrder, categories.name);
      const lines = list.length ? list.map((category) => `${category.sortOrder}. ${category.name} (${category.slug}) · ${category.archivedAt ? "ARCHIVED" : category.isPublished ? "PUBLISHED" : "DRAFT"} · ${category.noindex ? "NOINDEX" : "INDEX"}`).join("\n") : "Категорий пока нет.";
      await sendMessage(token, chat.id, `Категории:\n\n${lines}`);
    } else if (command === "/category_create") {
      const parts = text.slice(command.length).trim().split("|").map((part) => part.trim());
      const [slug, name, description = ""] = parts;
      if (!slug || !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120 || name.length > 160) {
        await sendMessage(token, chat.id, "Формат: /category_create slug | Название | Описание\nSlug: латиница, цифры и дефисы.");
      } else {
        const db = getDb();
        const id = crypto.randomUUID();
        await db.insert(categories).values({ id, slug, name, description, noindex: true, isPublished: false, sortOrder: 0 });
        await audit(db, from.id, "category.create", id, { slug, name });
        await sendMessage(token, chat.id, `Категория создана: ${name} (${slug}). По умолчанию скрыта и закрыта от индексации.`);
      }
    } else if (command === "/category_set") {
      const match = text.trim().match(/^\/category_set\s+(\S+)\s+(\S+)\s+([\\s\\S]+)$/i);
      if (!match || !editableCategoryFields.has(match[2])) {
        await sendMessage(token, chat.id, "Формат: /category_set slug field value\nДопустимые field перечислены в /help.");
      } else {
        const [, slug, field, rawValue] = match;
        const db = getDb();
        const [category] = await db.select({ id: categories.id, slug: categories.slug }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chat.id, "Категория не найдена.");
        else {
          const value = field === "sort_order" ? Number(rawValue) : rawValue.trim();
          if (field === "sort_order" && (!Number.isInteger(value) || value < 0 || value > 100000)) {
            await sendMessage(token, chat.id, "sort_order должен быть целым числом от 0 до 100000.");
          } else {
            const update: Record<string, unknown> = { updatedAt: new Date().toISOString(), [field.replaceAll("_", "")] : value };
            const columnMap: Record<string, string> = { image_url: "imageUrl", seo_title: "seoTitle", seo_description: "seoDescription", seo_text: "seoText", canonical_url: "canonicalUrl", og_title: "ogTitle", og_description: "ogDescription", og_image: "ogImage", sort_order: "sortOrder" };
            const key = columnMap[field] ?? field;
            delete update[field.replaceAll("_", "")];
            update[key] = value;
            await db.update(categories).set(update as typeof categories.$inferInsert).where(eq(categories.id, category.id));
            await audit(db, from.id, "category.update", category.id, { field, value });
            await sendMessage(token, chat.id, `Категория ${slug}: поле ${field} обновлено.`);
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
        await sendMessage(token, chat.id, isPublish ? "Формат: /category_publish slug on|off" : "Формат: /category_index slug index|noindex");
      } else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chat.id, "Категория не найдена.");
        else {
          const update = isPublish ? { isPublished: choice === "on", updatedAt: new Date().toISOString() } : { noindex: choice === "noindex", updatedAt: new Date().toISOString() };
          await db.update(categories).set(update).where(eq(categories.id, category.id));
          await audit(db, from.id, isPublish ? "category.publish" : "category.indexation", category.id, { value: choice });
          await sendMessage(token, chat.id, `Категория ${slug}: ${isPublish ? (choice === "on" ? "опубликована" : "снята с публикации") : (choice === "index" ? "открыта для индексации" : "закрыта от индексации")}.`);
        }
      }
    } else if (["/category_archive", "/category_restore"].includes(command)) {
      const slug = text.trim().split(/\s+/)[1];
      if (!slug) await sendMessage(token, chat.id, `Формат: ${command} slug`);
      else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chat.id, "Категория не найдена.");
        else {
          const archived = command === "/category_archive";
          await db.update(categories).set({ archivedAt: archived ? new Date().toISOString() : null, isPublished: archived ? false : undefined, updatedAt: new Date().toISOString() }).where(eq(categories.id, category.id));
          await audit(db, from.id, archived ? "category.archive" : "category.restore", category.id);
          await sendMessage(token, chat.id, archived ? `Категория ${slug} архивирована.` : `Категория ${slug} восстановлена.`);
        }
      }
    } else if (command === "/category_delete") {
      const slug = text.trim().split(/\s+/)[1];
      if (!slug) await sendMessage(token, chat.id, "Формат: /category_delete slug");
      else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chat.id, "Категория не найдена.");
        else {
          const [linked] = await db.select({ productId: productCategories.productId }).from(productCategories).where(eq(productCategories.categoryId, category.id)).limit(1);
          if (linked) await sendMessage(token, chat.id, "Нельзя удалить категорию: к ней привязаны товары. Сначала используйте /category_unassign.");
          else {
            await db.delete(categories).where(eq(categories.id, category.id));
            await audit(db, from.id, "category.delete", category.id, { slug });
            await sendMessage(token, chat.id, `Категория ${slug} удалена.`);
          }
        }
      }
    } else if (command === "/category_assign" || command === "/category_unassign") {
      const args = text.trim().split(/\s+/);
      const slug = args[1];
      const productId = Number(args[2]);
      if (!slug || !Number.isInteger(productId) || !getProductById(productId)) {
        await sendMessage(token, chat.id, `Формат: ${command} slug productId (productId 1–6)`);
      } else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chat.id, "Категория не найдена.");
        else if (command === "/category_assign") {
          await db.insert(productCategories).values({ categoryId: category.id, productId }).onConflictDoNothing();
          await audit(db, from.id, "category.assign_product", category.id, { productId });
          await sendMessage(token, chat.id, `Товар ${productId} назначен категории ${slug}.`);
        } else {
          await db.delete(productCategories).where(and(eq(productCategories.categoryId, category.id), eq(productCategories.productId, productId)));
          await audit(db, from.id, "category.unassign_product", category.id, { productId });
          await sendMessage(token, chat.id, `Товар ${productId} снят с категории ${slug}.`);
        }
      }
    } else {
      await sendMessage(token, chat.id, "Неизвестная команда. Используйте /help.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("telegram_webhook_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return new Response(null, { status: 500 });
  }
}
