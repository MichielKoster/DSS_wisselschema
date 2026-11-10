// Opslag. Met Supabase ingesteld in config.js worden gegevens gedeeld en is inloggen nodig.
// Zonder config draait de app in "lokale modus": alles blijft in deze browser (handig om te testen).
import { CONFIG } from "./config.js";

export const uid = () =>
  (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const MATCH_COLS = "id,match_date,start_time,opponent,home,updated_at,updated_by";

function toMatchRow(m, email) {
  return {
    id: m.id,
    match_date: m.match_date || null,
    start_time: m.start_time || null,
    opponent: m.opponent || "",
    home: m.home !== false,
    data: m.data || {},
    updated_by: email || null,
  };
}

// ---------- Supabase ----------
function supabaseStore() {
  const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });
  const redirect = () => location.origin + location.pathname;
  const must = ({ data, error }) => { if (error) throw error; return data; };
  let email = null;

  return {
    mode: "supabase",
    async session() {
      const { data } = await sb.auth.getSession();
      email = data.session?.user?.email || null;
      return data.session;
    },
    email: () => email,
    onAuth(cb) {
      sb.auth.onAuthStateChange((event, session) => { email = session?.user?.email || null; cb(event, session); });
    },
    async signIn(e, pw) { must(await sb.auth.signInWithPassword({ email: e, password: pw })); },
    async signUp(e, pw) {
      const d = must(await sb.auth.signUp({ email: e, password: pw, options: { emailRedirectTo: redirect() } }));
      return { needsConfirm: !d.session };
    },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(e) { must(await sb.auth.resetPasswordForEmail(e, { redirectTo: redirect() })); },
    async updatePassword(pw) { must(await sb.auth.updateUser({ password: pw })); },
    async isMember() {
      const rows = must(await sb.from("team_members").select("email").ilike("email", email || "").limit(1));
      return rows.length > 0;
    },

    async listPlayers() { return must(await sb.from("players").select("*").order("nr", { ascending: true })); },
    async savePlayer(p) { return must(await sb.from("players").upsert(p).select().single()); },
    async removePlayer(id) { must(await sb.from("players").delete().eq("id", id)); },

    async listMatches() {
      return must(await sb.from("matches").select(MATCH_COLS)
        .order("match_date", { ascending: false, nullsFirst: true }).order("updated_at", { ascending: false }));
    },
    async getMatch(id) { return must(await sb.from("matches").select("*").eq("id", id).maybeSingle()); },
    async saveMatch(m) { return must(await sb.from("matches").upsert(toMatchRow(m, email)).select().single()); },
    async removeMatch(id) { must(await sb.from("matches").delete().eq("id", id)); },

    async listMembers() { return must(await sb.from("team_members").select("*").order("created_at")); },
    async addMember(e, name) {
      must(await sb.from("team_members").insert({ email: e.trim().toLowerCase(), name: name || null, added_by: email }));
    },
    async removeMember(e) { must(await sb.from("team_members").delete().eq("email", e)); },

    subscribe(cb) {
      sb.channel("wisselschema")
        .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, (p) => cb("matches", p))
        .on("postgres_changes", { event: "*", schema: "public", table: "players" }, (p) => cb("players", p))
        .subscribe();
    },
  };
}

// ---------- Lokaal (zonder Supabase) ----------
function localStore() {
  const K = { players: "ws_players", matches: "ws_matches", members: "ws_members" };
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* opslag niet beschikbaar */ } };
  const now = () => new Date().toISOString();
  const EMAIL = "lokaal@dit-apparaat";

  return {
    mode: "local",
    async session() { return { user: { email: EMAIL } }; },
    email: () => EMAIL,
    onAuth() {},
    async signIn() {}, async signUp() { return {}; }, async signOut() {},
    async resetPassword() {}, async updatePassword() {},
    async isMember() { return true; },

    async listPlayers() { return read(K.players).sort((a, b) => (+a.nr || 99) - (+b.nr || 99)); },
    async savePlayer(p) {
      const all = read(K.players); const row = { ...p, id: p.id || uid(), updated_at: now() };
      const i = all.findIndex((x) => x.id === row.id); if (i >= 0) all[i] = row; else all.push(row);
      write(K.players, all); return row;
    },
    async removePlayer(id) { write(K.players, read(K.players).filter((p) => p.id !== id)); },

    async listMatches() {
      return read(K.matches).map(({ data, ...rest }) => rest)
        .sort((a, b) => (b.match_date || "9999").localeCompare(a.match_date || "9999") || b.updated_at.localeCompare(a.updated_at));
    },
    async getMatch(id) { return read(K.matches).find((m) => m.id === id) || null; },
    async saveMatch(m) {
      const all = read(K.matches); const row = { ...toMatchRow(m, EMAIL), updated_at: now() };
      const i = all.findIndex((x) => x.id === row.id); if (i >= 0) all[i] = row; else all.push(row);
      write(K.matches, all); return row;
    },
    async removeMatch(id) { write(K.matches, read(K.matches).filter((m) => m.id !== id)); },

    async listMembers() { return read(K.members); },
    async addMember(e, name) {
      const all = read(K.members);
      if (!all.some((m) => m.email === e)) all.push({ email: e.trim().toLowerCase(), name, added_by: EMAIL, created_at: now() });
      write(K.members, all);
    },
    async removeMember(e) { write(K.members, read(K.members).filter((m) => m.email !== e)); },

    subscribe(cb) {
      addEventListener("storage", (ev) => {
        if (ev.key === K.matches) cb("matches", {});
        if (ev.key === K.players) cb("players", {});
      });
    },
  };
}

export const store = (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && window.supabase)
  ? supabaseStore() : localStore();
