import test from "node:test";
import assert from "node:assert/strict";
import { monotonicFunnelCounts } from "../lib/funnel-analytics.ts";

test("ordered funnel stages can never exceed the preceding stage", () => {
  assert.deepEqual(monotonicFunnelCounts({ visits: 10, productViews: 12, carts: 8, checkouts: 9, orders: 6, payments: 7 }), {
    visits: 10,
    productViews: 10,
    carts: 8,
    checkouts: 8,
    orders: 6,
    payments: 6,
  });
});

test("ordered funnel normalizes missing and invalid counts", () => {
  assert.deepEqual(monotonicFunnelCounts({ visits: 3, productViews: 2, carts: Number.NaN, payments: 20 }), {
    visits: 3,
    productViews: 2,
    carts: 0,
    checkouts: 0,
    orders: 0,
    payments: 0,
  });
});
