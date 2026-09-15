import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createCryptoPayment, getCryptoPaymentConfig, verifyCryptoWebhookSignature } from "../lib/crypto-payments.ts";

test("webhook signature accepts exact fresh payload and rejects tampering or replay", () => {
  const rawBody = JSON.stringify({ event_id: "evt-1", status: "paid" });
  const timestamp = "1789488000";
  const now = Number(timestamp) * 1000;
  const signature = createHmac("sha256", "a".repeat(32)).update(`${timestamp}.${rawBody}`).digest("hex");
  assert.equal(verifyCryptoWebhookSignature({ rawBody, timestamp, signature, secret: "a".repeat(32), now }), true);
  assert.equal(verifyCryptoWebhookSignature({ rawBody: `${rawBody} `, timestamp, signature, secret: "a".repeat(32), now }), false);
  assert.equal(verifyCryptoWebhookSignature({ rawBody, timestamp, signature, secret: "a".repeat(32), now: now + 301_000 }), false);
});

test("configuration fails closed until every server secret and the public feature flag exist", () => {
  const names = ["NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED", "CRYPTO_PAYMENT_PROVIDER", "CRYPTO_PAYMENT_CREATE_URL", "CRYPTO_PAYMENT_API_KEY", "CRYPTO_PAYMENT_WEBHOOK_SECRET"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED = "true";
    process.env.CRYPTO_PAYMENT_PROVIDER = "adapter";
    process.env.CRYPTO_PAYMENT_CREATE_URL = "https://payments.example/create";
    process.env.CRYPTO_PAYMENT_API_KEY = "server-key";
    process.env.CRYPTO_PAYMENT_WEBHOOK_SECRET = "short";
    assert.equal(getCryptoPaymentConfig(), null);
    process.env.CRYPTO_PAYMENT_WEBHOOK_SECRET = "b".repeat(32);
    assert.equal(getCryptoPaymentConfig()?.provider, "adapter");
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("payment creation uses an idempotency key and only accepts HTTPS checkout URLs", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(new Headers(init.headers).get("Idempotency-Key"), "req-1");
      const body = JSON.parse(init.body);
      assert.equal(body.order_id, "order-1");
      assert.equal(body.webhook_url, "https://shop.example/api/payments/crypto/webhook/adapter");
      return Response.json({ payment_id: "payment-1", status: "pending", checkout_url: "https://pay.example/invoice/1" });
    };
    const result = await createCryptoPayment({
      config: { provider: "adapter", createUrl: "https://payments.example/create", apiKey: "key", webhookSecret: "c".repeat(32) },
      orderId: "order-1",
      orderNumber: "SIM-1",
      amount: 1500,
      currency: "RUB",
      requestId: "req-1",
      siteOrigin: "https://shop.example",
    });
    assert.equal(result.checkoutUrl, "https://pay.example/invoice/1");

    globalThis.fetch = async () => Response.json({ payment_id: "payment-2", status: "pending", checkout_url: "http://pay.example/invoice/2" });
    await assert.rejects(() => createCryptoPayment({
      config: { provider: "adapter", createUrl: "https://payments.example/create", apiKey: "key", webhookSecret: "c".repeat(32) },
      orderId: "order-2",
      orderNumber: "SIM-2",
      amount: 1500,
      currency: "RUB",
      requestId: "req-2",
      siteOrigin: "https://shop.example",
    }), /INSECURE_CHECKOUT_URL/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
