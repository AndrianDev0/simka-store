import test from "node:test";
import assert from "node:assert/strict";
import { reusableAnalyticsSession, resolveLandingAttribution } from "../lib/analytics-attribution.ts";

const origin = "https://simka-store.onrender.com";
const sessionId = "123e4567-e89b-42d3-a456-426614174000";

test("a fresh external referrer replaces an earlier session source", () => {
  const google = resolveLandingAttribution(`${origin}/`, "https://www.google.com/search?q=simka", origin);
  const telegram = resolveLandingAttribution(`${origin}/`, "https://t.me/simka", origin);

  assert.deepEqual(google, { attribution: { source: "google", medium: "organic", referrerHost: "www.google.com" }, explicitTouch: true });
  assert.deepEqual(telegram, { attribution: { source: "telegram", medium: "social", referrerHost: "t.me" }, explicitTouch: true });
  assert.equal(reusableAnalyticsSession(sessionId, 1_000, 2_000, telegram.explicitTouch, 30 * 60_000), false);
});

test("UTM attribution wins over referrer and starts a fresh session", () => {
  const result = resolveLandingAttribution(`${origin}/?utm_source=telegram&utm_medium=channel&utm_campaign=autumn`, "https://www.google.com/", origin);
  assert.equal(result.explicitTouch, true);
  assert.deepEqual(result.attribution, { source: "telegram", medium: "channel", campaign: "autumn", content: undefined, term: undefined });
});

test("internal navigation keeps the current session while a direct new visit has no inherited source", () => {
  const internal = resolveLandingAttribution(`${origin}/catalog`, `${origin}/`, origin);
  const direct = resolveLandingAttribution(`${origin}/`, "", origin);

  assert.deepEqual(internal, { attribution: { source: "direct", medium: "none" }, explicitTouch: false });
  assert.deepEqual(direct, { attribution: { source: "direct", medium: "none" }, explicitTouch: false });
  assert.equal(reusableAnalyticsSession(sessionId, 1_000, 2_000, internal.explicitTouch, 30 * 60_000), true);
  assert.equal(reusableAnalyticsSession(sessionId, 1_000, 2_000_000, direct.explicitTouch, 30 * 60_000), false);
});
