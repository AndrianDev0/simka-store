import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { customerAccounts, customerPasswordResets, customerSessions } from "@/db/schema";
import { getDb } from "@/db";

export const CUSTOMER_SESSION_COOKIE = "simka_customer_session";
export const CUSTOMER_SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 120_000;
const encoder = new TextEncoder();

export type CustomerAccount = {
  id: string;
  email: string;
  name: string;
  contact: string;
};

function base64Url(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

async function derivePassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: PASSWORD_ITERATIONS, hash: "SHA-256" }, key, 256);
  return base64Url(new Uint8Array(bits));
}

export async function hashPassword(password: string) {
  const salt = base64Url(randomBytes(16));
  return `v1.${salt}.${await derivePassword(password, salt)}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [version, salt, expected] = storedHash.split(".");
  if (version !== "v1" || !salt || !expected) return false;
  const actual = await derivePassword(password, salt);
  const expectedBytes = Buffer.from(expected, "base64url");
  const actualBytes = Buffer.from(actual, "base64url");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function newOpaqueToken() {
  return base64Url(randomBytes(32));
}

export function validatePassword(password: string) {
  return password.length >= 8 && password.length <= 200;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
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

export async function getCurrentAccount(): Promise<CustomerAccount | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const [row] = await db.select({
    sessionId: customerSessions.id,
    id: customerAccounts.id,
    email: customerAccounts.email,
    name: customerAccounts.name,
    contact: customerAccounts.contact,
  }).from(customerSessions).innerJoin(customerAccounts, eq(customerSessions.accountId, customerAccounts.id)).where(and(eq(customerSessions.tokenHash, hashToken(token)), gt(customerSessions.expiresAt, new Date().toISOString()))).limit(1);
  if (!row) {
    return null;
  }
  const account = { id: row.id, email: row.email, name: row.name, contact: row.contact };
  await db.update(customerSessions).set({ lastUsedAt: new Date().toISOString() }).where(eq(customerSessions.id, row.sessionId));
  return account;
}

export async function createSession(accountId: string) {
  const token = newOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CUSTOMER_SESSION_MAX_AGE * 1000).toISOString();
  await getDb().insert(customerSessions).values({ id: randomUUID(), accountId, tokenHash: hashToken(token), expiresAt, createdAt: now.toISOString(), lastUsedAt: now.toISOString() });
  return token;
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await getDb().delete(customerSessions).where(eq(customerSessions.tokenHash, hashToken(token)));
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(CUSTOMER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function createPasswordResetToken(accountId: string) {
  const token = newOpaqueToken();
  const now = new Date();
  await getDb().delete(customerPasswordResets).where(eq(customerPasswordResets.accountId, accountId));
  await getDb().insert(customerPasswordResets).values({ id: randomUUID(), accountId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(), createdAt: now.toISOString() });
  return token;
}

export async function findPasswordReset(token: string) {
  if (!token || token.length > 200) return null;
  const [row] = await getDb().select({ id: customerPasswordResets.id, accountId: customerPasswordResets.accountId }).from(customerPasswordResets).where(and(eq(customerPasswordResets.tokenHash, hashToken(token)), gt(customerPasswordResets.expiresAt, new Date().toISOString()))).limit(1);
  return row ?? null;
}
