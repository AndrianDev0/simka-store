import assert from "node:assert/strict";
import test from "node:test";
import { PAGES_ORIGIN, pagesCors, pagesPreflight } from "../lib/pages-cors.ts";

test("Pages receives CORS headers only for the configured origin", async () => {
  const allowed = pagesCors(Response.json({ ok: true }), new Request("https://shop.example/api/pages/catalog", {
    headers: { origin: PAGES_ORIGIN },
  }));
  assert.equal(allowed.headers.get("access-control-allow-origin"), PAGES_ORIGIN);
  assert.equal(allowed.headers.get("vary"), "Origin");
  assert.deepEqual(await allowed.json(), { ok: true });

  const rejected = pagesCors(Response.json({ ok: true }), new Request("https://shop.example/api/pages/catalog", {
    headers: { origin: "https://other.github.io" },
  }));
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
});

test("Pages checkout preflight accepts only the configured origin", () => {
  const allowed = pagesPreflight(new Request("https://shop.example/api/orders", {
    method: "OPTIONS",
    headers: { origin: PAGES_ORIGIN },
  }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), PAGES_ORIGIN);
  assert.equal(allowed.headers.get("access-control-allow-methods"), "POST, OPTIONS");

  const rejected = pagesPreflight(new Request("https://shop.example/api/orders", {
    method: "OPTIONS",
    headers: { origin: "https://other.github.io" },
  }));
  assert.equal(rejected.status, 403);
});
