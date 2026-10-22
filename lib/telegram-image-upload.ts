import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_TELEGRAM_CATALOG_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_OPTIMIZED_IMAGE_BYTES = 200 * 1024;

export async function optimizeCatalogImage(input: Uint8Array) {
  try {
    for (const [size, quality] of [[1200, 76], [960, 70], [800, 64]]) {
      const bytes = await sharp(input, { limitInputPixels: 24_000_000, failOn: "warning" })
        .rotate()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .timeout({ seconds: 8 })
        .toBuffer();
      if (bytes.length <= MAX_OPTIMIZED_IMAGE_BYTES) return bytes;
    }
  } catch {
    throw new Error("TELEGRAM_IMAGE_UNSUPPORTED");
  }
  throw new Error("TELEGRAM_IMAGE_OPTIMIZATION_FAILED");
}

export type TelegramImageAttachment = {
  fileId: string;
  fileSize?: number;
  mimeType?: string;
  caption?: string;
};

type TelegramFileResponse = {
  ok?: boolean;
  result?: { file_path?: string };
};

function uploadDirectory(override?: string) {
  return override ?? process.env.CATALOG_UPLOAD_DIR ?? "/app/public/uploads/catalog";
}

function detectImage(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
    return { extension: "webp", mimeType: "image/webp" };
  }
  return null;
}

async function readLimited(response: Response, maximum: number) {
  if (!response.body) throw new Error("TELEGRAM_IMAGE_EMPTY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error("TELEGRAM_IMAGE_TOO_LARGE");
    }
    chunks.push(result.value);
  }
  if (total === 0) throw new Error("TELEGRAM_IMAGE_EMPTY");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function storeTelegramCatalogImage({
  token,
  attachment,
  fetchImpl = fetch,
  directory,
}: {
  token: string;
  attachment: TelegramImageAttachment;
  fetchImpl?: typeof fetch;
  directory?: string;
}) {
  if (!attachment.fileId || attachment.fileId.length > 512) throw new Error("TELEGRAM_IMAGE_INVALID");
  if (attachment.fileSize !== undefined && attachment.fileSize > MAX_TELEGRAM_CATALOG_IMAGE_BYTES) throw new Error("TELEGRAM_IMAGE_TOO_LARGE");
  if (attachment.mimeType && !["image/jpeg", "image/png", "image/webp", "application/octet-stream"].includes(attachment.mimeType)) {
    throw new Error("TELEGRAM_IMAGE_UNSUPPORTED");
  }

  const fileResponse = await fetchImpl(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: attachment.fileId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!fileResponse.ok) throw new Error("TELEGRAM_IMAGE_LOOKUP_FAILED");
  const payload = await fileResponse.json() as TelegramFileResponse;
  const filePath = payload.ok ? payload.result?.file_path : undefined;
  if (!filePath || filePath.length > 512 || filePath.includes("..") || filePath.includes("\\") || !/^[A-Za-z0-9_./-]+$/.test(filePath)) {
    throw new Error("TELEGRAM_IMAGE_PATH_INVALID");
  }

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const downloadResponse = await fetchImpl(`https://api.telegram.org/file/bot${token}/${encodedPath}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!downloadResponse.ok) throw new Error("TELEGRAM_IMAGE_DOWNLOAD_FAILED");
  const declaredLength = Number(downloadResponse.headers.get("content-length") || 0);
  if (declaredLength > MAX_TELEGRAM_CATALOG_IMAGE_BYTES) throw new Error("TELEGRAM_IMAGE_TOO_LARGE");
  const original = await readLimited(downloadResponse, MAX_TELEGRAM_CATALOG_IMAGE_BYTES);
  const detected = detectImage(original);
  if (!detected) throw new Error("TELEGRAM_IMAGE_UNSUPPORTED");
  const bytes = await optimizeCatalogImage(original);

  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const filename = `${digest}.webp`;
  const targetDirectory = uploadDirectory(directory);
  await mkdir(targetDirectory, { recursive: true, mode: 0o755 });
  try {
    await writeFile(path.join(/* turbopackIgnore: true */ targetDirectory, filename), bytes, { flag: "wx", mode: 0o644 });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
  }
  return {
    url: `/uploads/catalog/${filename}`,
    mimeType: "image/webp",
    size: bytes.byteLength,
  };
}

export function managedCatalogImagePath(url: string, directory?: string) {
  const match = url.match(/^\/uploads\/catalog\/([a-f0-9]{32}\.(?:jpg|png|webp))$/);
  return match ? path.join(/* turbopackIgnore: true */ uploadDirectory(directory), match[1]) : null;
}

export async function removeManagedCatalogImage(url: string, directory?: string) {
  const filePath = managedCatalogImagePath(url, directory);
  if (!filePath) return false;
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
