type ClientTechnicalEvent = {
  kind: "page_error" | "page_not_found" | "window_error" | "unhandled_rejection";
  area: "page" | "window";
};

export function reportTechnicalEvent(event: ClientTechnicalEvent) {
  if (typeof window === "undefined") return;
  const path = window.location.pathname.slice(0, 500);
  void fetch("/api/telemetry/error", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...event, path }),
  }).catch(() => undefined);
}
