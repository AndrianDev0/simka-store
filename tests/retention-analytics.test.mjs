import assert from "node:assert/strict";
import test from "node:test";
import { calculateRepeatPurchaseRetention, retentionPercent } from "../lib/retention-analytics.ts";

test("retention counts unique buyers with a repeat purchase inside each horizon", () => {
  const result = calculateRepeatPurchaseRetention([
    { customerKey: "a", paidAt: "2026-01-01T00:00:00.000Z", source: "telegram" },
    { customerKey: "a", paidAt: "2026-01-01T12:00:00.000Z", source: "google" },
    { customerKey: "b", paidAt: "2026-01-02T00:00:00.000Z", source: "google" },
    { customerKey: "b", paidAt: "2026-01-20T00:00:00.000Z", source: "google" },
    { customerKey: "c", paidAt: "2026-02-01T00:00:00.000Z", source: null },
  ], new Date("2026-04-01T00:00:00.000Z"));
  assert.equal(result.overall.customers, 3);
  assert.equal(result.overall.retained[1], 1);
  assert.equal(result.overall.retained[14], 1);
  assert.equal(result.overall.retained[30], 2);
  assert.equal(result.overall.eligible[90], 1);
  assert.equal(result.cohorts[0].label, "2026-02");
  assert.equal(result.sources[0].label, "telegram");
  assert.ok(Math.abs(retentionPercent(1, 3) - 100 / 3) < 1e-10);
});
