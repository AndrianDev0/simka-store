import { createHmac, randomBytes } from "node:crypto";

const processFallbackSecret = randomBytes(32).toString("base64url");

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || "unknown";
}

export function requestNetworkIdentity(request: Request) {
  const cloudflare = firstHeaderValue(request.headers.get("cf-connecting-ip"));
  if (cloudflare !== "unknown") return cloudflare;
  const forwarded = firstHeaderValue(request.headers.get("x-forwarded-for"));
  if (forwarded !== "unknown") return forwarded;
  return firstHeaderValue(request.headers.get("x-real-ip"));
}

function rateLimitSecret() {
  return process.env.RATE_LIMIT_SECRET?.trim()
    || process.env.FULFILLMENT_ENCRYPTION_KEY?.trim()
    || process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
    || processFallbackSecret;
}

export function rateLimitSubjectHash(request: Request, action: string, subject = "") {
  return createHmac("sha256", rateLimitSecret())
    .update(`${action}\n${requestNetworkIdentity(request)}\n${subject.trim().toLowerCase()}`)
    .digest("base64url");
}

export function contentLengthWithin(request: Request, maximumBytes: number) {
  const value = request.headers.get("content-length");
  if (!value) return true;
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 && size <= maximumBytes;
}

export function sameRequestOrigin(request: Request) {
  const origin = request.headers.get("origin") || request.headers.get("referer");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    if (originUrl.origin === requestUrl.origin) return true;
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = (forwardedHost || request.headers.get("host") || "").toLowerCase();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = (forwardedProto || requestUrl.protocol.slice(0, -1)).toLowerCase();
    return Boolean(host) && originUrl.host.toLowerCase() === host && originUrl.protocol.toLowerCase() === `${protocol}:`;
  } catch {
    return false;
  }
}
