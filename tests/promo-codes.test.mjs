import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePromoCode, isValidPromoCodeFormat, normalizePromoCode } from "../lib/promo-codes.ts";

const base = { code: "WELCOME10", discountType: "percent", discountValue: 10, currency: "RUB", minOrderAmount: 1000, usageLimit: 5, active: true, startsAt: null, endsAt: null };

test("promo codes are normalized and validated", () => {
  assert.equal(normalizePromoCode(" welcome_10 "), "WELCOME_10");
  assert.equal(isValidPromoCodeFormat("SALE-2026"), true);
  assert.equal(isValidPromoCodeFormat("no"), false);
  assert.equal(isValidPromoCodeFormat("подарок"), false);
});

test("percentage and fixed discounts never reduce goods below one unit", () => {
  assert.deepEqual(evaluatePromoCode(base, { subtotalAmount: 2500, currency: "RUB", usedCount: 0 }), { valid: true, code: "WELCOME10", discountAmount: 250 });
  assert.equal(evaluatePromoCode({ ...base, discountType: "fixed", discountValue: 5000 }, { subtotalAmount: 2500, currency: "RUB", usedCount: 0 }).valid, true);
  const capped = evaluatePromoCode({ ...base, discountType: "fixed", discountValue: 5000 }, { subtotalAmount: 2500, currency: "RUB", usedCount: 0 });
  assert.equal(capped.valid && capped.discountAmount, 2499);
});

test("inactive, expired, limited and ineligible promo codes fail clearly", () => {
  assert.equal(evaluatePromoCode({ ...base, active: false }, { subtotalAmount: 2500, currency: "RUB", usedCount: 0 }).valid, false);
  assert.equal(evaluatePromoCode({ ...base, endsAt: "2025-01-01T23:59:59.999Z" }, { subtotalAmount: 2500, currency: "RUB", usedCount: 0, now: new Date("2026-01-01") }).valid, false);
  assert.equal(evaluatePromoCode(base, { subtotalAmount: 2500, currency: "RUB", usedCount: 5 }).valid, false);
  assert.equal(evaluatePromoCode(base, { subtotalAmount: 999, currency: "RUB", usedCount: 0 }).valid, false);
  assert.equal(evaluatePromoCode(base, { subtotalAmount: 2500, currency: "USD", usedCount: 0 }).valid, false);
});
