import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import test from "node:test";
import { hashPassword, passwordHashNeedsUpgrade, verifyPassword } from "../lib/passwords.ts";

test("new passwords use the hardened v2 scheme", async () => {
  const password = "correct horse battery staple";
  const stored = await hashPassword(password);

  assert.match(stored, /^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword("wrong password", stored), false);
  assert.equal(passwordHashNeedsUpgrade(stored), false);
});

test("legacy v1 hashes remain valid and are marked for upgrade", async () => {
  const password = "legacy customer password";
  const salt = Buffer.from("legacy-test-salt").toString("base64url");
  const hash = pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("base64url");
  const stored = `v1.${salt}.${hash}`;

  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(passwordHashNeedsUpgrade(stored), true);
});

test("malformed and unsupported hashes fail closed", async () => {
  assert.equal(await verifyPassword("password", "v3.salt.hash"), false);
  assert.equal(await verifyPassword("password", "v2.salt.short"), false);
  assert.equal(await verifyPassword("password", "not-a-password-hash"), false);
});
