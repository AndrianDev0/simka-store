import assert from "node:assert/strict";
import test from "node:test";
import { isIgnoredOperationalPath, normalizeOperationalEvent } from "../lib/operational-event-shape.ts";

test("operational telemetry strips query data and unsafe codes", () => {
  const normalized = normalizeOperationalEvent({
    kind: "page error<script>",
    severity: "error",
    area: "checkout form",
    path: "/checkout?email=customer@example.com#payment",
    code: "Error: card 4111 1111 1111 1111",
  });
  assert.deepEqual(normalized, {
    kind: "page_error_script_",
    severity: "error",
    area: "checkout_form",
    path: "/checkout",
    code: "Error:_card_4111_1111_1111_1111",
  });
  assert.equal(JSON.stringify(normalized).includes("customer@example.com"), false);
});

test("operational telemetry uses bounded safe defaults", () => {
  const normalized = normalizeOperationalEvent({ kind: "", severity: "warning", area: "", path: "https://evil.example/private", code: "" });
  assert.equal(normalized.kind, "unknown");
  assert.equal(normalized.area, "unknown");
  assert.equal(normalized.path, "/");
  assert.equal(normalized.code, "unknown");
});

test("operational telemetry ignores monitoring probes and placeholder catalog routes", () => {
  assert.equal(isIgnoredOperationalPath("/__monitoring-qa-v2/check"), true);
  assert.equal(isIgnoredOperationalPath("/__monitoring_qa"), true);
  assert.equal(isIgnoredOperationalPath("/product/slug"), true);
  assert.equal(isIgnoredOperationalPath("/category/slug/"), true);
  assert.equal(isIgnoredOperationalPath("/product/japan-20gb-30days"), false);
});
