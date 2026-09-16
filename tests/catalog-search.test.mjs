import assert from "node:assert/strict";
import test from "node:test";
import { catalogSearchPattern, normalizeCatalogSearchQuery } from "../lib/catalog-search.ts";

test("catalog search terms are bounded and normalized", () => {
  assert.equal(normalizeCatalogSearchQuery("  Турция\t  Turkcell "), "Турция Turkcell");
  assert.equal(normalizeCatalogSearchQuery("x".repeat(150)).length, 100);
});

test("catalog search escapes SQL LIKE wildcard characters", () => {
  assert.equal(catalogSearchPattern("50%_SIM\\eSIM"), "%50\\%\\_SIM\\\\eSIM%");
});

