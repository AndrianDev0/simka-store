import assert from "node:assert/strict";
import test from "node:test";
import { getEmailConfigurationStatus, sendTransactionalEmail } from "../lib/email.ts";

const environmentNames = ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO"];

function restoreEnvironment(previous) {
  for (const name of environmentNames) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
}

test("email configuration fails closed when server settings are missing", () => {
  const previous = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    assert.deepEqual(getEmailConfigurationStatus(), {
      configured: false,
      missing: ["RESEND_API_KEY", "EMAIL_FROM"],
    });
  } finally {
    restoreEnvironment(previous);
  }
});

test("email request uses Resend safely and returns the provider id", async () => {
  const previous = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.RESEND_API_KEY = "re_test_secret";
    process.env.EMAIL_FROM = "SIMKA <orders@example.com>";
    process.env.EMAIL_REPLY_TO = "support@example.com";
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.resend.com/emails");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Authorization"), "Bearer re_test_secret");
      assert.equal(headers.get("Idempotency-Key"), "welcome-account/account-1");
      const body = JSON.parse(init.body);
      assert.equal(body.from, "SIMKA <orders@example.com>");
      assert.deepEqual(body.to, ["client@example.net"]);
      assert.equal(body.reply_to, "support@example.com");
      return Response.json({ id: "email-1" });
    };
    const result = await sendTransactionalEmail({
      to: "client@example.net",
      subject: "Test",
      text: "Test",
      html: "<p>Test</p>",
      idempotencyKey: "welcome-account/account-1",
    });
    assert.deepEqual(result, { delivered: true, id: "email-1" });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("network and provider errors do not break the business flow", async () => {
  const previous = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  try {
    process.env.RESEND_API_KEY = "re_test_secret";
    process.env.EMAIL_FROM = "SIMKA <orders@example.com>";
    console.error = () => {};
    globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
    const message = { to: "client@example.net", subject: "Test", text: "Test", html: "<p>Test</p>" };
    assert.deepEqual(await sendTransactionalEmail(message), { delivered: false, reason: "provider_error" });
    globalThis.fetch = async () => new Response(null, { status: 403 });
    assert.deepEqual(await sendTransactionalEmail(message), { delivered: false, reason: "provider_error" });
  } finally {
    console.error = originalConsoleError;
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});
