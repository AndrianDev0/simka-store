import { readFile } from "node:fs/promises";

import { managedCatalogImagePath } from "@/lib/telegram-image-upload";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const filePath = managedCatalogImagePath(`/uploads/catalog/${filename}`);
  if (!filePath) return new Response("Not found", { status: 404 });

  try {
    const bytes = await readFile(/* turbopackIgnore: true */ filePath);
    const extension = filename.slice(filename.lastIndexOf(".") + 1);
    return new Response(bytes, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }
}
