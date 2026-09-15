import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { seoRedirects } from "@/db/schema";

export type RedirectEntity = "category" | "country" | "product";

export async function recordSlugRedirect(entityType: RedirectEntity, entityId: string, oldSlug: string, newSlug: string) {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;
  try {
    const db = getDb();
    await db.update(seoRedirects).set({ newSlug }).where(and(eq(seoRedirects.entityType, entityType), eq(seoRedirects.entityId, entityId)));
    await db.insert(seoRedirects).values({ entityType, entityId, oldSlug, newSlug }).onConflictDoUpdate({
      target: [seoRedirects.entityType, seoRedirects.oldSlug],
      set: { entityId, newSlug },
    });
  } catch (error) {
    console.error("seo_slug_redirect_record_failed", { entityType, name: error instanceof Error ? error.name : "UnknownError" });
  }
}

export async function getSlugRedirect(entityType: RedirectEntity, oldSlug: string) {
  try {
    const db = getDb();
    const [redirect] = await db.select({ newSlug: seoRedirects.newSlug }).from(seoRedirects).where(and(eq(seoRedirects.entityType, entityType), eq(seoRedirects.oldSlug, oldSlug))).limit(1);
    return redirect?.newSlug ?? null;
  } catch {
    return null;
  }
}
