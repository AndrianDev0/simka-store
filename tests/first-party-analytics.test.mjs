import assert from "node:assert/strict";
import test from "node:test";
import { parseAnalyticsUserAgent, preserveWebVitalValue, safeAnalyticsPath, sanitizeAnalyticsParams, validAnalyticsEventName } from "../lib/first-party-analytics.ts";

test("first-party events accept known and namespaced custom names only", () => {
  assert.equal(validAnalyticsEventName("begin_checkout"), true);
  assert.equal(validAnalyticsEventName("custom_tariff_compare"), true);
  assert.equal(validAnalyticsEventName("email@example.com"), false);
});

test("event parameters retain business values but drop unknown or unsafe shapes", () => {
  assert.deepEqual(sanitizeAnalyticsParams({
    currency: "RUB", value: 2490, email: "private@example.com", filters: "country=turkey",
    items: [{ item_id: "TR-20", item_name: "Турция 20 ГБ", price: 2490, quantity: 1, secret: "drop" }],
  }), {
    currency: "RUB", value: 2490, filters: "country=turkey",
    items: [{ item_id: "TR-20", item_name: "Турция 20 ГБ", price: 2490, quantity: 1 }],
  });
});

test("paths lose query data and user agents are reduced to coarse categories", () => {
  assert.equal(safeAnalyticsPath("/catalog?q=private#results"), "/catalog");
  assert.deepEqual(parseAnalyticsUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), { deviceType: "mobile", operatingSystem: "iOS", browser: "Safari" });
});

test("web vital values preserve fractional CLS measurements", () => {
  assert.equal(preserveWebVitalValue(0.12), 0.12);
  assert.equal(preserveWebVitalValue(0.123456), 0.123456);
});
