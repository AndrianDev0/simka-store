import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, privacyConsentEvents } from "@/db/schema";
import { ANALYTICS_POLICY_VERSION } from "@/lib/analytics-policy";
import { getCurrentAccount, sameOrigin } from "@/lib/customer-auth";
import { consumeRateLimit, contentLengthWithin, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decisions = new Set(["accepted", "declined", "withdrawn"]);
const sources = new Set(["banner", "settings"]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!contentLengthWithin(request, 4_000)) return new Response("Слишком большой запрос", { status: 413 });

  let input: Record<string, unknown>;
  try {
    input = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const eventId = String(input.eventId || "");
  const consentId = String(input.consentId || "");
  const decision = String(input.decision || "");
  const source = String(input.source || "");
  const policyVersion = String(input.policyVersion || "");
  if (!uuidPattern.test(eventId) || !uuidPattern.test(consentId) || !decisions.has(decision) || !sources.has(source) || policyVersion !== ANALYTICS_POLICY_VERSION) {
    return Response.json({ error: "Некорректные параметры согласия" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const rateLimit = await consumeRateLimit({ request, action: "privacy-consent", subject: consentId, limit: 30, windowMs: 24 * 60 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);
  const account = await getCurrentAccount();
  await getDb().transaction(async (tx) => {
    await tx.insert(privacyConsentEvents).values({
      id: eventId,
      consentId,
      accountId: account?.id ?? null,
      decision: decision as "accepted" | "declined" | "withdrawn",
      source: source as "banner" | "settings",
      policyVersion: ANALYTICS_POLICY_VERSION,
    }).onConflictDoNothing({ target: privacyConsentEvents.id });
    if (decision !== "accepted") {
      await tx.update(orders).set({ analyticsClientId: null }).where(eq(orders.firstPartyClientId, consentId));
    }
  });

  return Response.json({ recorded: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
