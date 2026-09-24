export const PAGES_ORIGIN = "https://andriandev0.github.io";

export function pagesCors(response: Response, request: Request) {
  if (request.headers.get("origin") !== PAGES_ORIGIN) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", PAGES_ORIGIN);
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function pagesPreflight(request: Request) {
  if (request.headers.get("origin") !== PAGES_ORIGIN) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": PAGES_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  } });
}
