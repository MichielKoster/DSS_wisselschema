# Wisselschema D-jeugd

Webapp voor het wisselschema van een handbalteam in de D-jeugd: 2 × 20 minuten, elke 5 minuten wisselen, met een mini break na 10 en 30 minuten.

- Vul per wedstrijd de **basisopstelling** in. De app rekent de wissels door: elke 5 minuten gaan de speelsters van de bank erin. Met 10 speelsters zijn dat 3 wissels per keer.
- **Posities rouleren** na de mini breaks en de rust. Een linkshandige speelster staat alleen op rechtsopbouw of rechtshoek.
- Alle **wedstrijden worden bewaard**. Een nieuwe wedstrijd neemt de selectie en de basis van de vorige wedstrijd over.
- **Afdrukken** levert één A4 (liggend) op met het schema en de wisselmomenten.
- Coaches **loggen in met e-mail en wachtwoord**. Alleen uitgenodigde coaches kunnen een account maken, en wijzigingen zijn direct zichtbaar voor de anderen.

De app is een statische website (HTML, CSS en JavaScript) voor GitHub Pages. De gegevens en de inlog staan in een gratis Supabase-project.

---

## Eenmalig instellen (ongeveer 15 minuten)

### 1. Supabase-project aanmaken
1. Maak een gratis account aan op [supabase.com](https://supabase.com) en kies **New project**.
2. Geef het project een naam (bijv. `wisselschema`), kies een databasewachtwoord en kies als regio **Central EU (Frankfurt)**.

### 2. Database klaarzetten
1. Open in Supabase **SQL Editor → New query**.
2. Kopieer de inhoud van [`supabase/schema.sql`](supabase/schema.sql) en plak die in het venster.
3. Vervang op de **laatste regel** `jouw.naam@voorbeeld.nl` en `Jouw naam` door je eigen e-mailadres en naam. Jij wordt de eerste coach.
4. Klik op **Run**. Je moet "Success" zien.

### 3. Inloggen instellen
1. Ga naar **Authentication → URL Configuration**.
2. Vul bij **Site URL** het adres van de app in: `https://<jouw-github-naam>.github.io/<repo-naam>/`
3. Voeg hetzelfde adres toe onder **Redirect URLs**.
4. Bij **Authentication → Providers → Email** moet *Email* aan staan. *Confirm email* mag aan blijven: nieuwe coaches bevestigen dan eerst hun adres.

### 4. Sleutels invullen
1. Ga naar **Project Settings → API**.
2. Kopieer de **Project URL** en de **anon public** key naar [`js/config.js`](js/config.js):
   ```js
   export const CONFIG = {
     supabaseUrl: "https://xxxx.supabase.co",
     supabaseAnonKey: "eyJ...",
     teamName: "D2",
   };
   ```
   De *anon* key mag openbaar in de code staan, want de database laat alleen ingelogde coaches toe. Zet de **service_role** key nooit in de code.

### 5. Publiceren met GitHub Pages
1. Ga in de repository naar **Settings → Pages**.
2. Kies bij *Source* **Deploy from a branch**, met branch `main` en map `/ (root)`. Klik op Save.
3. Na een minuut staat de app op `https://<jouw-github-naam>.github.io/<repo-naam>/`.

### 6. Eerste keer inloggen
1. Open de app en kies **Account aanmaken**. Gebruik het e-mailadres uit stap 2 en kies een wachtwoord.
2. Bevestig je e-mailadres via de mail van Supabase en log in.
3. Ga naar **Coaches** om de andere coaches uit te nodigen. De app maakt een tekst die je via WhatsApp of mail kunt doorsturen. Zij maken zelf een account aan met hun eigen wachtwoord.

Op de telefoon kun je de app via het deelmenu toevoegen aan het beginscherm.

---

## Goed om te weten
- **Gratis Supabase pauzeert na 7 dagen zonder gebruik.** Tijdens het seizoen gebeurt dat dus niet snel. Is het project toch gepauzeerd (bijvoorbeeld na de winterstop), klik dan in het Supabase-dashboard op *Restore project*.
- Als twee coaches tegelijk **dezelfde wedstrijd** bewerken, blijft de laatst opgeslagen versie staan. De andere coach ziet de wijziging direct.
- Wachtwoord vergeten? Kies op het inlogscherm **Wachtwoord vergeten** en volg de link in de mail.
- Een coach verwijderen kan onder **Coaches**. Diegene kan dan niets meer zien of wijzigen. Het account zelf verwijder je in Supabase onder *Authentication → Users*.

---

## Voor wie aan de code werkt

```
index.html            pagina
css/styles.css        opmaak (ook de printversie)
js/config.js          Supabase-gegevens en teamnaam
js/schedule.js        rekenlogica voor het wisselschema (zonder DOM, getest)
js/store.js           opslag: Supabase, of lokaal in de browser als config leeg is
js/app.js             schermen en interactie
supabase/schema.sql   tabellen, toegangsregels en uitnodigingscontrole
tests/                tests voor de rekenlogica
```

**Lokaal draaien.** Laat `js/config.js` leeg om in lokale modus te werken (zonder inloggen; gegevens blijven in je browser):
```
python3 -m http.server 8000
```
Open daarna http://localhost:8000.

**Testen.** Met Node 20 of hoger:
```
npm test
```
De tests draaien ook automatisch bij elke push (GitHub Actions).

**Samenwerken.** Maak voor een wijziging een eigen branch en open een pull request naar `main`. Na het samenvoegen staat de nieuwe versie binnen een minuut online.
