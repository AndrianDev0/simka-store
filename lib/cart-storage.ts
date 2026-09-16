const CART_VERSION = 1;
const MAX_LINES = 30;
const MAX_QUANTITY = 20;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type StoredCart = {
  version: typeof CART_VERSION;
  updatedAt: number;
  items: Array<{ key: string; quantity: number }>;
};

function validKey(key: string) {
  const match = key.match(/^(\d+):(\d+)$/);
  return Boolean(match && Number(match[1]) > 0 && Number(match[2]) >= 0);
}

export function parseStoredCart(value: string | null, now = Date.now()): Record<string, number> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Partial<StoredCart>;
    if (parsed.version !== CART_VERSION || !Number.isFinite(parsed.updatedAt) || !Array.isArray(parsed.items)) return {};
    if (now - Number(parsed.updatedAt) > MAX_AGE_MS || Number(parsed.updatedAt) > now + 60_000) return {};
    const result: Record<string, number> = {};
    for (const item of parsed.items.slice(0, MAX_LINES)) {
      if (!item || typeof item.key !== "string" || !validKey(item.key)) continue;
      if (!Number.isInteger(item.quantity) || item.quantity < 1) continue;
      result[item.key] = Math.min(MAX_QUANTITY, item.quantity);
    }
    return result;
  } catch {
    return {};
  }
}

export function serializeCart(cart: Record<string, number>, now = Date.now()) {
  const items = Object.entries(cart)
    .filter(([key, quantity]) => validKey(key) && Number.isInteger(quantity) && quantity > 0)
    .slice(0, MAX_LINES)
    .map(([key, quantity]) => ({ key, quantity: Math.min(MAX_QUANTITY, quantity) }));
  return JSON.stringify({ version: CART_VERSION, updatedAt: now, items } satisfies StoredCart);
}
