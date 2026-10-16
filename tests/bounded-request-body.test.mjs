import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../lib/bounded-request-body.ts";

test("webhook body limit counts UTF-8 bytes across chunk boundaries", async () => {
  const bytes = new TextEncoder().encode('{"name":"Тест"}');
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 10));
    controller.enqueue(bytes.slice(10));
    controller.close();
  } });
  const request = new Request("https://shop.example/webhook", { method: "POST", body: stream, duplex: "half" });
  assert.equal(await readBoundedRequestText(request, bytes.length), '{"name":"Тест"}');
});

test("oversized chunked body is cancelled even without content-length", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
  const request = new Request("https://shop.example/webhook", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(readBoundedRequestText(request, 10), RequestBodyTooLargeError);
  assert.equal(cancelled, true);
});

test("a false short content-length does not bypass the byte limit", async () => {
  const request = new Request("https://shop.example/webhook", { method: "POST", body: "12345678901", headers: { "content-length": "1" } });
  await assert.rejects(readBoundedRequestText(request, 10), RequestBodyTooLargeError);
});

test("declared oversized body is rejected before reading", async () => {
  const request = new Request("https://shop.example/webhook", { method: "POST", body: "{}", headers: { "content-length": "100001" } });
  await assert.rejects(readBoundedRequestText(request, 100000), RequestBodyTooLargeError);
  assert.equal(request.bodyUsed, false);
});
