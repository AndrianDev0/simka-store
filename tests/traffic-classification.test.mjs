import assert from "node:assert/strict";
import test from "node:test";
import { classifyTraffic } from "../lib/traffic-classification.ts";

const browser = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

test("ordinary browser activity is classified as human", () => {
  assert.deepEqual(classifyTraffic({ userAgent: browser, eventName: "page_view", sessionStartedAt: "2026-09-17T00:00:00.000Z", occurredAt: "2026-09-17T00:00:02.000Z", priorEventCount: 0, priorPageViews: 0 }), { trafficClass: "HUMAN", reasons: [] });
});

test("automation and known crawler user agents are classified as bots", () => {
  const base = { eventName: "page_view", sessionStartedAt: "2026-09-17T00:00:00.000Z", occurredAt: "2026-09-17T00:00:02.000Z", priorEventCount: 0, priorPageViews: 0 };
  assert.deepEqual(classifyTraffic({ ...base, userAgent: browser, automation: true }), { trafficClass: "BOT", reasons: ["browser_automation"] });
  assert.deepEqual(classifyTraffic({ ...base, userAgent: "Mozilla/5.0 compatible; ExampleBot/1.0" }), { trafficClass: "BOT", reasons: ["automated_user_agent"] });
});

test("unusual request bursts are suspicious and never downgrade the session", () => {
  const result = classifyTraffic({ userAgent: browser, eventName: "page_view", sessionStartedAt: "2026-09-17T00:00:00.000Z", occurredAt: "2026-09-17T00:00:10.000Z", priorEventCount: 30, priorPageViews: 10, priorClass: "SUSPICIOUS", priorReasons: ["event_burst"] });
  assert.deepEqual(result, { trafficClass: "SUSPICIOUS", reasons: ["event_burst", "page_view_burst"] });
});

test("a bot session cannot be downgraded by a later ordinary event", () => {
  const result = classifyTraffic({ userAgent: browser, eventName: "view_item", sessionStartedAt: "2026-09-17T00:00:00.000Z", occurredAt: "2026-09-17T00:00:20.000Z", priorEventCount: 3, priorPageViews: 2, priorClass: "BOT", priorReasons: ["automated_user_agent"] });
  assert.deepEqual(result, { trafficClass: "BOT", reasons: ["automated_user_agent"] });
});
