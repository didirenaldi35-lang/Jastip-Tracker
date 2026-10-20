import test from "node:test";
import assert from "node:assert/strict";
import { buildCfg, itemShip, goodsCNY, deriveData, shipQuote } from "../src/lib/calc.js";

const c = buildCfg({ kursEveDidi: 2700, clients: [{ name: "Own shop", internal: true }] });

test("buildCfg fills defaults and legacy air rate", () => {
  assert.equal(c.kursEveDidi, 2700);
  assert.equal(c.shipRates.air.divisor, 6000);
  assert.equal(buildCfg({ airPerKgCNY: 95 }).shipRates.air.perKgCNY, 95);
  assert.equal(buildCfg(null).kursEveDidi, 2720);
});
test("goodsCNY = qty x price + extra", () => {
  assert.equal(goodsCNY({ qty: 10, priceCNY: 12.5, extraCNY: 5 }), 130);
});
test("ongkir typed in yuan is converted with the line's kurs", () => {
  const e = itemShip({ qty: 10, shipCur: "CNY", shipTotalCNY: 100, rate: 2800 }, c);
  assert.equal(e.total, 280000);
  assert.equal(e.perPc, 28000);
  assert.equal(e.src, "manual");
});
test("ongkir typed in Rupiah", () => {
  const e = itemShip({ qty: 4, shipTotalIDR: 200000 }, c);
  assert.equal(e.total, 200000);
  assert.equal(e.perPc, 50000);
});
test("air estimate uses the higher of weight and volume weight, with min kg", () => {
  const e = itemShip({ qty: 10, route: "air", kgPc: 0.2, lcm: 30, wcm: 30, hcm: 30 }, c);
  // volume = 27000 cm3 x10 = 270000 / 6000 = 45 kg, real = 2 kg
  assert.equal(e.total, 45 * 80 * 2700);
});
test("no route, no estimate", () => {
  const e = itemShip({ qty: 1 }, c);
  assert.equal(e.src, "none");
});
test("shipQuote adds value percent and flat fee", () => {
  const q = shipQuote("air", 10, 0, 1000000, { ...c, shipRates: { air: { perKgCNY: 80, perCbmCNY: 0, divisor: 6000, minKg: 1, valuePct: 2, flatIDR: 5000 } } });
  assert.equal(q.total, 10 * 80 * 2700 + 20000 + 5000);
});
test("deriveData: modal, billed price, profit, internal clients", () => {
  const items = [
    { id: "a", client: "Budi", qty: 10, priceCNY: 10, rate: 2700, sellIDR: 40000, shipTotalIDR: 50000 },
    { id: "b", client: "Own shop", qty: 5, priceCNY: 20, rate: 2700 },
  ];
  const D = deriveData(items, [], [], c);
  const a = D.X.get("a");
  assert.equal(a.modal, 270000);
  assert.equal(a.alloc, 50000);
  assert.equal(a.landed, 320000);
  assert.equal(a.billed, 400000);
  assert.equal(a.profit, 80000);
  assert.equal(D.X.get("b").isInt, true);
  assert.equal(D.X.get("b").profit, null);
});
test("deriveData: real shipment cost is split by weight", () => {
  const items = [
    { id: "a", qty: 1, priceCNY: 10, rate: 2700, kgPc: 1, shipmentId: "s1" },
    { id: "b", qty: 1, priceCNY: 10, rate: 2700, kgPc: 3, shipmentId: "s1" },
  ];
  const D = deriveData(items, [{ id: "s1", name: "S1", method: "air", costIDR: 400000 }], [], c);
  assert.equal(D.X.get("a").alloc, 100000);
  assert.equal(D.X.get("b").alloc, 300000);
  assert.equal(D.X.get("a").shipSrc, "actual");
});
