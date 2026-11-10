import { CONFIG } from "./config.js";
import { store, uid } from "./store.js";
import {
  POS, BLOCKS, LABELS, emptyRow, emptyGrid, basisComplete, autoBasis, computeSchedule,
  minutes, doubleBench, substitutions, placePlayer,
} from "./schedule.js";

// ---------- hulpjes ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) => {
  if (!iso) return "Geen datum";
  const d = new Date(iso + "T12:00");
  return isNaN(d) ? iso : d.toLocaleDateString("nl-NL", opts);
};
const fmtStamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) + " " +
    d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
};
const nameOf = (email) => {
  const m = state.members.find((x) => x.email === email);
  return m?.name || (email ? email.split("@")[0] : "onbekend");
};
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
// Knop die eerst om bevestiging vraagt (de tweede klik voert uit).
function twoStep(btn, fn, confirmText = "Klik nogmaals om te bevestigen") {
  const label = btn.textContent; let armed = false, timer;
  btn.addEventListener("click", () => {
    if (armed) { armed = false; clearTimeout(timer); btn.textContent = label; fn(); return; }
    armed = true; btn.textContent = confirmText;
    timer = setTimeout(() => { armed = false; btn.textContent = label; }, 4000);
  });
}
const posOptions = (sel) => '<option value="">geen</option>' +
  POS.map(([k, n]) => `<option value="${k}"${k === sel ? " selected" : ""}>${k} · ${n}</option>`).join("");

// ---------- toestand ----------
const state = {
  players: [], matches: [], members: [],
  match: null, dirty: false, saveTimer: null, saving: false,
  view: "",
};

// ---------- opstarten en inloggen ----------
const recoveryLink = /type=recovery/.test(location.hash);
let started = false;

async function boot() {
  $("#team-name").textContent = CONFIG.teamName || "";
  document.title = "Wisselschema " + (CONFIG.teamName || "");
  if (store.mode === "local") $("#localbanner").hidden = false;

  store.onAuth((event) => {
    if (event === "PASSWORD_RECOVERY") renderSetPassword();
    else if (event === "SIGNED_OUT") { started = false; $("#topbar").hidden = true; renderLogin(); }
    else if (event === "SIGNED_IN" && !started && !recoveryLink) start();
  });

  const session = await store.session();
  if (!session) renderLogin();
  else if (recoveryLink) renderSetPassword();
  else start();
}

function renderLogin(mode = "login", msg = "") {
  $("#topbar").hidden = true;
  const titles = { login: "Inloggen", signup: "Account aanmaken", reset: "Wachtwoord vergeten" };
  const btn = { login: "Inloggen", signup: "Account aanmaken", reset: "Stuur herstel-link" };
  app.innerHTML = `
    <div class="auth card stack">
      <div><div class="label">Handbal · ${esc(CONFIG.teamName)}</div><h1>Wisselschema</h1></div>
      <h2>${titles[mode]}</h2>
      ${mode === "signup" ? '<p class="note">Lukt alleen met een e-mailadres dat een coach heeft uitgenodigd.</p>' : ""}
      ${mode === "reset" ? '<p class="note">Je krijgt een e-mail met een link om een nieuw wachtwoord in te stellen.</p>' : ""}
      <form id="f-auth" class="stack" novalidate>
        <label class="field"><span class="label">E-mailadres</span><input id="a-email" type="email" autocomplete="email" required></label>
        ${mode !== "reset" ? `<label class="field"><span class="label">Wachtwoord</span><input id="a-pw" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" minlength="8" required></label>` : ""}
        <button type="submit">${btn[mode]}</button>
        <p class="err" id="a-err">${esc(msg)}</p>
      </form>
      <div class="row note">
        ${mode !== "login" ? '<button class="link" data-m="login">Inloggen</button>' : ""}
        ${mode !== "signup" ? '<button class="link" data-m="signup">Account aanmaken</button>' : ""}
        ${mode !== "reset" ? '<button class="link" data-m="reset">Wachtwoord vergeten</button>' : ""}
      </div>
    </div>`;
  $$("[data-m]").forEach((b) => b.onclick = () => renderLogin(b.dataset.m));
  $("#f-auth").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#a-email").value.trim(), pw = $("#a-pw")?.value || "";
    const err = $("#a-err"); err.textContent = "";
    if (!email) { err.textContent = "Vul je e-mailadres in."; return; }
    if (mode !== "reset" && pw.length < 8) { err.textContent = "Het wachtwoord moet minstens 8 tekens hebben."; return; }
    const b = $("#f-auth button"); b.disabled = true;
    try {
      if (mode === "login") { await store.signIn(email, pw); if (!started) start(); }
      else if (mode === "signup") {
        const r = await store.signUp(email, pw);
        if (r.needsConfirm) renderLogin("login", "Account aangemaakt. Bevestig je e-mailadres via de link in je mail en log daarna in.");
        else if (!started) start();
      } else {
        await store.resetPassword(email);
        renderLogin("login", "Als dit adres bekend is, staat er nu een herstel-link in je mail.");
      }
    } catch (ex) {
      err.textContent = authError(ex);
      b.disabled = false;
    }
  };
}

function authError(ex) {
  const m = (ex && ex.message) || "";
  if (/invalid login/i.test(m)) return "E-mailadres of wachtwoord klopt niet.";
  if (/not confirmed/i.test(m)) return "Bevestig eerst je e-mailadres via de link in je mail.";
  if (/niet uitgenodigd|database error saving new user/i.test(m)) return "Dit e-mailadres is niet uitgenodigd. Vraag een coach om je toe te voegen.";
  if (/already registered/i.test(m)) return "Dit e-mailadres heeft al een account. Log in of kies Wachtwoord vergeten.";
  if (/rate limit/i.test(m)) return "Te veel pogingen. Probeer het over een paar minuten opnieuw.";
  return "Dat lukte niet: " + (m || "onbekende fout") + ".";
}

function renderSetPassword() {
  $("#topbar").hidden = true;
  app.innerHTML = `
    <div class="auth card stack">
      <h1>Nieuw wachtwoord</h1>
      <form id="f-pw" class="stack" novalidate>
        <label class="field"><span class="label">Nieuw wachtwoord</span><input id="pw1" type="password" autocomplete="new-password" minlength="8"></label>
        <label class="field"><span class="label">Herhaal wachtwoord</span><input id="pw2" type="password" autocomplete="new-password" minlength="8"></label>
        <button type="submit">Wachtwoord opslaan</button>
        <p class="err" id="pw-err"></p>
      </form>
    </div>`;
  $("#f-pw").onsubmit = async (e) => {
    e.preventDefault();
    const a = $("#pw1").value, b = $("#pw2").value, err = $("#pw-err");
    if (a.length < 8) { err.textContent = "Het wachtwoord moet minstens 8 tekens hebben."; return; }
    if (a !== b) { err.textContent = "De twee wachtwoorden zijn niet gelijk."; return; }
    try {
      await store.updatePassword(a);
      history.replaceState(null, "", location.pathname + "#/wedstrijden");
      toast("Wachtwoord opgeslagen");
      start();
    } catch (ex) { err.textContent = authError(ex); }
  };
}

async function start() {
  if (started) return;
  started = true;
  let member = false;
  try { member = await store.isMember(); } catch { member = false; }
  if (!member) {
    started = false;
    app.innerHTML = `<div class="auth card stack"><h1>Nog geen toegang</h1>
      <p>Je bent ingelogd als <b>${esc(store.email())}</b>, maar dit adres staat niet op de coachlijst.</p>
      <p class="note">Vraag een van de coaches om je toe te voegen onder Coaches.</p>
      <div><button id="b-out2" class="ghost">Uitloggen</button></div></div>`;
    $("#b-out2").onclick = () => store.signOut();
    return;
  }
  $("#topbar").hidden = false;
  $("#who-email").textContent = store.mode === "local" ? "Lokale modus" : store.email();
  $("#b-logout").hidden = store.mode === "local";
  $("#b-logout").onclick = async () => { await flushSave(); store.signOut(); };
  await Promise.all([loadPlayers(), loadMatches(), loadMembers()]);
  store.subscribe(onRemoteChange);
  addEventListener("hashchange", route);
  addEventListener("beforeunload", (e) => { if (state.dirty) { flushSave(); e.preventDefault(); } });
  route();
}

async function loadPlayers() { try { state.players = await store.listPlayers(); } catch (e) { toast("Selectie laden lukte niet"); } }
async function loadMatches() { try { state.matches = await store.listMatches(); } catch (e) { toast("Wedstrijden laden lukte niet"); } }
async function loadMembers() { try { state.members = await store.listMembers(); } catch { state.members = []; } }

// ---------- routes ----------
async function route() {
  await flushSave();
  const h = location.hash.startsWith("#/") ? location.hash.slice(2) : "wedstrijden";
  const [view, id] = h.split("/");
  state.view = view;
  $$(".tabs a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.tab === (view === "wedstrijd" ? "wedstrijden" : view)));
  $$(".tabs a").forEach((a) => { if (a.hasAttribute("aria-current")) a.setAttribute("aria-current", "page"); });
  if (view === "wedstrijd" && id) return viewMatch(id);
  if (view === "selectie") return viewSelectie();
  if (view === "team") return viewTeam();
  state.view = "wedstrijden";
  return viewMatches();
}

// ---------- realtime ----------
async function onRemoteChange(table, payload) {
  if (table === "players") {
    await loadPlayers();
    if (state.view === "selectie" && !document.activeElement?.closest?.(".players")) viewSelectie();
    return;
  }
  await loadMatches();
  if (state.view === "wedstrijden") viewMatches();
  if (state.view === "wedstrijd" && state.match) {
    const changedId = payload?.new?.id || payload?.old?.id;
    if (changedId && changedId !== state.match.id) return;
    if (payload?.eventType === "DELETE") { toast("Deze wedstrijd is verwijderd door een andere coach"); location.hash = "#/wedstrijden"; return; }
    const by = payload?.new?.updated_by;
    if (by && by === store.email()) return; // eigen opslag
    if (state.dirty || state.saving) return; // eigen wijziging gaat voor
    const fresh = await store.getMatch(state.match.id);
    if (!fresh || fresh.updated_at === state.match.updated_at) return;
    state.match = normalizeMatch(fresh);
    renderMatch();
    toast("Bijgewerkt door " + nameOf(by));
  }
}

// ---------- wedstrijden ----------
function matchItem(m) {
  return `<a class="mitem" href="#/wedstrijd/${esc(m.id)}">
    <span class="mdate">${esc(fmtDate(m.match_date))}<small>${m.start_time ? esc(m.start_time) + " uur" : "&nbsp;"}</small></span>
    <span class="mopp">${esc(m.opponent || "Tegenstander onbekend")}<small>Bijgewerkt ${esc(fmtStamp(m.updated_at))} door ${esc(nameOf(m.updated_by))}</small></span>
    <span class="pill${m.home ? "" : " uit"}">${m.home ? "Thuis" : "Uit"}</span></a>`;
}

function viewMatches() {
  const t = todayISO();
  const upcoming = state.matches.filter((m) => !m.match_date || m.match_date >= t).reverse();
  const played = state.matches.filter((m) => m.match_date && m.match_date < t);
  const noPlayers = state.players.filter((p) => !p.archived).length === 0;
  app.innerHTML = `
    <div class="head"><div><h1>Wedstrijden</h1><p class="note">2 × 20 minuten · wissel elke 5 minuten · mini break na 10 en 30 minuten</p></div>
      <button id="b-new"${noPlayers ? " disabled" : ""}>Nieuwe wedstrijd</button></div>
    ${noPlayers ? '<section><p>Er staan nog geen speelsters in de selectie. <a href="#/selectie">Vul eerst de selectie in.</a></p></section>' : ""}
    <section><h2>Komend</h2><div class="mlist">${upcoming.map(matchItem).join("") || '<p class="empty">Nog geen komende wedstrijden. Maak er een aan met Nieuwe wedstrijd.</p>'}</div></section>
    <section><h2>Gespeeld</h2><div class="mlist">${played.map(matchItem).join("") || '<p class="empty">Gespeelde wedstrijden komen hier te staan.</p>'}</div></section>`;
  $("#b-new").onclick = newMatch;
}

async function newMatch() {
  const squad = state.players.filter((p) => !p.archived && (p.name || "").trim())
    .map(({ id, nr, name, pref, lefty }) => ({ id, nr: nr || "", name, pref: pref || "", lefty: !!lefty }));
  const keeper = (squad.find((p) => p.pref === "K") || squad[0] || {}).id || null;
  const data = { squad, mode: "rot", k1: keeper, k2: keeper, grid: emptyGrid(), notes: "" };
  // Basis van de vorige wedstrijd overnemen als die spelers er allemaal weer bij zijn.
  let base = null;
  const prev = state.matches[0];
  if (prev) {
    try {
      const full = await store.getMatch(prev.id);
      const b = full?.data?.grid?.[0];
      if (b && b.every((id) => squad.some((p) => p.id === id))) { base = b.slice(); data.k1 = b[0]; data.k2 = full.data.k2 && squad.some((p) => p.id === full.data.k2) ? full.data.k2 : b[0]; data.mode = full.data.mode || "rot"; }
    } catch { /* geen vorige basis */ }
  }
  data.grid[0] = base || autoBasis(squad, data.k1, data.mode);
  if (basisComplete(data.grid)) data.grid = computeSchedule({ players: squad, base: data.grid[0], keeper1: data.k1, keeper2: data.k2, mode: data.mode });
  const m = { id: uid(), match_date: "", start_time: "", opponent: "", home: true, data };
  try {
    await store.saveMatch(m);
    await loadMatches();
    location.hash = "#/wedstrijd/" + m.id;
    if (base) toast("Basisopstelling van de vorige wedstrijd overgenomen");
  } catch (e) { toast("Aanmaken lukte niet: " + (e.message || e)); }
}

// ---------- wedstrijd-editor ----------
function normalizeMatch(row) {
  const d = row.data || {};
  const grid = Array.from({ length: BLOCKS }, (_, b) => {
    const r = (d.grid && d.grid[b]) || emptyRow();
    return Array.from({ length: 7 }, (_, i) => r[i] || null);
  });
  return {
    id: row.id, match_date: row.match_date || "", start_time: row.start_time || "", opponent: row.opponent || "",
    home: row.home !== false, updated_at: row.updated_at, updated_by: row.updated_by,
    data: { squad: d.squad || [], mode: d.mode || "rot", k1: d.k1 || null, k2: d.k2 || d.k1 || null, grid, notes: d.notes || "" },
  };
}
const M = () => state.match;
const D = () => state.match.data;
const squad = () => D().squad.filter((p) => (p.name || "").trim());
const pName = (id) => { const p = D().squad.find((x) => x.id === id); return p ? p.name : "—"; };
const pFull = (id) => { const p = D().squad.find((x) => x.id === id); return p ? (p.nr ? "#" + p.nr + " " : "") + p.name : "—"; };

function markDirty() {
  state.dirty = true;
  setStatus("Wijzigingen opslaan…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 700);
}
async function saveNow() {
  if (!state.match || !state.dirty) return;
  clearTimeout(state.saveTimer);
  state.dirty = false; state.saving = true;
  try {
    const row = await store.saveMatch(state.match);
    state.match.updated_at = row.updated_at; state.match.updated_by = row.updated_by;
    setStatus("Opgeslagen om " + new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }));
    loadMatches();
  } catch (e) {
    state.dirty = true;
    setStatus("Niet opgeslagen. Controleer je internetverbinding; de app probeert het opnieuw.", true);
    clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveNow, 5000);
  } finally { state.saving = false; }
}
async function flushSave() { if (state.dirty) await saveNow(); }
function setStatus(txt, err = false) { const s = $("#m-status"); if (s) { s.textContent = txt; s.classList.toggle("err", err); } }

function recalc() {
  const d = D();
  if (basisComplete(d.grid)) d.grid = computeSchedule({ players: squad(), base: d.grid[0], keeper1: d.k1, keeper2: d.k2, mode: d.mode });
}

async function viewMatch(id) {
  app.innerHTML = '<p class="note">Wedstrijd laden…</p>';
  let row;
  try { row = await store.getMatch(id); } catch (e) { app.innerHTML = `<p class="warn">Laden lukte niet: ${esc(e.message || e)}</p>`; return; }
  if (!row) { app.innerHTML = '<section><p>Deze wedstrijd bestaat niet (meer). <a href="#/wedstrijden">Terug naar wedstrijden</a></p></section>'; return; }
  state.match = normalizeMatch(row);
  renderMatch();
}

function renderMatch() {
  const m = M(), d = D();
  app.innerHTML = `
    <div class="head noprint"><a class="back" href="#/wedstrijden">← Wedstrijden</a>
      <span class="status" id="m-status">${m.updated_at ? "Laatst bewerkt " + esc(fmtStamp(m.updated_at)) + " door " + esc(nameOf(m.updated_by)) : ""}</span></div>

    <section>
      <h2>Wedstrijd</h2>
      <div class="info">
        <label class="field"><span class="label">Tegenstander</span><input id="i-opp" value="${esc(m.opponent)}" placeholder="Naam tegenstander"></label>
        <label class="field"><span class="label">Datum</span><input id="i-date" type="date" value="${esc(m.match_date)}"></label>
        <label class="field"><span class="label">Aanvang</span><input id="i-time" type="time" value="${esc(m.start_time)}"></label>
        <label class="field"><span class="label">Thuis / uit</span><select id="i-home"><option value="1"${m.home ? " selected" : ""}>Thuis</option><option value="0"${m.home ? "" : " selected"}>Uit</option></select></label>
      </div>
      <label class="field"><span class="label">Notities</span><textarea id="i-notes" rows="2" placeholder="Bijvoorbeeld afspraken, coachpunten of de uitslag">${esc(d.notes)}</textarea></label>
    </section>

    <section>
      <div class="head">
        <div><h2>Speelsters deze wedstrijd</h2><p class="note">Wijzigingen hier gelden alleen voor deze wedstrijd.</p></div>
        <div class="row">
          <label class="field" style="width:160px"><span class="label">Keeper 1e helft</span><select id="k1"></select></label>
          <label class="field" style="width:160px"><span class="label">Keeper 2e helft</span><select id="k2"></select></label>
        </div>
      </div>
      <div class="scroll"><table class="players">
        <thead><tr><th>Nr</th><th>Naam</th><th>Voorkeur</th><th title="Linkshandig">Links</th><th>Minuten</th><th>Per blok</th><th></th></tr></thead>
        <tbody id="sq"></tbody></table></div>
      <div class="row">
        <select id="add-from" style="max-width:260px" aria-label="Speelster uit selectie toevoegen"></select>
        <button id="b-add-from" class="ghost">Toevoegen</button>
        <button id="b-add-guest" class="ghost">Gastspeelster</button>
      </div>
      <div id="fair"></div>
    </section>

    <section class="sec-grid">
      <div class="printhead"><h1>Wisselschema ${esc(CONFIG.teamName)}</h1><span id="ph-info"></span></div>
      <div class="head">
        <div>
          <h2>Schema per 5 minuten</h2>
          <p class="note">Vul de basisopstelling in de eerste kolom in. Daarna worden de wissels doorgerekend: elke 5 minuten gaan de speelsters van de bank erin. Latere kolommen kun je nog met de hand aanpassen.</p>
          <p id="basis-note"></p>
        </div>
        <div class="row">
          <div class="seg" role="group" aria-label="Posities">
            <button id="m-vast" aria-pressed="${d.mode === "vast"}">Vaste posities</button>
            <button id="m-rot" aria-pressed="${d.mode === "rot"}">Posities rouleren</button>
          </div>
          <button id="b-auto">Basis automatisch kiezen</button>
          <button id="b-clear" class="ghost">Leeg schema</button>
        </div>
      </div>
      <div class="scroll"><table class="grid" id="grid"></table></div>
      <p class="printlegend">Geel gestreept = mini break (na 10 en 30 min) · geel = rust (na 20 min) · wissel via de wisselzone voor de eigen bank</p>
    </section>

    <section class="sec-mom">
      <h2>Wisselmomenten</h2>
      <p class="note">Wie erin gaat en wie eruit. Wissel via de wisselzone voor je eigen bank; de speelster die eruit gaat is eerst over de lijn.</p>
      <div class="moments" id="moments"></div>
    </section>

    <div class="row noprint">
      <button id="b-print">Afdrukken</button>
      <button id="b-dup" class="ghost">Kopie maken</button>
      <button id="b-del" class="danger">Wedstrijd verwijderen</button>
    </div>`;

  // wedstrijdgegevens
  const bind = (id, fn) => { const el = $(id); el.oninput = el.onchange = () => { fn(el.value); printInfo(); markDirty(); }; };
  bind("#i-opp", (v) => { m.opponent = v; });
  bind("#i-date", (v) => { m.match_date = v; });
  bind("#i-time", (v) => { m.start_time = v; });
  bind("#i-home", (v) => { m.home = v === "1"; });
  bind("#i-notes", (v) => { d.notes = v; });

  $("#m-vast").onclick = () => { d.mode = "vast"; recalc(); refreshGrid(); markDirty(); };
  $("#m-rot").onclick = () => { d.mode = "rot"; recalc(); refreshGrid(); markDirty(); };
  twoStep($("#b-auto"), () => { d.grid[0] = autoBasis(squad(), d.k1, d.mode); recalc(); refreshGrid(); markDirty(); }, "Klik nogmaals om te overschrijven");
  twoStep($("#b-clear"), () => { d.grid = emptyGrid(); refreshGrid(); markDirty(); }, "Klik nogmaals om te wissen");
  $("#b-print").onclick = () => window.print();
  $("#b-dup").onclick = duplicateMatch;
  twoStep($("#b-del"), deleteMatch, "Klik nogmaals om te verwijderen");
  $("#b-add-from").onclick = () => {
    const id = $("#add-from").value; const p = state.players.find((x) => x.id === id); if (!p) return;
    d.squad.push({ id: p.id, nr: p.nr || "", name: p.name, pref: p.pref || "", lefty: !!p.lefty });
    recalc(); renderSquad(); refreshGrid(); markDirty();
  };
  $("#b-add-guest").onclick = () => { d.squad.push({ id: uid(), nr: "", name: "", pref: "", lefty: false, guest: true }); renderSquad(); markDirty(); };

  renderSquad();
  refreshGrid();
  printInfo();
}

function playerOptions(sel) {
  return '<option value="">—</option>' + squad().map((p) =>
    `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(pFull(p.id))}</option>`).join("");
}

function renderSquad() {
  const d = D(), tb = $("#sq");
  tb.innerHTML = d.squad.map((p, i) => `<tr data-i="${i}">
    <td><input class="nr" value="${esc(p.nr)}" aria-label="Rugnummer"></td>
    <td><input class="nm" value="${esc(p.name)}" aria-label="Naam" placeholder="Naam"></td>
    <td><select class="pf" aria-label="Voorkeurspositie">${posOptions(p.pref)}</select></td>
    <td><input type="checkbox" class="lh" ${p.lefty ? "checked" : ""} aria-label="Linkshandig"></td>
    <td class="min" data-min="${esc(p.id)}"></td>
    <td data-bl="${esc(p.id)}"></td>
    <td><button class="ghost x" aria-label="Verwijder ${esc(p.name)} uit deze wedstrijd">×</button></td></tr>`).join("");
  $$("tr", tb).forEach((tr) => {
    const p = d.squad[+tr.dataset.i];
    $(".nr", tr).oninput = (e) => { p.nr = e.target.value; refreshSoft(); markDirty(); };
    $(".nm", tr).oninput = (e) => { p.name = e.target.value; refreshSoft(); markDirty(); };
    $(".nm", tr).onchange = () => { recalc(); refreshGrid(); };
    $(".pf", tr).onchange = (e) => { p.pref = e.target.value; recalc(); refreshGrid(); markDirty(); };
    $(".lh", tr).onchange = (e) => { p.lefty = e.target.checked; recalc(); refreshGrid(); markDirty(); };
    $(".x", tr).onclick = () => {
      d.squad = d.squad.filter((x) => x !== p);
      d.grid = d.grid.map((r) => r.map((v) => (v === p.id ? null : v)));
      if (d.k1 === p.id) d.k1 = squad()[0]?.id || null;
      if (d.k2 === p.id) d.k2 = d.k1;
      renderSquad(); refreshGrid(); markDirty();
    };
  });
  const avail = state.players.filter((p) => !p.archived && (p.name || "").trim() && !d.squad.some((s) => s.id === p.id));
  $("#add-from").innerHTML = avail.length
    ? avail.map((p) => `<option value="${esc(p.id)}">${esc((p.nr ? "#" + p.nr + " " : "") + p.name)}</option>`).join("")
    : '<option value="">Iedereen uit de selectie staat erin</option>';
  $("#b-add-from").disabled = !avail.length;
}

function refreshGrid() {
  const d = D();
  ["k1", "k2"].forEach((k) => {
    const el = $("#" + k); el.innerHTML = playerOptions(d[k]);
    el.onchange = () => {
      const v = el.value || null; d[k] = v;
      if (k === "k1") { d.grid = placePlayer(d.grid, 0, 0, v); if (!d.k2) d.k2 = v; }
      recalc(); refreshGrid(); markDirty();
    };
  });
  $("#m-vast").setAttribute("aria-pressed", d.mode === "vast");
  $("#m-rot").setAttribute("aria-pressed", d.mode === "rot");

  const brk = (b, tag) => (b === 2 || b === 6) ? `<${tag} class="brk" title="Mini break"></${tag}>` : b === 4 ? `<${tag} class="brk rust" title="Rust"></${tag}>` : "";
  let h = "<thead><tr><th></th>";
  for (let b = 0; b < BLOCKS; b++) {
    const half = b === 0 ? "1e helft · basis" : b === 4 ? "2e helft" : "&nbsp;";
    h += brk(b, "th") + `<th${b === 0 ? ' class="basis"' : ""}><div class="half">${half}</div>${LABELS[b]} min</th>`;
  }
  h += "</tr></thead><tbody>";
  POS.forEach(([k, n], pi) => {
    h += `<tr class="${pi === 0 ? "keeper" : ""}"><th class="pos"><b>${k}</b><span>${n}</span></th>`;
    for (let b = 0; b < BLOCKS; b++) {
      h += brk(b, "td") + `<td data-b="${b}" data-p="${pi}"${b === 0 ? ' class="basis"' : ""}><select aria-label="${n} ${LABELS[b]} min">${playerOptions(d.grid[b][pi])}</select><span class="pv"></span></td>`;
    }
    h += "</tr>";
  });
  h += '<tr class="bank"><th class="pos"><b>Bank</b></th>';
  for (let b = 0; b < BLOCKS; b++) h += brk(b, "td") + `<td data-bank="${b}"></td>`;
  h += "</tr></tbody>";
  const g = $("#grid"); g.innerHTML = h;
  $$("td[data-b] select", g).forEach((sel) => {
    sel.onchange = () => {
      const td = sel.closest("td"), b = +td.dataset.b, pi = +td.dataset.p, v = sel.value || null;
      d.grid = placePlayer(d.grid, b, pi, v);
      if (b === 0) {
        const oldK1 = d.k1; d.k1 = d.grid[0][0];
        if (!d.k2 || d.k2 === oldK1) d.k2 = d.k1;
        recalc(); refreshGrid();
      }
      else refreshSoft();
      markDirty();
    };
  });
  refreshSoft();
}

function refreshSoft() {
  const d = D(), sq = squad(), g = d.grid;
  // namen in keuzelijsten
  $$("#grid select, #k1, #k2").forEach((sel) => [...sel.options].forEach((o) => { if (o.value) o.textContent = pFull(o.value); }));
  // dubbel, leeg, bank
  for (let b = 0; b < BLOCKS; b++) {
    const row = g[b], cnt = {};
    row.forEach((v) => { if (v) cnt[v] = (cnt[v] || 0) + 1; });
    for (let pi = 0; pi < 7; pi++) {
      const td = $(`#grid td[data-b="${b}"][data-p="${pi}"]`); if (!td) continue;
      const v = row[pi];
      td.classList.toggle("dup", !!v && cnt[v] > 1);
      td.classList.toggle("empty", !v);
      $(".pv", td).textContent = v ? pFull(v) : "";
    }
    const bank = sq.filter((p) => !row.includes(p.id)).map((p) => p.name);
    const el = $(`#grid td[data-bank="${b}"]`); if (el) el.textContent = bank.join(", ") || "—";
  }
  // minuten per speelster
  const mins = minutes(g, sq);
  const field = sq.filter((p) => !(p.id === d.k1 && p.id === d.k2));
  const fm = field.map((p) => mins[p.id]);
  const maxM = fm.length ? Math.max(...fm) : 0, minM = fm.length ? Math.min(...fm) : 0;
  d.squad.forEach((p) => {
    const mEl = $(`[data-min="${CSS.escape(p.id)}"]`), bEl = $(`[data-bl="${CSS.escape(p.id)}"]`);
    if (!mEl) return;
    if (!(p.name || "").trim()) { mEl.textContent = ""; bEl.innerHTML = ""; return; }
    mEl.textContent = mins[p.id] + "'";
    mEl.classList.toggle("low", field.includes(p) && mins[p.id] < maxM - 5);
    bEl.innerHTML = g.map((row) => {
      const pi = row.indexOf(p.id);
      return pi < 0 ? '<span class="chip off">bank</span>' : `<span class="chip${pi === 0 ? " k" : ""}">${POS[pi][0]}</span>`;
    }).join(" ");
  });
  const fair = $("#fair"), dbl = doubleBench(g, field);
  const filled = g.some((r) => r.some(Boolean));
  if (!filled) fair.innerHTML = '<p class="note">Nog geen schema. Vul de basisopstelling in of klik op Basis automatisch kiezen.</p>';
  else if (maxM - minM > 5) fair.innerHTML = `<p class="warn">Speeltijd loopt uiteen van ${minM} tot ${maxM} minuten. Rood is minder dan de rest.</p>`;
  else if (dbl.length) fair.innerHTML = `<p class="warn">Twee blokken achter elkaar op de bank: ${esc(dbl.map(pName).join(", "))}.</p>`;
  else fair.innerHTML = `<p class="ok">Speeltijd is eerlijk verdeeld (${minM}–${maxM} minuten per veldspeelster).</p>`;
  const bn = $("#basis-note");
  if (basisComplete(g)) { bn.className = "ok"; bn.textContent = `Wissels zijn doorgerekend vanaf de basisopstelling. Met ${sq.length} speelsters zitten er per blok ${Math.max(0, sq.length - 7)} op de bank.`; }
  else { bn.className = "warn"; bn.textContent = "Vul de basisopstelling (kolom 0–5 min) helemaal in. Daarna worden de wissels automatisch doorgerekend."; }
  renderMoments();
}

function renderMoments() {
  $("#moments").innerHTML = substitutions(D().grid).map((s) => {
    const lines = s.lines.map((l) => {
      let t = `<b>${l.pos}</b> ${esc(l.in ? pName(l.in) : "—")} ${l.moved ? "schuift door" : "erin"}`;
      if (l.out) t += `, ${esc(pName(l.out))} eruit`;
      return `<p>${t}</p>`;
    }).join("");
    return `<div class="mom${s.tag ? " zone" : ""}"><h3>Minuut ${s.minute}${s.tag ? ` <small>${s.tag}</small>` : ""}</h3>${lines || '<p class="note">Geen wissel</p>'}</div>`;
  }).join("");
}

function printInfo() {
  const m = M(), parts = [];
  parts.push([CONFIG.teamName, m.opponent].filter(Boolean).join(" – "));
  if (m.match_date) parts.push(fmtDate(m.match_date, { weekday: "short", day: "numeric", month: "long", year: "numeric" }));
  if (m.start_time) parts.push(m.start_time + " uur");
  parts.push(m.home ? "Thuis" : "Uit");
  const el = $("#ph-info"); if (el) el.textContent = parts.filter(Boolean).join(" · ");
}

async function duplicateMatch() {
  await flushSave();
  const copy = JSON.parse(JSON.stringify(M()));
  copy.id = uid(); copy.match_date = ""; copy.start_time = ""; copy.opponent = (copy.opponent ? copy.opponent + " (kopie)" : ""); copy.data.notes = "";
  try { await store.saveMatch(copy); await loadMatches(); location.hash = "#/wedstrijd/" + copy.id; toast("Kopie gemaakt"); }
  catch (e) { toast("Kopie maken lukte niet"); }
}
async function deleteMatch() {
  clearTimeout(state.saveTimer); state.dirty = false;
  try { await store.removeMatch(M().id); state.match = null; await loadMatches(); location.hash = "#/wedstrijden"; toast("Wedstrijd verwijderd"); }
  catch (e) { toast("Verwijderen lukte niet"); }
}

// ---------- selectie ----------
const playerTimers = {};
function viewSelectie() {
  state.match = null;
  app.innerHTML = `
    <div class="head"><div><h1>Selectie</h1><p class="note">De vaste spelerslijst van het team. Een nieuwe wedstrijd neemt deze lijst over; een bestaande wedstrijd houdt zijn eigen lijst.</p></div>
      <button id="b-addp">Speelster toevoegen</button></div>
    <section><div class="scroll"><table class="players">
      <thead><tr><th>Nr</th><th>Naam</th><th>Voorkeur</th><th title="Linkshandig">Links</th><th></th></tr></thead>
      <tbody id="pl"></tbody></table></div>
      <p class="note" id="pl-empty"></p></section>`;
  const tb = $("#pl");
  const list = state.players.filter((p) => !p.archived);
  $("#pl-empty").textContent = list.length ? "" : "Nog geen speelsters. Klik op Speelster toevoegen.";
  tb.innerHTML = list.map((p) => `<tr data-id="${esc(p.id)}">
    <td><input class="nr" value="${esc(p.nr)}" aria-label="Rugnummer"></td>
    <td><input class="nm" value="${esc(p.name)}" aria-label="Naam" placeholder="Naam"></td>
    <td><select class="pf" aria-label="Voorkeurspositie">${posOptions(p.pref)}</select></td>
    <td><input type="checkbox" class="lh" ${p.lefty ? "checked" : ""} aria-label="Linkshandig"></td>
    <td><button class="danger x">Verwijderen</button></td></tr>`).join("");
  $$("tr", tb).forEach((tr) => {
    const p = state.players.find((x) => x.id === tr.dataset.id);
    const save = () => {
      clearTimeout(playerTimers[p.id]);
      playerTimers[p.id] = setTimeout(async () => {
        try { await store.savePlayer({ id: p.id, nr: p.nr || "", name: p.name || "", pref: p.pref || "", lefty: !!p.lefty }); }
        catch { toast("Opslaan van " + (p.name || "speelster") + " lukte niet"); }
      }, 600);
    };
    $(".nr", tr).oninput = (e) => { p.nr = e.target.value; save(); };
    $(".nm", tr).oninput = (e) => { p.name = e.target.value; save(); };
    $(".pf", tr).onchange = (e) => { p.pref = e.target.value; save(); };
    $(".lh", tr).onchange = (e) => { p.lefty = e.target.checked; save(); };
    twoStep($(".x", tr), async () => {
      try { await store.removePlayer(p.id); await loadPlayers(); viewSelectie(); } catch { toast("Verwijderen lukte niet"); }
    }, "Zeker weten?");
  });
  $("#b-addp").onclick = async () => {
    const nr = String((Math.max(0, ...state.players.map((p) => +p.nr || 0)) + 1));
    try {
      await store.savePlayer({ id: uid(), nr, name: "", pref: "", lefty: false });
      await loadPlayers(); viewSelectie();
      const last = $$("#pl .nm").find((i) => !i.value); last && last.focus();
    } catch { toast("Toevoegen lukte niet"); }
  };
}

// ---------- coaches ----------
function viewTeam() {
  state.match = null;
  const url = location.origin + location.pathname;
  app.innerHTML = `
    <div class="head"><div><h1>Coaches</h1><p class="note">Alleen deze mensen kunnen inloggen en het schema zien en bewerken.</p></div></div>
    <section>
      <div class="mlist">${state.members.map((m) => `
        <div class="mitem" style="grid-template-columns:1fr auto">
          <span class="mopp">${esc(m.name || m.email.split("@")[0])}<small>${esc(m.email)}${m.email === store.email() ? " · dit ben jij" : ""}</small></span>
          ${m.email === store.email() ? "" : `<button class="danger x" data-rm="${esc(m.email)}">Verwijderen</button>`}
        </div>`).join("") || '<p class="empty">Nog geen coaches.</p>'}</div>
    </section>
    <section>
      <h2>Coach uitnodigen</h2>
      <form id="f-inv" class="stack" novalidate>
        <div class="info">
          <label class="field"><span class="label">Naam</span><input id="inv-name" placeholder="Voornaam"></label>
          <label class="field"><span class="label">E-mailadres</span><input id="inv-email" type="email" placeholder="naam@voorbeeld.nl"></label>
        </div>
        <div><button type="submit">Uitnodigen</button></div>
        <p class="err" id="inv-err"></p>
      </form>
      <div id="inv-msg" class="stack" hidden>
        <p class="ok">Toegevoegd. Stuur deze tekst naar de nieuwe coach:</p>
        <textarea id="inv-text" rows="4" readonly></textarea>
        <div><button id="b-copy" class="ghost">Tekst kopiëren</button></div>
      </div>
    </section>`;
  $$("[data-rm]").forEach((b) => twoStep(b, async () => {
    try { await store.removeMember(b.dataset.rm); await loadMembers(); viewTeam(); } catch { toast("Verwijderen lukte niet"); }
  }, "Zeker weten?"));
  $("#f-inv").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#inv-email").value.trim().toLowerCase(), name = $("#inv-name").value.trim(), err = $("#inv-err");
    err.textContent = "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = "Vul een geldig e-mailadres in."; return; }
    if (state.members.some((m) => m.email === email)) { err.textContent = "Deze coach staat al op de lijst."; return; }
    try {
      await store.addMember(email, name);
      await loadMembers(); viewTeam();
      $("#inv-msg").hidden = false;
      $("#inv-text").value = `Hoi${name ? " " + name : ""}, je bent toegevoegd als coach aan het wisselschema van ${CONFIG.teamName}. Ga naar ${url}, kies "Account aanmaken" en gebruik dit e-mailadres: ${email}. Kies zelf een wachtwoord van minstens 8 tekens.`;
      $("#b-copy").onclick = async () => {
        try { await navigator.clipboard.writeText($("#inv-text").value); toast("Tekst gekopieerd"); }
        catch { $("#inv-text").select(); toast("Selecteer en kopieer de tekst"); }
      };
    } catch (ex) { err.textContent = "Uitnodigen lukte niet: " + (ex.message || ex); }
  };
}

boot();
