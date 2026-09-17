import assert from "node:assert/strict";
import test from "node:test";
import { attributionWeights, calculateAttribution, isAttributionModel } from "../lib/attribution.ts";

const touches = [
  { source: "google", campaign: "brand", occurredAt: "2026-09-01T00:00:00.000Z" },
  { source: "telegram", campaign: "launch", occurredAt: "2026-09-05T00:00:00.000Z" },
  { source: "direct", campaign: null, occurredAt: "2026-09-08T00:00:00.000Z" },
];

test("all supported attribution models conserve a full conversion", () => {
  for (const model of ["first_click", "last_click", "linear", "position_based", "time_decay"]) {
    assert.equal(isAttributionModel(model), true);
    const weights = attributionWeights(model, touches, "2026-09-09T00:00:00.000Z");
    assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-10);
  }
  assert.equal(isAttributionModel("made_up"), false);
});

test("position based attribution gives 40 percent to first and last touch", () => {
  assert.deepEqual(attributionWeights("position_based", touches, "2026-09-09T00:00:00.000Z"), [0.4, 0.2, 0.4]);
  assert.deepEqual(attributionWeights("position_based", touches.slice(0, 2), "2026-09-09T00:00:00.000Z"), [0.5, 0.5]);
});

test("time decay gives more credit to recent interactions", () => {
  const weights = attributionWeights("time_decay", touches, "2026-09-09T00:00:00.000Z");
  assert.ok(weights[2] > weights[1]);
  assert.ok(weights[1] > weights[0]);
});

test("revenue is preserved exactly in minor units and repeated sources are grouped", () => {
  const rows = calculateAttribution([{ id: "order-1", amount: 1001, currency: "rub", convertedAt: "2026-09-09T00:00:00.000Z", touches }], "linear");
  assert.equal(rows.reduce((sum, row) => sum + row.revenue, 0), 1001);
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.conversions, 0) - 1) < 1e-10);
  const grouped = calculateAttribution([{ id: "order-2", amount: 500, currency: "RUB", convertedAt: "2026-09-09T00:00:00.000Z", touches: [touches[0], { ...touches[0], occurredAt: "2026-09-08T00:00:00.000Z" }] }], "linear");
  assert.deepEqual(grouped, [{ source: "google", campaign: "brand", currency: "RUB", conversions: 1, revenue: 500 }]);
});
