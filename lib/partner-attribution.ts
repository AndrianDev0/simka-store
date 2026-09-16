import { createHmac, timingSafeEqual } from "node:crypto";

export const PARTNER_COOKIE = "simka_partner";
export const PARTNER_VISITOR_COOKIE = "simka_partner_visitor";
export const PARTNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function normalizePartnerCode(value: string) {
  return value.trim().toUpperCase();
}

export function isValidPartnerCode(value: string) {
  return /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(normalizePartnerCode(value));
}

function signingSecret() {
  const configured = process.env.PARTNER_ATTRIBUTION_SECRET?.trim() || process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("PARTNER_ATTRIBUTION_SECRET_NOT_CONFIGURED");
  return "simka-development-partner-attribution-secret";
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret()).update(`partner-attribution:${payload}`).digest("base64url");
}

export function createPartnerCookie(code: string, issuedAt = Date.now()) {
  const payload = `${normalizePartnerCode(code)}.${Math.floor(issuedAt / 1000)}`;
  return `${payload}.${signature(payload)}`;
}

export function readPartnerCookie(value: string | undefined, now = Date.now()) {
  if (!value) return null;
  const [code, rawIssuedAt, receivedSignature, ...rest] = value.split(".");
  if (rest.length || !isValidPartnerCode(code || "") || !/^\d{10}$/.test(rawIssuedAt || "") || !receivedSignature) return null;
  const payload = `${code}.${rawIssuedAt}`;
  const expected = Buffer.from(signature(payload));
  const received = Buffer.from(receivedSignature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  const ageMs = now - Number(rawIssuedAt) * 1000;
  if (ageMs < -60_000 || ageMs > PARTNER_COOKIE_MAX_AGE * 1000) return null;
  return code;
}

export function cookieValue(request: Request, name: string) {
  const raw = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw) return undefined;
  try { return decodeURIComponent(raw); } catch { return undefined; }
}

export function partnerCodeFromRequest(request: Request) {
  return readPartnerCookie(cookieValue(request, PARTNER_COOKIE));
}

export function partnerCommission(amount: number, commissionBps: number) {
  return Math.round(amount * commissionBps / 10_000);
}
