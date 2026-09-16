import assert from "node:assert/strict";
import test from "node:test";
import { createPartnerCookie, isValidPartnerCode, normalizePartnerCode, partnerCommission, readPartnerCookie } from "../lib/partner-attribution.ts";

test("partner ids are normalized and constrained", () => {
  assert.equal(normalizePartnerCode(" travel_blog "), "TRAVEL_BLOG");
  assert.equal(isValidPartnerCode("TRAVEL_BLOG"), true);
  assert.equal(isValidPartnerCode("x"), false);
  assert.equal(isValidPartnerCode("bad code"), false);
});

test("signed attribution cookie rejects changes and expiry", () => {
  const now = Date.UTC(2026, 8, 17);
  const cookie = createPartnerCookie("TRAVELBLOG", now);
  assert.equal(readPartnerCookie(cookie, now + 1000), "TRAVELBLOG");
  assert.equal(readPartnerCookie(cookie.replace("TRAVELBLOG", "EVILBLOG"), now + 1000), null);
  assert.equal(readPartnerCookie(cookie, now + 31 * 24 * 60 * 60 * 1000), null);
});

test("commission uses basis points and rounds monetary minor units", () => {
  assert.equal(partnerCommission(2490, 1250), 311);
  assert.equal(partnerCommission(3190, 1000), 319);
});
