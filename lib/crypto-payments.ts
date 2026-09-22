import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const PLISIO_CREATE_URL = "https://api.plisio.net/api/v1/invoices/new";

const createResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    txn_id: z.string().trim().min(1).max(200),
    invoice_url: z.string().url(),
  }).passthrough(),
}).passthrough();

export const plisioCallbackSchema = z.object({
  txn_id: z.string().trim().min(1).max(200),
  ipn_type: z.literal("invoice"),
  order_number: z.string().trim().min(1).max(100),
  status: z.enum(["new", "pending", "pending internal", "expired", "completed", "error", "cancelled", "cancelled duplicate"]),
  amount: z.string().trim().regex(/^\d+(?:\.\d+)?$/).max(100),
  currency: z.string().trim().min(2).max(32),
  source_amount: z.string().trim().regex(/^\d+(?:\.\d+)?$/).max(100),
  source_currency: z.string().trim().min(3).max(12),
  verify_hash: z.string().trim().regex(/^[a-fA-F0-9]{40}$/),
  tx_urls: z.array(z.string().url()).optional(),
}).passthrough();

export type CryptoPaymentConfig = {
  provider: "plisio";
  createUrl: typeof PLISIO_CREATE_URL;
  apiKey: string;
};

export function getCryptoPaymentConfig(): CryptoPaymentConfig | null {
  const provider = process.env.CRYPTO_PAYMENT_PROVIDER?.trim().toLowerCase();
  const apiKey = process.env.PLISIO_SECRET_KEY?.trim();
  if (process.env.NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED !== "true" || provider !== "plisio" || !apiKey || apiKey.length < 16) return null;
  return { provider: "plisio", createUrl: PLISIO_CREATE_URL, apiKey };
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
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("CRYPTO_PAYMENT_AMOUNT_INVALID");
  if (!/^[A-Z]{3,12}$/.test(input.currency)) throw new Error("CRYPTO_PAYMENT_CURRENCY_INVALID");

  const callbackUrl = new URL(`/api/payments/crypto/webhook/${input.config.provider}`, input.siteOrigin);
  callbackUrl.searchParams.set("json", "true");
  const successUrl = new URL("/account", input.siteOrigin);
  successUrl.searchParams.set("payment", "returned");
  const failUrl = new URL("/account", input.siteOrigin);
  failUrl.searchParams.set("payment", "cancelled");

  const createUrl = new URL(input.config.createUrl);
  createUrl.searchParams.set("source_currency", input.currency);
  createUrl.searchParams.set("source_amount", String(input.amount));
  createUrl.searchParams.set("order_number", input.orderNumber);
  createUrl.searchParams.set("order_name", `SIMKA ${input.orderNumber}`);
  createUrl.searchParams.set("description", `Order ${input.orderNumber}`);
  createUrl.searchParams.set("callback_url", callbackUrl.toString());
  createUrl.searchParams.set("success_callback_url", successUrl.toString());
  createUrl.searchParams.set("fail_callback_url", failUrl.toString());
  createUrl.searchParams.set("api_key", input.config.apiKey);

  const response = await fetch(createUrl, {
    method: "GET",
    headers: { Accept: "application/json", "X-Idempotency-Key": input.requestId },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`CRYPTO_PROVIDER_CREATE_${response.status}`);
  const result = createResponseSchema.safeParse(await response.json());
  if (!result.success) throw new Error("CRYPTO_PROVIDER_INVALID_RESPONSE");
  const checkoutUrl = new URL(result.data.data.invoice_url);
  const trustedHost = checkoutUrl.hostname === "plisio.net" || checkoutUrl.hostname.endsWith(".plisio.net");
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.username || checkoutUrl.password || !trustedHost) throw new Error("CRYPTO_PROVIDER_INSECURE_CHECKOUT_URL");
  return { providerPaymentId: result.data.data.txn_id, status: "PENDING", checkoutUrl: checkoutUrl.toString() };
}

export function verifyPlisioCallbackSignature(payload: unknown, secret: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !secret) return false;
  const values = { ...(payload as Record<string, unknown>) };
  const suppliedHash = values.verify_hash;
  if (typeof suppliedHash !== "string" || !/^[a-fA-F0-9]{40}$/.test(suppliedHash)) return false;
  delete values.verify_hash;
  const expected = createHmac("sha1", secret).update(JSON.stringify(values), "utf8").digest();
  const supplied = Buffer.from(suppliedHash, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function plisioSourceAmountMatchesOrder(sourceAmount: string, requestedAmount: number) {
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount < 0 || !/^\d+(?:\.\d+)?$/.test(sourceAmount)) return false;
  const [whole, fraction = ""] = sourceAmount.split(".");
  return BigInt(whole) === BigInt(requestedAmount) && (!fraction || /^0+$/.test(fraction));
}
