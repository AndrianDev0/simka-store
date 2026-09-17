import assert from "node:assert/strict";
import test from "node:test";
import { collectAccountAnalyticsClientIds } from "../lib/account-data-export.ts";

test("account export includes client ids linked before and after login", () => {
  const ids = collectAccountAnalyticsClientIds(
    [{ clientId: "visitor-after-login" }, { clientId: "shared-id" }],
    [{ consentId: "visitor-before-login" }, { consentId: "shared-id" }],
    [{ firstPartyClientId: "checkout-client" }, { firstPartyClientId: null }],
  );

  assert.deepEqual(ids, ["visitor-after-login", "shared-id", "visitor-before-login", "checkout-client"]);
});
