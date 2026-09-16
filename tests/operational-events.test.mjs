import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOperationalEvent } from "../lib/operational-event-shape.ts";

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
