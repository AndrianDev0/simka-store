import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CUSTOMER_SESSION_COOKIE, clearSessionCookie, destroySession, sameOrigin } from "@/lib/customer-auth";
import { absoluteUrl } from "@/lib/seo";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const cookieStore = await cookies();
  await destroySession(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value);
  const response = NextResponse.redirect(absoluteUrl("/"), 303);
  clearSessionCookie(response);
  return response;
}
