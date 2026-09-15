import { NextResponse } from "next/server";

/**
 * Vinext's Render server does not always apply next.config.headers(). Keep the
 * browser security policy at the request boundary so it is present on both
 * document and API responses.
 */
export function proxy() {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  response.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}
