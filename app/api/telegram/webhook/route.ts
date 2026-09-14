import { env } from "cloudflare:workers";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { orders } from "@/db/schema";

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

export async function POST(request: Request) {
  const botEnv = env as unknown as BotEnvironment;
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
      await sendMessage(token, chat.id, "SIMKA Admin\n\n/status — состояние магазина\n/orders — последние заказы\n/help — список команд");
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
    } else {
      await sendMessage(token, chat.id, "Неизвестная команда. Используйте /help.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("telegram_webhook_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return new Response(null, { status: 500 });
  }
}
