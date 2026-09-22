import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createCryptoPayment, getCryptoPaymentConfig, plisioSourceAmountMatchesOrder, verifyPlisioCallbackSignature } from "../lib/crypto-payments.ts";

test("Plisio callback signature accepts the exact JSON fields and rejects tampering", () => {
  const secret = "p".repeat(32);
  const unsigned = { txn_id: "txn-1", ipn_type: "invoice", order_number: "SIM-1", status: "completed", amount: "0.01", currency: "BTC", source_amount: "2490.000000", source_currency: "RUB" };
  const verify_hash = createHmac("sha1", secret).update(JSON.stringify(unsigned)).digest("hex");
  const payload = { ...unsigned, verify_hash };
  assert.equal(verifyPlisioCallbackSignature(payload, secret), true);
  assert.equal(verifyPlisioCallbackSignature({ ...payload, source_amount: "2491.000000" }, secret), false);
  assert.equal(verifyPlisioCallbackSignature({ ...payload, verify_hash: "0".repeat(40) }, secret), false);
});

test("source amount comparison is exact and accepts only zero decimal padding", () => {
  assert.equal(plisioSourceAmountMatchesOrder("2490", 2490), true);
  assert.equal(plisioSourceAmountMatchesOrder("2490.000000", 2490), true);
  assert.equal(plisioSourceAmountMatchesOrder("2490.01", 2490), false);
  assert.equal(plisioSourceAmountMatchesOrder("2491", 2490), false);
});

test("Plisio configuration fails closed until provider, secret, and public flag exist", () => {
  const names = ["NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED", "CRYPTO_PAYMENT_PROVIDER", "PLISIO_SECRET_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED = "true";
    process.env.CRYPTO_PAYMENT_PROVIDER = "plisio";
    process.env.PLISIO_SECRET_KEY = "short";
    assert.equal(getCryptoPaymentConfig(), null);
    process.env.PLISIO_SECRET_KEY = "b".repeat(32);
    assert.equal(getCryptoPaymentConfig()?.provider, "plisio");
    process.env.CRYPTO_PAYMENT_PROVIDER = "another";
    assert.equal(getCryptoPaymentConfig(), null);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("payment creation calls Plisio with trusted callback URLs and accepts only Plisio checkout", async () => {
  const originalFetch = globalThis.fetch;
  const config = { provider: "plisio", createUrl: "https://api.plisio.net/api/v1/invoices/new", apiKey: "k".repeat(32) };
  try {
    globalThis.fetch = async (url, init) => {
      const requestUrl = new URL(url);
      assert.equal(init.method, "GET");
      assert.equal(new Headers(init.headers).get("X-Idempotency-Key"), "req-1");
      assert.equal(requestUrl.searchParams.get("source_currency"), "RUB");
      assert.equal(requestUrl.searchParams.get("source_amount"), "2490");
      assert.equal(requestUrl.searchParams.get("order_number"), "SIM-1");
      assert.equal(requestUrl.searchParams.get("api_key"), config.apiKey);
      assert.equal(requestUrl.searchParams.get("callback_url"), "https://shop.example/api/payments/crypto/webhook/plisio?json=true");
      return Response.json({ status: "success", data: { txn_id: "payment-1", invoice_url: "https://plisio.net/invoice/1" } });
    };
    const result = await createCryptoPayment({ config, orderId: "order-1", orderNumber: "SIM-1", amount: 2490, currency: "RUB", requestId: "req-1", siteOrigin: "https://shop.example" });
    assert.equal(result.providerPaymentId, "payment-1");
    assert.equal(result.checkoutUrl, "https://plisio.net/invoice/1");

    globalThis.fetch = async () => Response.json({ status: "success", data: { txn_id: "payment-2", invoice_url: "https://evil.example/invoice/2" } });
    await assert.rejects(() => createCryptoPayment({ config, orderId: "order-2", orderNumber: "SIM-2", amount: 1500, currency: "RUB", requestId: "req-2", siteOrigin: "https://shop.example" }), /INSECURE_CHECKOUT_URL/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
