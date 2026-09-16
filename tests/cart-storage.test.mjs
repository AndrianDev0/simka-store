import assert from "node:assert/strict";
import test from "node:test";
import { parseStoredCart, serializeCart } from "../lib/cart-storage.ts";

test("cart storage round-trips bounded product selections", () => {
  const stored = serializeCart({ "1:0": 2, "2:31": 99, bad: 5 }, 1_000);
  assert.deepEqual(parseStoredCart(stored, 2_000), { "1:0": 2, "2:31": 20 });
});

test("cart storage rejects malformed, future and expired values", () => {
  assert.deepEqual(parseStoredCart("not-json"), {});
  assert.deepEqual(parseStoredCart('{"version":2,"updatedAt":1000,"items":[]} ', 2_000), {});
  const stored = serializeCart({ "1:0": 1 }, 1_000);
  assert.deepEqual(parseStoredCart(stored, 1_000 + 31 * 24 * 60 * 60 * 1000), {});
  assert.deepEqual(parseStoredCart(serializeCart({ "1:0": 1 }, 100_000), 1_000), {});
});
