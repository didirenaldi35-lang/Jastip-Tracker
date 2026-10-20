import test from "node:test";
import assert from "node:assert/strict";
import { num, numId, numIdOrNull, numOrNull, idrIn, safeUrl, idr, esc } from "../src/lib/format.js";

test("num keeps decimals (kg, yuan)", () => {
  assert.equal(num("1.5"), 1.5);
  assert.equal(num("12,5"), 12.5);
  assert.equal(num("1.500"), 1.5);
  assert.equal(num(""), 0);
  assert.equal(num("abc"), 0);
});
test("numId reads Rupiah thousands separators", () => {
  assert.equal(numId("250.000"), 250000);
  assert.equal(numId("1.500.000"), 1500000);
  assert.equal(numId("1,500,000"), 1500000);
  assert.equal(numId("Rp 2.720"), 2720);
  assert.equal(numId("2720"), 2720);
  assert.equal(numId("2720,5"), 2720.5);
});
test("numIdOrNull / numOrNull", () => {
  assert.equal(numIdOrNull(""), null);
  assert.equal(numIdOrNull("abc"), null);
  assert.equal(numIdOrNull("3.185"), 3185);
  assert.equal(numOrNull(""), null);
  assert.equal(numOrNull("4,5"), 4.5);
});
test("idrIn rounds for input fields", () => {
  assert.equal(idrIn(3185.4), "3185");
  assert.equal(idrIn(null), "");
});
test("safeUrl blocks javascript: and adds https", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("item.taobao.com/x"), "https://item.taobao.com/x");
  assert.equal(safeUrl("https://a.b/c"), "https://a.b/c");
  assert.equal(safeUrl(""), "");
});
test("idr formats with Rp and minus", () => {
  assert.match(idr(1500000), /^Rp 1\.500\.000$/);
  assert.match(idr(-2500), /^−Rp 2\.500$/);
  assert.equal(idr(null), "—");
});
test("esc escapes html", () => {
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});
