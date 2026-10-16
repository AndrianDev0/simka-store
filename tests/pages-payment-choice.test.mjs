import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../docs/site.js", import.meta.url), "utf8");
const renderSource = source.slice(source.indexOf("  function renderCheckout("), source.indexOf("  async function submitOrder("));
const lines = [{ product: { id: 1, type: "eSIM" }, price: 100, quantity: 1, currency: "RUB" }];
const manager = { id: "manager", label: "Через менеджера", description: "Реквизиты после оформления" };
const crypto = { id: "crypto", label: "Криптовалютой", description: "Оплата у провайдера" };

function checkout(methods) {
  const context = vm.createContext({
    state: { orderingEnabled: true, paymentMethods: methods, emailConfigured: false, busy: false, error: "" },
    cartBody: { innerHTML: "" },
    escape: (v) => String(v).replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    money: (amount) => `${amount} RUB`, lines,
  });
  vm.runInContext(`${renderSource}\nrenderCheckout(lines);`, context);
  return context.cartBody.innerHTML;
}

test("checkout offers crypto only when the server enables it", () => {
  assert.doesNotMatch(checkout([manager]), /value="crypto"/);
  const enabled = checkout([manager, crypto]);
  assert.match(enabled, /name="paymentMethod" value="crypto"/);
  assert.match(enabled, /name="paymentMethod" value="manager" checked/);
  assert.match(enabled, /Отправка писем сейчас недоступна/);
});

test("payment method descriptions cannot inject HTML into checkout", () => {
  const html = checkout([{ ...crypto, description: '<img src=x onerror="alert(1)">' }]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
