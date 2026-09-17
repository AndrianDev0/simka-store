import assert from "node:assert/strict";
import test from "node:test";
import { allowsAnalytics, ANALYTICS_POLICY_VERSION } from "../lib/analytics-policy.ts";

test("server analytics requires current explicit consent", () => {
  assert.equal(allowsAnalytics({ decision: "accepted", policyVersion: ANALYTICS_POLICY_VERSION }), true);
  assert.equal(allowsAnalytics({ decision: "accepted", policyVersion: "old-policy" }), false);
  assert.equal(allowsAnalytics({ decision: "declined", policyVersion: ANALYTICS_POLICY_VERSION }), false);
  assert.equal(allowsAnalytics({ decision: "withdrawn", policyVersion: ANALYTICS_POLICY_VERSION }), false);
  assert.equal(allowsAnalytics(null), false);
});
