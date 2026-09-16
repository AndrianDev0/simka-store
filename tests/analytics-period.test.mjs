import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalyticsPeriodBounds, parseAnalyticsDateRange, shiftIsoYear } from "../lib/analytics-period.ts";

test("analytics periods calculate previous and calendar year comparisons", () => {
  const bounds = buildAnalyticsPeriodBounds(14, new Date("2026-09-17T12:00:00.000Z"));
  assert.equal(bounds.start, "2026-09-03T12:00:00.000Z");
  assert.equal(bounds.previousStart, "2026-08-20T12:00:00.000Z");
  assert.equal(bounds.yearAgoStart, "2025-09-03T12:00:00.000Z");
  assert.equal(bounds.yearAgoEnd, "2025-09-17T12:00:00.000Z");
});

test("calendar year comparison handles leap day", () => {
  assert.equal(shiftIsoYear("2024-02-29T23:59:59.999Z", -1), "2023-02-28T23:59:59.999Z");
});

test("custom analytics range validates real ISO dates", () => {
  assert.deepEqual(parseAnalyticsDateRange("2026-09-01 | 2026-09-17"), {
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-09-17T23:59:59.999Z",
  });
  assert.equal(parseAnalyticsDateRange("2026-02-30 | 2026-03-01"), null);
  assert.equal(parseAnalyticsDateRange("2026-09-17 | 2026-09-01"), null);
});

test("custom period comparison covers whole calendar days", () => {
  const range = parseAnalyticsDateRange("2026-09-01 | 2026-09-01");
  const bounds = buildAnalyticsPeriodBounds(0, new Date(), range);
  assert.equal(bounds.previousStart, "2026-08-31T00:00:00.000Z");
  assert.equal(bounds.previousEnd, "2026-09-01T00:00:00.000Z");
});
