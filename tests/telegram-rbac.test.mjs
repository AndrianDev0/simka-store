import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTelegramRoleAssignments,
  resolveTelegramRole,
  telegramCallbackPermission,
  telegramCommandPermission,
  telegramReplyPermission,
  telegramRoleCan,
} from "../lib/telegram-rbac.ts";

test("the first allow-listed administrator is owner and remaining administrators default to admin", () => {
  assert.equal(resolveTelegramRole(10, "10,20", undefined), "owner");
  assert.equal(resolveTelegramRole(20, "10,20", undefined), "admin");
  assert.equal(resolveTelegramRole(30, "10,20", "30:support"), null);
});

test("explicit assignments override safe defaults and malformed assignments are ignored", () => {
  const assignments = parseTelegramRoleAssignments("10:admin, 20:Sales;30:unknown;bad:owner");
  assert.equal(assignments.get("10"), "admin");
  assert.equal(assignments.get("20"), "sales");
  assert.equal(assignments.has("30"), false);
  assert.equal(resolveTelegramRole(20, "10,20", "20:support"), "support");
  assert.equal(resolveTelegramRole(10, "10,20", "10:support,20:sales"), "owner");
  assert.equal(resolveTelegramRole(10, "10,20", "10:support,20:owner"), "support");
  assert.equal(resolveTelegramRole(20, "10,20", "10:support,20:owner"), "owner");
});

test("role matrix separates analytics, sales, support and privileged operations", () => {
  assert.equal(telegramRoleCan("analyst", "analytics.export"), true);
  assert.equal(telegramRoleCan("analyst", "orders.read"), false);
  assert.equal(telegramRoleCan("analyst", "promocodes.read"), true);
  assert.equal(telegramRoleCan("analyst", "promocodes.write"), false);
  assert.equal(telegramRoleCan("marketing", "promocodes.write"), true);
  assert.equal(telegramRoleCan("marketing", "partners.write"), true);
  assert.equal(telegramRoleCan("marketing", "marketing_costs.write"), true);
  assert.equal(telegramRoleCan("analyst", "marketing_costs.write"), false);
  assert.equal(telegramRoleCan("analyst", "partners.read"), true);
  assert.equal(telegramRoleCan("analyst", "partners.write"), false);
  assert.equal(telegramRoleCan("sales", "orders.write"), true);
  assert.equal(telegramRoleCan("support", "orders.read"), true);
  assert.equal(telegramRoleCan("support", "orders.write"), false);
  assert.equal(telegramRoleCan("admin", "backup.create"), false);
  assert.equal(telegramRoleCan("owner", "backup.create"), true);
});

test("callbacks, commands and forced replies are classified before execution", () => {
  assert.equal(telegramCallbackPermission("analytics:csv:7"), "analytics.export");
  assert.equal(telegramCallbackPermission("order:paid_confirm:SIM-1"), "orders.write");
  assert.equal(telegramCallbackPermission("customer:view:id"), "customers.read");
  assert.equal(telegramCallbackPermission("product:update:1"), "catalog.write");
  assert.equal(telegramCallbackPermission("promocodes:toggle:id"), "promocodes.write");
  assert.equal(telegramCallbackPermission("partners:toggle:id"), "partners.write");
  assert.equal(telegramCallbackPermission("partners:analytics"), "partners.read");
  assert.equal(telegramCallbackPermission("analytics:cost_create"), "marketing_costs.write");
  assert.equal(telegramCommandPermission("/category_delete"), "catalog.write");
  assert.equal(telegramCommandPermission("/orders"), "orders.read");
  assert.equal(telegramReplyPermission("[FULFILL_ESIM:00000000-0000-4000-8000-000000000000]"), "orders.write");
  assert.equal(telegramReplyPermission("[EDIT_CUSTOMER:00000000-0000-4000-8000-000000000000:email]"), "customers.write");
  assert.equal(telegramReplyPermission("[CREATE_PROMO]"), "promocodes.write");
  assert.equal(telegramReplyPermission("[CREATE_PARTNER]"), "partners.write");
  assert.equal(telegramReplyPermission("[CREATE_MARKETING_COST]"), "marketing_costs.write");
  assert.equal(telegramReplyPermission("[ANALYTICS_RANGE]"), "analytics.read");
});
