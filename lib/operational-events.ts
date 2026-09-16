import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { operationalEvents } from "@/db/schema";

export type OperationalEvent = {
  kind: string;
  severity: "warning" | "error" | "critical";
  area: string;
  path?: string;
  code?: string;
};

function safeToken(value: string | undefined, fallback: string, maxLength: number) {
  const normalized = (value || fallback).trim().replace(/[^a-zA-Z0-9_.:-]+/g, "_");
  return (normalized || fallback).slice(0, maxLength);
}

function safePath(value: string | undefined) {
  const path = (value || "/").split(/[?#]/, 1)[0];
  return (path.startsWith("/") ? path : "/").slice(0, 500);
}

export async function recordOperationalEvent(event: OperationalEvent) {
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const kind = safeToken(event.kind, "unknown", 80);
  const area = safeToken(event.area, "unknown", 80);
  const path = safePath(event.path);
  const code = safeToken(event.code, "unknown", 128);
  const id = createHash("sha256").update(`${day}|${kind}|${event.severity}|${area}|${path}|${code}`).digest("hex");
  try {
    await getDb().insert(operationalEvents).values({ id, kind, severity: event.severity, area, path, code, count: 1, firstSeenAt: now, lastSeenAt: now }).onConflictDoUpdate({
      target: operationalEvents.id,
      set: { count: sql`${operationalEvents.count} + 1`, lastSeenAt: now },
    });
  } catch (error) {
    console.warn("operational_event_record_failed", { name: error instanceof Error ? error.name : "UnknownError" });
  }
}
