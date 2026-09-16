import assert from "node:assert/strict";
import test from "node:test";
import { csvCell } from "../lib/csv.ts";

test("CSV cells escape quotes and formula prefixes", () => {
  assert.equal(csvCell('Campaign "A"'), '"Campaign ""A"""');
  assert.equal(csvCell("=HYPERLINK(\"https://evil.example\")"), '"\'=HYPERLINK(""https://evil.example"")"');
  assert.equal(csvCell("+123456"), '"\'+123456"');
  assert.equal(csvCell(null), '""');
});
