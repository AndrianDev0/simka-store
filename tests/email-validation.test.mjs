import assert from "node:assert/strict";
import test from "node:test";
import { getEmailValidationError, isValidEmailAddress, normalizeEmailAddress } from "../lib/email-validation.ts";

test("email validation accepts normal addresses and normalizes case", () => {
  assert.equal(normalizeEmailAddress("  User@Gmail.com "), "user@gmail.com");
  assert.equal(isValidEmailAddress("user@gmail.com"), true);
  assert.equal(isValidEmailAddress("sales@example.travel"), true);
});

test("email validation rejects malformed addresses", () => {
  assert.match(getEmailValidationError("user@") || "", /корректный email/i);
  assert.match(getEmailValidationError("user example.com") || "", /корректный email/i);
});

test("email validation explains common provider typos", () => {
  assert.match(getEmailValidationError("maa190186@hmail.com") || "", /gmail\.com/);
  assert.match(getEmailValidationError("user@gmial.com") || "", /gmail\.com/);
});
