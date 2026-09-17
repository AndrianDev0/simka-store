export const telegramRoles = ["owner", "admin", "analyst", "marketing", "sales", "support"] as const;

export type TelegramRole = (typeof telegramRoles)[number];

export type TelegramPermission =
  | "catalog.read"
  | "catalog.write"
  | "orders.read"
  | "orders.write"
  | "customers.read"
  | "customers.write"
  | "customers.export"
  | "customers.delete"
  | "analytics.read"
  | "analytics.export"
  | "marketing_costs.write"
  | "promocodes.read"
  | "promocodes.write"
  | "partners.read"
  | "partners.write"
  | "settings.read"
  | "settings.write"
  | "operations.read"
  | "audit.read"
  | "backup.create";

const allPermissions: TelegramPermission[] = [
  "catalog.read", "catalog.write", "orders.read", "orders.write", "customers.read", "customers.write",
  "customers.export", "customers.delete", "analytics.read", "analytics.export", "marketing_costs.write", "promocodes.read", "promocodes.write", "partners.read", "partners.write", "settings.read", "settings.write",
  "operations.read", "audit.read", "backup.create",
];

const permissionsByRole: Record<TelegramRole, ReadonlySet<TelegramPermission>> = {
  owner: new Set(allPermissions),
  admin: new Set(allPermissions.filter((permission) => permission !== "backup.create")),
  analyst: new Set(["analytics.read", "analytics.export", "promocodes.read", "partners.read", "operations.read"]),
  marketing: new Set(["analytics.read", "analytics.export", "marketing_costs.write", "promocodes.read", "promocodes.write", "partners.read", "partners.write"]),
  sales: new Set(["orders.read", "orders.write", "customers.read", "analytics.read", "partners.read"]),
  support: new Set(["orders.read", "customers.read"]),
};

export const telegramRoleLabels: Record<TelegramRole, string> = {
  owner: "Owner",
  admin: "Admin",
  analyst: "Analyst",
  marketing: "Marketing",
  sales: "Sales",
  support: "Support",
};

function isTelegramRole(value: string): value is TelegramRole {
  return (telegramRoles as readonly string[]).includes(value);
}

export function parseTelegramAdminIds(value: string | undefined) {
  return (value || "").split(",").map((id) => id.trim()).filter((id) => /^\d+$/.test(id));
}

export function parseTelegramRoleAssignments(value: string | undefined) {
  const assignments = new Map<string, TelegramRole>();
  for (const entry of (value || "").split(/[;,\n]+/)) {
    const [rawId, rawRole, ...rest] = entry.trim().split(":");
    const id = rawId?.trim();
    const role = rawRole?.trim().toLowerCase();
    if (!id || rest.length || !/^\d+$/.test(id) || !role || !isTelegramRole(role)) continue;
    assignments.set(id, role);
  }
  return assignments;
}

export function resolveTelegramRole(adminId: string | number, adminIdsValue: string | undefined, assignmentsValue: string | undefined): TelegramRole | null {
  const id = String(adminId);
  const allowedIds = parseTelegramAdminIds(adminIdsValue);
  if (!allowedIds.includes(id)) return null;
  const assignments = parseTelegramRoleAssignments(assignmentsValue);
  const hasExplicitOwner = allowedIds.some((allowedId) => assignments.get(allowedId) === "owner");
  if (allowedIds[0] === id && !hasExplicitOwner) return "owner";
  const assigned = assignments.get(id);
  if (assigned) return assigned;
  return allowedIds[0] === id ? "owner" : "admin";
}

export function telegramRoleCan(role: TelegramRole, permission: TelegramPermission) {
  return permissionsByRole[role].has(permission);
}

function catalogCallbackPermission(scope: string, action: string): TelegramPermission | null {
  const catalogScopes = new Set(["products", "product", "variants", "variant", "images", "image", "countries", "country", "operators", "operator", "categories", "category", "delivery", "pc", "cp", "ca"]);
  if (!catalogScopes.has(scope)) return null;
  const readActions = new Set(["list", "view", "variants", "images", "categories", "delivery"]);
  return readActions.has(action) ? "catalog.read" : "catalog.write";
}

export function telegramCallbackPermission(data: string): TelegramPermission | null {
  if (data === "menu") return null;
  if (data === "status") return "operations.read";
  const [scope = "", action = ""] = data.split(":");
  const catalogPermission = catalogCallbackPermission(scope, action);
  if (catalogPermission) return catalogPermission;
  if (scope === "analytics") return ["cost_create", "cost_del_ask", "cost_del"].includes(action) ? "marketing_costs.write" : action === "csv" ? "analytics.export" : "analytics.read";
  if (scope === "promocodes") return ["create", "toggle"].includes(action) ? "promocodes.write" : "promocodes.read";
  if (scope === "partners") return ["create", "toggle"].includes(action) ? "partners.write" : "partners.read";
  if (scope === "errors") return "operations.read";
  if (scope === "audit") return "audit.read";
  if (scope === "backup") return "backup.create";
  if (scope === "settings") return ["payment_edit", "email_test"].includes(action) ? "settings.write" : "settings.read";
  if (scope === "orders") return "orders.read";
  if (scope === "order") return action === "view" ? "orders.read" : "orders.write";
  if (scope === "fulfill") return "orders.write";
  if (scope === "customers") return "customers.read";
  if (scope === "customer") {
    if (action === "view") return "customers.read";
    if (action === "export") return "customers.export";
    if (["delete_prompt", "delete_confirm"].includes(action)) return "customers.delete";
    return "customers.write";
  }
  return "settings.write";
}

export function telegramCommandPermission(command: string): TelegramPermission | null {
  if (["/start", "/help"].includes(command)) return null;
  if (["/products", "/countries", "/operators", "/categories"].includes(command)) return "catalog.read";
  if (command.startsWith("/category_")) return "catalog.write";
  if (["/payment_requisites", "/email"].includes(command)) return "settings.read";
  if (["/orders"].includes(command)) return "orders.read";
  if (["/paid"].includes(command)) return "orders.write";
  if (["/customers"].includes(command)) return "customers.read";
  if (["/analytics"].includes(command)) return "analytics.read";
  if (["/promocodes"].includes(command)) return "promocodes.read";
  if (["/partners"].includes(command)) return "partners.read";
  if (["/status", "/errors"].includes(command)) return "operations.read";
  if (command === "/audit") return "audit.read";
  if (command === "/backup") return "backup.create";
  return null;
}

export function telegramReplyPermission(replyContext: string): TelegramPermission | null {
  if (!replyContext) return null;
  if (replyContext.startsWith("[ANALYTICS_RANGE]")) return "analytics.read";
  if (replyContext.startsWith("[ANALYTICS_REVENUE_RANGE]")) return "analytics.read";
  if (replyContext.startsWith("[ANALYTICS_TRAFFIC_RANGE]")) return "analytics.read";
  if (replyContext.startsWith("[ANALYTICS_ATTRIBUTION_RANGE:")) return "analytics.read";
  if (replyContext.startsWith("[FIND_ORDER]")) return "orders.read";
  if (replyContext.startsWith("[FIND_CUSTOMER]")) return "customers.read";
  if (/^\[(?:BLOCK_CUSTOMER|EDIT_CUSTOMER):/i.test(replyContext)) return "customers.write";
  if (replyContext.startsWith("[TEST_EMAIL]")) return "settings.write";
  if (replyContext.startsWith("[EDIT_PAYMENT_REQUISITES]")) return "settings.write";
  if (/^\[(?:DELIVERY_COST|ORDER_EXPENSES|FULFILL_ESIM|SHIP_ITEM):/i.test(replyContext)) return "orders.write";
  if (replyContext.startsWith("[CREATE_PROMO]")) return "promocodes.write";
  if (replyContext.startsWith("[CREATE_PARTNER]")) return "partners.write";
  if (replyContext.startsWith("[CREATE_MARKETING_COST]")) return "marketing_costs.write";
  if (/^\[(?:CREATE_|EDIT_)/i.test(replyContext)) return "catalog.write";
  return null;
}
