import assert from "node:assert/strict";
import test from "node:test";
import { formatPercentage, formatRelativeChange, percentage } from "../lib/analytics-comparison.ts";

test("percentage safely handles an empty total", () => {
  assert.equal(percentage(3, 12), 25);
  assert.equal(percentage(0, 0), 0);
});

test("percentages use the Russian decimal separator", () => {
  assert.equal(formatPercentage(12.34), "12,3%");
});

test("relative change describes growth, decline and a new value", () => {
  assert.equal(formatRelativeChange(12, 10), "+20,0%");
  assert.equal(formatRelativeChange(5, 10), "-50,0%");
  assert.equal(formatRelativeChange(0, 0), "0%");
  assert.equal(formatRelativeChange(3, 0), "новое");
});

