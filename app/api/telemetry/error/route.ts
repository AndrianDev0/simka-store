import { z } from "zod";
import { sameOrigin } from "@/lib/customer-auth";
import { recordOperationalEvent } from "@/lib/operational-events";
import { consumeRateLimit, contentLengthWithin, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";

const payloadSchema = z.object({
  kind: z.enum(["page_error", "page_not_found", "window_error", "unhandled_rejection"]),
  area: z.enum(["page", "window"]),
  path: z.string().trim().startsWith("/").max(500),
  code: z.string().trim().regex(/^[a-zA-Z0-9_.:-]+$/).max(128).optional(),
}).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!contentLengthWithin(request, 4_000)) return new Response("Слишком большой запрос", { status: 413 });
  const rateLimit = await consumeRateLimit({ request, action: "technical-error", limit: 60, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);
  let input: unknown;
  try { input = await request.json(); } catch { return new Response(null, { status: 400 }); }
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return new Response(null, { status: 400 });
  await recordOperationalEvent({
    kind: parsed.data.kind,
    severity: parsed.data.kind === "page_not_found" ? "warning" : "error",
    area: parsed.data.area,
    path: parsed.data.path,
    code: parsed.data.code,
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
