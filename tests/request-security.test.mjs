import assert from "node:assert/strict";
import test from "node:test";
import { contentLengthWithin, rateLimitSubjectHash, requestNetworkIdentity, sameRequestOrigin } from "../lib/request-security.ts";

test("same-origin protection rejects missing and foreign origins and accepts Render proxy headers", () => {
  assert.equal(sameRequestOrigin(new Request("https://shop.example/api/account/profile", { method: "POST" })), false);
  assert.equal(sameRequestOrigin(new Request("https://shop.example/api/account/profile", { method: "POST", headers: { origin: "https://evil.example" } })), false);
  assert.equal(sameRequestOrigin(new Request("http://internal:10000/api/account/profile", { method: "POST", headers: { origin: "https://shop.example", "x-forwarded-host": "shop.example", "x-forwarded-proto": "https" } })), true);
  assert.equal(sameRequestOrigin(new Request("https://shop.example/api/account/profile", { method: "POST", headers: { referer: "https://shop.example/account" } })), true);
});

test("request size limits reject invalid and oversized content lengths", () => {
  assert.equal(contentLengthWithin(new Request("https://shop.example", { headers: { "content-length": "100" } }), 100), true);
  assert.equal(contentLengthWithin(new Request("https://shop.example", { headers: { "content-length": "101" } }), 100), false);
  assert.equal(contentLengthWithin(new Request("https://shop.example", { headers: { "content-length": "invalid" } }), 100), false);
});

test("rate-limit identity prefers trusted proxy headers and hashes sensitive subjects", () => {
  const request = new Request("https://shop.example", { headers: { "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.1, 198.51.100.2" } });
  assert.equal(requestNetworkIdentity(request), "203.0.113.10");
  const hash = rateLimitSubjectHash(request, "login", "User@Example.com");
  assert.match(hash, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hash.includes("User"), false);
  assert.equal(hash, rateLimitSubjectHash(request, "login", "user@example.com"));
});
