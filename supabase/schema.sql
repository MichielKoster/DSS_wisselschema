-- Wisselschema: database voor Supabase.
-- Plak dit hele bestand in Supabase → SQL Editor → New query, en klik op Run.
-- Pas daarna de laatste regel aan met je eigen e-mailadres (de eerste coach).

-- 1. Coaches die toegang hebben (de uitnodigingslijst)
create table if not exists public.team_members (
  email       text primary key check (email = lower(email)),
  name        text,
  added_by    text,
  created_at  timestamptz not null default now()
);

-- 2. Vaste selectie van het team
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  nr          text default '',
  name        text not null default '',
  pref        text default '',
  lefty       boolean not null default false,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3. Wedstrijden; het schema zelf staat in de kolom data (json)
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  match_date  date,
  start_time  text,
  opponent    text default '',
  home        boolean not null default true,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- updated_at automatisch bijwerken
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists players_touch on public.players;
create trigger players_touch before update on public.players for each row execute function public.touch_updated_at();
drop trigger if exists matches_touch on public.matches;
create trigger matches_touch before update on public.matches for each row execute function public.touch_updated_at();

-- Is de ingelogde gebruiker een coach van het team?
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where email = lower(auth.jwt() ->> 'email'));
$$;

-- Alleen uitgenodigde e-mailadressen mogen een account aanmaken.
create or replace function public.check_invited() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.team_members where email = lower(new.email)) then
    raise exception 'Dit e-mailadres is niet uitgenodigd';
  end if;
  return new;
end $$;
drop trigger if exists check_invited on auth.users;
create trigger check_invited before insert on auth.users for each row execute function public.check_invited();

-- Toegangsregels: alleen coaches lezen en schrijven.
alter table public.team_members enable row level security;
alter table public.players      enable row level security;
alter table public.matches      enable row level security;

drop policy if exists "coaches lezen leden"       on public.team_members;
drop policy if exists "coaches nodigen uit"       on public.team_members;
drop policy if exists "coaches verwijderen leden" on public.team_members;
create policy "coaches lezen leden"       on public.team_members for select to authenticated using (public.is_member());
create policy "coaches nodigen uit"       on public.team_members for insert to authenticated with check (public.is_member());
create policy "coaches verwijderen leden" on public.team_members for delete to authenticated
  using (public.is_member() and email <> lower(auth.jwt() ->> 'email'));

drop policy if exists "coaches selectie" on public.players;
create policy "coaches selectie" on public.players for all to authenticated
  using (public.is_member()) with check (public.is_member());

drop policy if exists "coaches wedstrijden" on public.matches;
create policy "coaches wedstrijden" on public.matches for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- Live bijwerken als een andere coach iets wijzigt
do $$ begin
  begin alter publication supabase_realtime add table public.matches; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.players; exception when duplicate_object then null; end;
end $$;
alter table public.matches replica identity full;

-- Eerste coach (pas het e-mailadres en de naam aan voordat je op Run klikt)
insert into public.team_members (email, name) values ('jouw.naam@voorbeeld.nl', 'Jouw naam')
  on conflict (email) do nothing;
