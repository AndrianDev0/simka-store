import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const createResponseSchema = z.object({
  payment_id: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(80).default("pending"),
  checkout_url: z.string().url(),
}).strict();

export type CryptoPaymentConfig = {
  provider: string;
  createUrl: string;
  apiKey: string;
  webhookSecret: string;
};

export function getCryptoPaymentConfig(): CryptoPaymentConfig | null {
  const provider = process.env.CRYPTO_PAYMENT_PROVIDER?.trim().toLowerCase();
  const createUrl = process.env.CRYPTO_PAYMENT_CREATE_URL?.trim();
  const apiKey = process.env.CRYPTO_PAYMENT_API_KEY?.trim();
  const webhookSecret = process.env.CRYPTO_PAYMENT_WEBHOOK_SECRET?.trim();
  if (process.env.NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED !== "true" || !provider || !createUrl || !apiKey || !webhookSecret || webhookSecret.length < 32) return null;
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(provider)) return null;
  try {
    const url = new URL(createUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  } catch {
    return null;
  }
  return { provider, createUrl, apiKey, webhookSecret };
}

export function getPaymentSiteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) throw new Error("PAYMENT_SITE_ORIGIN_NOT_CONFIGURED");
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PAYMENT_SITE_ORIGIN_INVALID");
  }
  return url.origin;
}

export async function createCryptoPayment(input: {
  config: CryptoPaymentConfig;
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  requestId: string;
  siteOrigin: string;
}) {
  const webhookUrl = new URL(`/api/payments/crypto/webhook/${encodeURIComponent(input.config.provider)}`, input.siteOrigin);
  const returnUrl = new URL("/account", input.siteOrigin);
  const response = await fetch(input.config.createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.requestId,
    },
    body: JSON.stringify({
      order_id: input.orderId,
      order_number: input.orderNumber,
      amount: input.amount,
      currency: input.currency,
      return_url: returnUrl.toString(),
      webhook_url: webhookUrl.toString(),
    }),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`CRYPTO_PROVIDER_CREATE_${response.status}`);
  const result = createResponseSchema.safeParse(await response.json());
  if (!result.success) throw new Error("CRYPTO_PROVIDER_INVALID_RESPONSE");
  const checkoutUrl = new URL(result.data.checkout_url);
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.username || checkoutUrl.password) throw new Error("CRYPTO_PROVIDER_INSECURE_CHECKOUT_URL");
  return { providerPaymentId: result.data.payment_id, status: result.data.status.toUpperCase(), checkoutUrl: checkoutUrl.toString() };
}

export function verifyCryptoWebhookSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  now?: number;
}) {
  if (!input.timestamp || !/^\d{10,13}$/.test(input.timestamp) || !input.signature) return false;
  const timestampMs = input.timestamp.length === 10 ? Number(input.timestamp) * 1000 : Number(input.timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs((input.now ?? Date.now()) - timestampMs) > 5 * 60_000) return false;
  const suppliedHex = input.signature.toLowerCase().replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/.test(suppliedHex)) return false;
  const expected = createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`, "utf8").digest();
  const supplied = Buffer.from(suppliedHex, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
