import assert from "node:assert/strict";
import test from "node:test";
import { calculateCampaignCac, calculateLtv } from "../lib/unit-economics.ts";

const orders = [
  { customerKey: "a", totalAmount: 1000, currency: "RUB", source: "telegram", campaign: "launch", paidAt: "2026-09-01T10:00:00.000Z" },
  { customerKey: "a", totalAmount: 500, currency: "RUB", source: null, campaign: null, paidAt: "2026-09-05T10:00:00.000Z" },
  { customerKey: "b", totalAmount: 2500, currency: "RUB", source: "telegram", campaign: "launch", paidAt: "2026-09-03T10:00:00.000Z" },
];

test("LTV uses lifetime paid revenue per unique customer", () => {
  assert.deepEqual(calculateLtv(orders), [{ currency: "RUB", revenue: 4000, customers: 2, orders: 3, ltv: 2000 }]);
});

test("CAC uses campaign spend per newly acquired paying customer", () => {
  const [row] = calculateCampaignCac(orders, [{ id: "1", source: "Telegram", campaign: "launch", amount: 1000, currency: "RUB", startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-30T23:59:59.999Z" }]);
  assert.equal(row.acquiredCustomers, 2);
  assert.equal(row.cac, 500);
});
