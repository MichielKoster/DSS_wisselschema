// Test de rekenlogica: node --test tests/schedule.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSchedule, minutes, doubleBench, substitutions, POS } from "../js/schedule.js";

const players = ["K", "LH", "LO", "MO", "RO", "RH", "CL", "LO", "RH", ""].map((pref, i) => ({
  id: "p" + (i + 1), nr: String(i + 1), name: "Speelster " + (i + 1), pref, lefty: i === 8,
}));
const base = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
const grid = computeSchedule({ players, base, keeper1: "p1", keeper2: "p1", mode: "rot" });
const field = players.filter((p) => p.id !== "p1");

test("basisopstelling blijft staan", () => assert.deepEqual(grid[0], base));

test("elke 5 minuten precies 3 wissels met 10 speelsters", () => {
  for (let b = 1; b < 8; b++) {
    const ins = grid[b].slice(1).filter((id) => !grid[b - 1].slice(1).includes(id));
    assert.equal(ins.length, 3, "blok " + b);
  }
});

test("niemand twee blokken achter elkaar op de bank", () => assert.deepEqual(doubleBench(grid, field), []));

test("speeltijd verschilt hooguit 5 minuten", () => {
  const m = minutes(grid, field); const v = Object.values(m);
  assert.ok(Math.max(...v) - Math.min(...v) <= 5, JSON.stringify(m));
});

test("linkshandige staat alleen rechts", () => {
  grid.forEach((row) => {
    const pi = row.indexOf("p9");
    if (pi > 0) assert.ok(["RO", "RH"].includes(POS[pi][0]), "positie " + POS[pi][0]);
  });
});

test("geen dubbele speelsters in een blok", () => {
  grid.forEach((row) => assert.equal(new Set(row.filter(Boolean)).size, row.filter(Boolean).length));
});

test("wisselmomenten op 7 tijdstippen", () => {
  const s = substitutions(grid);
  assert.equal(s.length, 7);
  assert.equal(s[1].tag, "mini break");
  assert.equal(s[3].tag, "rust");
});

test("andere keeper in de 2e helft", () => {
  const g = computeSchedule({ players, base, keeper1: "p1", keeper2: "p2", mode: "rot" });
  assert.equal(g[3][0], "p1");
  assert.equal(g[4][0], "p2");
  g.forEach((row) => assert.equal(new Set(row.filter(Boolean)).size, row.filter(Boolean).length));
});
