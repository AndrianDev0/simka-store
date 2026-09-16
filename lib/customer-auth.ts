import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { customerAccounts, customerPasswordResets, customerSessions } from "@/db/schema";
import { getDb } from "@/db";
import { sameRequestOrigin } from "@/lib/request-security";

export { hashPassword, passwordHashNeedsUpgrade, validatePassword, verifyPassword, verifyPasswordWithFallback } from "@/lib/passwords";

export const CUSTOMER_SESSION_COOKIE = "simka_customer_session";
export const CUSTOMER_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export type CustomerAccount = {
  id: string;
  email: string;
  name: string;
  contact: string;
  partnerCode: string | null;
};

function base64Url(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

export function newOpaqueToken() {
  return base64Url(randomBytes(32));
}

export function sameOrigin(request: Request) {
  return sameRequestOrigin(request);
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
    partnerCode: customerAccounts.partnerCode,
  }).from(customerSessions).innerJoin(customerAccounts, eq(customerSessions.accountId, customerAccounts.id)).where(and(eq(customerSessions.tokenHash, hashToken(token)), gt(customerSessions.expiresAt, new Date().toISOString()), eq(customerAccounts.isBlocked, false))).limit(1);
  if (!row) {
    return null;
  }
  const account = { id: row.id, email: row.email, name: row.name, contact: row.contact, partnerCode: row.partnerCode };
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
