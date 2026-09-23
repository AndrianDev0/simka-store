import assert from "node:assert/strict";
import test from "node:test";
import { collectAccountAnalyticsClientIds, exclusivelyOwnedAnalyticsClientIds } from "../lib/account-data-export.ts";
import { shouldRotateAnalyticsClientId } from "../lib/analytics-identity.ts";

test("account export includes client ids linked before and after login", () => {
  const ids = collectAccountAnalyticsClientIds(
    [{ clientId: "visitor-after-login" }, { clientId: "shared-id" }],
    [{ consentId: "visitor-before-login" }, { consentId: "shared-id" }],
    [{ firstPartyClientId: "checkout-client" }, { firstPartyClientId: null }],
  );

  assert.deepEqual(ids, ["visitor-after-login", "shared-id", "visitor-before-login", "checkout-client"]);
});

test("shared browser IDs cannot export anonymous sessions or events from another account", () => {
  const safeIds = exclusivelyOwnedAnalyticsClientIds("account-a", ["a-only", "shared", "anonymous-before-login"], [
    { clientId: "a-only", accountId: "account-a" },
    { clientId: "shared", accountId: "account-a" },
    { clientId: "shared", accountId: "account-b" },
    { clientId: "anonymous-before-login", accountId: null },
  ]);
  assert.deepEqual(safeIds, ["a-only", "anonymous-before-login"]);
});

test("account boundaries rotate analytics IDs while first login keeps prior anonymous visits", () => {
  assert.equal(shouldRotateAnalyticsClientId("guest", "account-first"), false);
  assert.equal(shouldRotateAnalyticsClientId("account-first", "guest-after-logout"), true);
  assert.equal(shouldRotateAnalyticsClientId("guest-after-logout", "account-second"), false);
  assert.equal(shouldRotateAnalyticsClientId("account-first", "account-switch-second"), true);
});
