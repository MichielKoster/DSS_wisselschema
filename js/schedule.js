// Rekenlogica voor het wisselschema. Puur JavaScript zonder DOM, zodat het los te testen is.
// Een schema (grid) is een lijst van 8 blokken van 5 minuten.
// Elk blok is een array van 7 speler-id's (of null) in de volgorde van POS.

export const POS = [
  ["K", "Keeper"], ["LH", "Linkerhoek"], ["LO", "Linksopbouw"], ["MO", "Midden-opbouw"],
  ["RO", "Rechtsopbouw"], ["RH", "Rechterhoek"], ["CL", "Cirkelloper"],
];
export const BLOCKS = 8;
export const BLOCK_MIN = 5;
export const LABELS = ["0–5", "5–10", "10–15", "15–20", "20–25", "25–30", "30–35", "35–40"];
const CAT = { LH: "hoek", RH: "hoek", LO: "opb", MO: "opb", RO: "opb", CL: "cirkel" };
const RIGHT = ["RO", "RH"];
// Bij gelijke stand gaan eerst de hoeken en midden-opbouw eruit.
const OUT_ORDER = [1, 3, 5, 2, 6, 4];

/** Na blok-index b (2, 4, 6) liggen de mini break en de rust. */
export const isBreakBefore = (b) => b === 2 || b === 6;
export const isHalfBefore = (b) => b === 4;

const PERMS = (() => {
  const out = [];
  const p = (a, r) => {
    if (!r.length) { out.push(a); return; }
    r.forEach((x, i) => p(a.concat(x), r.slice(0, i).concat(r.slice(i + 1))));
  };
  p([], [0, 1, 2, 3, 4, 5]);
  return out;
})();

export const emptyRow = () => Array(7).fill(null);
export const emptyGrid = () => Array.from({ length: BLOCKS }, emptyRow);

/**
 * Verdeel 6 veldspelers over de veldposities.
 * - Wie blijft staan houdt zijn plek, behalve bij rouleren na een mini break of de rust.
 * - De linkshandige speler staat alleen rechtsopbouw of rechtshoek.
 */
function assignPositions(on, b, mode, byId, prevBlockPos, posCount) {
  const fpos = POS.slice(1).map((p) => p[0]);
  const boundary = mode === "rot" && (b === 2 || b === 4 || b === 6);
  let best = PERMS[0], bestScore = -Infinity;
  for (const perm of PERMS) {
    let s = 0;
    perm.forEach((pi, slot) => {
      const id = on[pi];
      if (!id) return;
      const pos = fpos[slot], P = byId[id] || {};
      if (P.pref === pos) s += mode === "vast" ? 5 : 2;
      else if (P.pref && CAT[P.pref] === CAT[pos]) s += 1;
      if (P.lefty) s += RIGHT.includes(pos) ? 3 : -20;
      const cnt = (posCount[id] && posCount[id][pos]) || 0;
      if (mode === "rot") s -= (P.lefty ? 2 : 3) * cnt;
      if (prevBlockPos[id] === pos) s += boundary ? -2 : 10;
    });
    if (s > bestScore) { bestScore = s; best = perm; }
  }
  return best.map((pi) => on[pi]);
}

/** Is de basisopstelling (blok 0) volledig en zonder dubbele spelers? */
export function basisComplete(grid) {
  const r = grid && grid[0];
  return !!r && r.length === 7 && r.every(Boolean) && new Set(r).size === 7;
}

/** Kies automatisch een basisopstelling uit de aanwezige spelers. */
export function autoBasis(players, keeperId, mode = "rot") {
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const k = players.some((p) => p.id === keeperId) ? keeperId : null;
  const on = players.filter((p) => p.id !== k).map((p) => p.id).slice(0, 6);
  while (on.length < 6) on.push(null);
  return [k, ...assignPositions(on, 0, mode, byId, {}, {})];
}

/**
 * Reken blok 1 t/m 7 door vanaf de basisopstelling in grid[0].
 * Wie op de bank zat komt erin; wie het langst speelt gaat eruit.
 * Met 9 veldspelers geeft dat elke 5 minuten precies 3 wissels.
 */
export function computeSchedule({ players, base, keeper1, keeper2, mode = "rot" }) {
  const ids = players.map((p) => p.id);
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const played = {}, posCount = {}, consec = {};
  ids.forEach((i) => { played[i] = 0; posCount[i] = {}; consec[i] = 0; });
  const tally = (row) => {
    row.forEach((id, pi) => {
      if (!id || played[id] == null) return;
      played[id]++;
      if (pi > 0) { const p = POS[pi][0]; posCount[id][p] = (posCount[id][p] || 0) + 1; }
    });
    ids.forEach((i) => { consec[i] = row.slice(1).includes(i) ? consec[i] + 1 : 0; });
  };
  const grid = [base.slice()];
  tally(base);
  for (let b = 1; b < BLOCKS; b++) {
    const prev = grid[b - 1];
    const kk = b < 4 ? keeper1 : (keeper2 || keeper1);
    const keeper = ids.includes(kk) ? kk : null;
    const pool = ids.filter((i) => i !== keeper);
    const prevOn = pool.filter((i) => prev.indexOf(i) > 0);
    const mustIn = pool.filter((i) => !prevOn.includes(i))
      .sort((a, c) => played[a] - played[c]).slice(0, 6);
    const nOut = Math.max(0, prevOn.length + mustIn.length - 6);
    const outs = new Set(prevOn.slice().sort((a, c) =>
      (played[c] - played[a]) || (consec[c] - consec[a]) ||
      (OUT_ORDER.indexOf(prev.indexOf(a)) - OUT_ORDER.indexOf(prev.indexOf(c)))
    ).slice(0, nOut));
    const on = prevOn.filter((i) => !outs.has(i)).concat(mustIn);
    while (on.length < 6) on.push(null);
    const prevBlockPos = {};
    prev.forEach((id, pi) => { if (id && pi > 0) prevBlockPos[id] = POS[pi][0]; });
    const row = [keeper, ...assignPositions(on, b, mode, byId, prevBlockPos, posCount)];
    grid.push(row);
    tally(row);
  }
  return grid;
}

/** Speelminuten per speler-id. */
export function minutes(grid, players) {
  const m = Object.fromEntries(players.map((p) => [p.id, 0]));
  grid.forEach((row) => row.forEach((id) => { if (id && m[id] != null) m[id] += BLOCK_MIN; }));
  return m;
}

/** Spelers die twee blokken achter elkaar op de bank zitten. */
export function doubleBench(grid, players) {
  return players.filter((p) => {
    for (let b = 1; b < BLOCKS; b++) {
      if (!(grid[b - 1] || []).includes(p.id) && !(grid[b] || []).includes(p.id)) return true;
    }
    return false;
  }).map((p) => p.id);
}

/** Wisselmomenten: per minuut wie erin gaat, wie eruit gaat en wie doorschuift. */
export function substitutions(grid) {
  const out = [];
  for (let b = 1; b < BLOCKS; b++) {
    const a = grid[b - 1] || [], c = grid[b] || [];
    const lines = [];
    for (let pi = 0; pi < 7; pi++) {
      if (a[pi] === c[pi]) continue;
      const inn = c[pi], outP = a[pi];
      lines.push({
        pos: POS[pi][0],
        in: inn,
        moved: !!inn && a.includes(inn),
        out: outP && !c.includes(outP) ? outP : null,
      });
    }
    const t = b * BLOCK_MIN;
    out.push({ minute: t, tag: t === 10 || t === 30 ? "mini break" : t === 20 ? "rust" : "", lines });
  }
  return out;
}

/** Zet een speler in een blok; in de basis ruilt een speler die al elders stond van plek. */
export function placePlayer(grid, b, pi, id) {
  const g = grid.map((r) => r.slice());
  const row = g[b];
  const old = row[pi];
  const j = id ? row.indexOf(id) : -1;
  row[pi] = id || null;
  if (b === 0 && j >= 0 && j !== pi) row[j] = old;
  return g;
}
