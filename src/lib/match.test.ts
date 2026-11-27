import { test } from "node:test";
import assert from "node:assert/strict";
import { matchFactories, words } from "./match.ts";

test("asks and styles are read as garment-trade words", () => {
  assert.deepEqual(words("Block-print cotton Kaftans, 3 colours"), ["block", "print", "cotton", "kaftan"]);
  assert.deepEqual(words("Linen co-ord sets"), ["linen", "coord"]);
  assert.deepEqual(words("Rayon kurtis with lace"), ["rayon", "kurta", "lace"]);
  assert.deepEqual(words("Caftan dresses"), ["kaftan", "dress"]);
  assert.deepEqual(words(""), []);
});

const factories = [
  { id: "k", name: "Kkora Fashions", active: true, level: "strong" as const },
  { id: "s", name: "Shreeji Arts", active: true, level: "steady" as const },
  { id: "w", name: "Watch Mills", active: true, level: "watch" as const },
  { id: "x", name: "Closed Unit", active: false },
];
const lines = [
  { factory_id: "k", style: "AV-142", description: "Cotton block print kaftan", fabric: "Cotton cambric", product: "garment" },
  { factory_id: "k", style: "AV-141", description: "Linen co-ord set", fabric: null, product: "garment" },
  { factory_id: "s", style: "SH-9", description: "Rayon kaftan with lace", fabric: "Rayon", product: "garment" },
  { factory_id: "s", style: "SH-10", description: "Cotton block print kurta", fabric: "Cotton", product: "garment" },
  { factory_id: "w", style: "WM-1", description: "Cotton block print kaftan", fabric: null, product: "garment" },
  { factory_id: "x", style: "CU-1", description: "Cotton block print kaftan", fabric: null, product: "garment" },
  { factory_id: "k", style: "FB-1", description: "Block print cotton", fabric: null, product: "fabric" },
];

test("the factory that made the closest garment comes first; watch and inactive factories never show", () => {
  const m = matchFactories("Block-print cotton kaftan, 3 colours", lines, factories);
  assert.deepEqual(m.map((x) => x.factory.id), ["k", "s"]);
  assert.deepEqual(m[0].styles, ["AV-142"]);
  assert.equal(m[0].shared[0], "kaftan");
});

test("a different kind of garment is not a match, even with the same fabric", () => {
  assert.deepEqual(matchFactories("Cotton block print dress", lines, factories), []);
  assert.deepEqual(matchFactories("Linen co-ords", lines, factories).map((x) => x.factory.id), ["k"]);
});

test("printed fabric matches fabric made before", () => {
  assert.deepEqual(matchFactories("Block print cotton fabric by the metre", lines, factories).map((x) => [x.factory.id, x.styles]), [["k", ["FB-1"]]]);
});

test("nothing to go on, nothing suggested", () => {
  assert.deepEqual(matchFactories("as discussed", lines, factories), []);
});
