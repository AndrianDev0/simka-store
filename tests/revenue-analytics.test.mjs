import assert from "node:assert/strict";
import test from "node:test";
import { calculateRevenueAnalytics, proratedMarketingCost } from "../lib/revenue-analytics.ts";

test("prorates campaign cost over the selected overlap", () => {
  assert.equal(proratedMarketingCost({ amount: 3100, currency: "RUB", startsAt: "2026-09-01", endsAt: "2026-10-01" }, "2026-09-01T00:00:00.000Z", "2026-09-11T00:00:00.000Z"), 1000);
  assert.equal(proratedMarketingCost({ amount: 3100, currency: "RUB", startsAt: "2026-09-01", endsAt: "2026-10-01" }, "2026-08-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z"), 0);
});

test("calculates refunds, costs, commission, profit, margin, ROAS and ROI", () => {
  const rows = calculateRevenueAnalytics([
    { id: "paid", status: "PAID", subtotalAmount: 10000, discountAmount: 1000, deliveryAmount: 500, totalAmount: 9500, currency: "RUB", partnerCode: "PARTNER" },
    { id: "refund", status: "REFUNDED", subtotalAmount: 4000, discountAmount: 0, deliveryAmount: 0, totalAmount: 4000, currency: "RUB", partnerCode: null },
  ], [
    { orderId: "paid", unitCost: 3000, quantity: 1 },
    { orderId: "refund", unitCost: 1200, quantity: 1 },
  ], [{ code: "PARTNER", commissionBps: 1000 }], [{ amount: 1000, currency: "RUB", startsAt: "2026-09-01", endsAt: "2026-09-10" }], "2026-09-01T00:00:00.000Z", "2026-09-11T00:00:00.000Z");

  assert.deepEqual(rows[0], {
    currency: "RUB", orders: 2, grossRevenue: 14000, discounts: 1000, refunds: 4000,
    netProductRevenue: 9000, deliveryRevenue: 500, costOfGoods: 4200, partnerCommission: 950,
    marketingCost: 1000, deliveryExpense: 0, paymentFees: 0, otherExpenses: 0, totalExpenses: 6150,
    profit: 3350, marginPercent: 3350 / 9500 * 100, roas: 9,
    roiPercent: 335, knownCostItems: 2, totalCostItems: 2,
    missingDeliveryExpenseOrders: 1, missingPaymentFeeOrders: 2, missingOtherExpenseOrders: 2,
    estimatedPartnerCommissionOrders: 1,
  });
});

test("keeps missing costs visible instead of pretending profit is exact", () => {
  const [row] = calculateRevenueAnalytics([
    { id: "paid", status: "COMPLETED", subtotalAmount: 2000, discountAmount: 0, deliveryAmount: 0, totalAmount: 2000, currency: "USD", partnerCode: null },
  ], [{ orderId: "paid", unitCost: null, quantity: 2 }], [], [], null, null);
  assert.equal(row.knownCostItems, 0);
  assert.equal(row.totalCostItems, 2);
  assert.equal(row.profit, 2000);
  assert.equal(row.totalExpenses, 0);
  assert.equal(row.missingPaymentFeeOrders, 1);
});

test("subtracts recorded operating expenses and uses the historical partner rate", () => {
  const [row] = calculateRevenueAnalytics([
    { id: "paid", status: "PAID", subtotalAmount: 10000, discountAmount: 0, deliveryAmount: 500, totalAmount: 10500, currency: "RUB", partnerCode: "PARTNER", partnerCommissionBpsSnapshot: 500, deliveryExpenseAmount: 300, paymentFeeAmount: 210, otherExpenseAmount: 90 },
  ], [], [{ code: "PARTNER", commissionBps: 2000 }], [], null, null);
  assert.equal(row.partnerCommission, 525);
  assert.equal(row.deliveryExpense, 300);
  assert.equal(row.paymentFees, 210);
  assert.equal(row.otherExpenses, 90);
  assert.equal(row.totalExpenses, 1125);
  assert.equal(row.profit, 9375);
  assert.equal(row.estimatedPartnerCommissionOrders, 0);
});
