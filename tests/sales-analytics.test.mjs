import assert from "node:assert/strict";
import test from "node:test";
import { formatSalesByCurrency, groupSalesByCurrency } from "../lib/sales-analytics.ts";

test("sales analytics keeps currencies separate for the same product", () => {
  const rows = [
    { label: "TR-ESIM", currency: "RUB", quantity: 2, revenue: 3000 },
    { label: "TR-ESIM", currency: "USD", quantity: 1, revenue: 30 },
    { label: "TR-ESIM", currency: "RUB", quantity: 1, revenue: 1500 },
  ];
  assert.deepEqual(groupSalesByCurrency(rows), [
    { label: "TR-ESIM", currency: "RUB", quantity: 3, revenue: 4500 },
    { label: "TR-ESIM", currency: "USD", quantity: 1, revenue: 30 },
  ]);
  const report = formatSalesByCurrency(rows, "нет продаж");
  assert.match(report, /4\s?500 RUB/);
  assert.match(report, /30 USD/);
  assert.doesNotMatch(report, /4\s?530/);
});

test("sales analytics sorts only inside each currency and handles empty data", () => {
  assert.equal(formatSalesByCurrency([], "нет продаж"), "нет продаж");
  const report = formatSalesByCurrency([
    { label: "B", currency: "EUR", quantity: 1, revenue: 10 },
    { label: "A", currency: "EUR", quantity: 1, revenue: 20 },
  ], "нет продаж");
  assert.ok(report.indexOf("A") < report.indexOf("B"));
});
