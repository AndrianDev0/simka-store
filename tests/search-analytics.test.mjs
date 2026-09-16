import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSearchQuery } from "../lib/search-analytics.ts";

test("search terms are normalized for useful aggregation", () => {
  assert.equal(normalizeSearchQuery("  ТУРЦИЯ   eSIM  "), "турция esim");
  assert.equal(normalizeSearchQuery("\u0000\t"), null);
});

test("search terms that look like personal data are not retained", () => {
  assert.equal(normalizeSearchQuery("user@example.com"), "[скрытый запрос]");
  assert.equal(normalizeSearchQuery("+7 999 123-45-67"), "[скрытый запрос]");
  assert.equal(normalizeSearchQuery("https://example.com/private"), "[скрытый запрос]");
});

