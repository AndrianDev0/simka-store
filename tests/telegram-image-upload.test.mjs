import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  managedCatalogImagePath,
  MAX_TELEGRAM_CATALOG_IMAGE_BYTES,
  removeManagedCatalogImage,
  storeTelegramCatalogImage,
  optimizeCatalogImage,
  MAX_OPTIMIZED_IMAGE_BYTES,
} from "../lib/telegram-image-upload.ts";

const png = await sharp({ create: { width: 2400, height: 1600, channels: 4, background: { r: 35, g: 100, b: 170, alpha: 0.5 } } }).png().toBuffer();

function telegramFetch(bytes = png) {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/getFile")) return Response.json({ ok: true, result: { file_path: "photos/catalog.png" } });
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength) } });
  };
}

test("Telegram image is sniffed, stored under a content hash and removable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "simka-image-"));
  try {
    const result = await storeTelegramCatalogImage({
      token: "test-token",
      attachment: { fileId: "telegram-file", fileSize: png.byteLength, mimeType: "image/png" },
      fetchImpl: telegramFetch(),
      directory,
    });
    assert.match(result.url, /^\/uploads\/catalog\/[a-f0-9]{32}\.webp$/);
    assert.equal(result.mimeType, "image/webp");
    const filePath = managedCatalogImagePath(result.url, directory);
    assert.ok(filePath);
    const stored = await readFile(filePath);
    const metadata = await sharp(stored).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 800);
    assert.equal(metadata.hasAlpha, true);
    assert.ok(stored.length <= MAX_OPTIMIZED_IMAGE_BYTES);
    assert.equal(metadata.exif, undefined);
    assert.equal(await removeManagedCatalogImage(result.url, directory), true);
    assert.equal(await removeManagedCatalogImage(result.url, directory), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("optimization rejects corrupt images with valid magic bytes", async () => {
  await assert.rejects(() => optimizeCatalogImage(png.subarray(0, 12)), /TELEGRAM_IMAGE_UNSUPPORTED/);
});

test("optimization does not enlarge small images and applies EXIF orientation", async () => {
  const jpeg = await sharp({ create: { width: 60, height: 30, channels: 3, background: 'red' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const output = await optimizeCatalogImage(jpeg);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 30);
  assert.equal(metadata.height, 60);
  assert.equal(metadata.exif, undefined);
});

test("Telegram image upload rejects unsupported bytes and oversized declarations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "simka-image-"));
  try {
    await assert.rejects(() => storeTelegramCatalogImage({
      token: "test-token",
      attachment: { fileId: "telegram-file", mimeType: "image/png" },
      fetchImpl: telegramFetch(Uint8Array.from([1, 2, 3, 4])),
      directory,
    }), /TELEGRAM_IMAGE_UNSUPPORTED/);
    await assert.rejects(() => storeTelegramCatalogImage({
      token: "test-token",
      attachment: { fileId: "telegram-file", fileSize: MAX_TELEGRAM_CATALOG_IMAGE_BYTES + 1, mimeType: "image/jpeg" },
      fetchImpl: telegramFetch(),
      directory,
    }), /TELEGRAM_IMAGE_TOO_LARGE/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only managed catalog URLs map to the upload directory", () => {
  assert.equal(managedCatalogImagePath("https://example.com/image.jpg", "C:/tmp"), null);
  assert.equal(managedCatalogImagePath("/uploads/catalog/../../secret.jpg", "C:/tmp"), null);
  assert.match(managedCatalogImagePath(`/uploads/catalog/${"a".repeat(32)}.webp`, "C:/tmp"), /[\\/]a{32}\.webp$/);
});
