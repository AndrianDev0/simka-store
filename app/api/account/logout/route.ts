import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CUSTOMER_SESSION_COOKIE, clearSessionCookie, destroySession, sameOrigin } from "@/lib/customer-auth";
import { absoluteUrl } from "@/lib/seo";
import { consumeRateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const rateLimit = await consumeRateLimit({ request, action: "account-logout", limit: 20, windowMs: 15 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);
  const cookieStore = await cookies();
  await destroySession(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value);
  const response = NextResponse.redirect(absoluteUrl("/"), 303);
  clearSessionCookie(response);
  return response;
}
