import assert from "node:assert/strict";
import test from "node:test";
import { splitTelegramText } from "../lib/telegram-text.ts";

test("long reports preserve all text within Telegram limits", () => {
  for (const text of ["Товар\n".repeat(2000), "x".repeat(12000), "📦".repeat(6000), "x".repeat(3899) + "📦" + "y".repeat(4000)]) {
    const chunks = splitTelegramText(text);
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 3900));
    assert.ok(chunks.every((chunk) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk)));
  }
});
