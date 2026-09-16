export type OperationalEvent = {
  kind: string;
  severity: "warning" | "error" | "critical";
  area: string;
  path?: string;
  code?: string;
};

export type NormalizedOperationalEvent = Required<OperationalEvent>;

function safeToken(value: string | undefined, fallback: string, maxLength: number) {
  const normalized = (value || fallback).trim().replace(/[^a-zA-Z0-9_.:-]+/g, "_");
  return (normalized || fallback).slice(0, maxLength);
}

function safePath(value: string | undefined) {
  const path = (value || "/").split(/[?#]/, 1)[0];
  return (path.startsWith("/") ? path : "/").slice(0, 500);
}

export function normalizeOperationalEvent(event: OperationalEvent): NormalizedOperationalEvent {
  return {
    kind: safeToken(event.kind, "unknown", 80),
    severity: event.severity,
    area: safeToken(event.area, "unknown", 80),
    path: safePath(event.path),
    code: safeToken(event.code, "unknown", 128),
  };
}
