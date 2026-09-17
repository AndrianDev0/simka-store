import assert from "node:assert/strict";
import test from "node:test";
import { safeAccountReturnPath } from "../lib/account-return.ts";

test("account return keeps a local deep link with query and hash", () => {
  assert.equal(safeAccountReturnPath("/account/orders/SIM-1?tab=details#payment"), "/account/orders/SIM-1?tab=details#payment");
});

test("account return rejects external and protocol-relative redirects", () => {
  assert.equal(safeAccountReturnPath("https://example.com"), "/account");
  assert.equal(safeAccountReturnPath("//example.com"), "/account");
  assert.equal(safeAccountReturnPath("/\\example.com"), "/account");
});

test("account return uses the requested fallback for missing values", () => {
  assert.equal(safeAccountReturnPath(undefined, "/"), "/");
});
