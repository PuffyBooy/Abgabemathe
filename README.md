# 📐 Mathe-Abgabe

Kleine Website, auf der Schüler ankreuzen, welche Mathe-Aufgaben sie gemacht haben.
Der Lehrer sieht eine zusammengefasste Übersicht, wer was abgegeben hat.

## Funktionen

**Schüler** (`/`)
- Name + Klasse eingeben (wird im Browser gemerkt)
- Aufgabenblatt wählen und erledigte Aufgaben antippen, optional Kommentar
- **Mehrmals abgeben**: neue Aufgaben werden zu den bisherigen dazugezählt
- Countdown bis zur Abgabefrist

**Lehrer** (`/lehrer`, mit Passwort)
- Aufgabenblätter anlegen, Aufgaben so eingeben wie im Buch – mit Live-Vorschau:
  - `2.16a b 3.18c 7.19` → 2.16a, 2.16b, 3.18c, 7.19
  - `2.16a-d` → 2.16a bis 2.16d · `2.16-2.20` → 2.16 bis 2.20
- **80 %-Regel**: Ein Blatt gilt als erfüllt, wenn mindestens 80 % der Aufgaben erledigt sind
  (pro Blatt einstellbar). Schüler sehen live, wie viele noch fehlen.
- **Zeitlimit**: Frist als Datum/Uhrzeit (Knöpfe „Morgen 8:00“, „In 1 Woche“ …)
- Nach Ablauf entweder sperren oder späte Abgaben als „verspätet“ markieren
- Blätter verstecken/freigeben, bearbeiten, löschen
- **Gesamtübersicht**: alle Schüler × alle Blätter (z. B. `8/10 ✓`) und wie viele Blätter jeder erfüllt hat
- **Blatt-Ansicht**: Tabelle Schüler × Aufgaben (✓), Status „erfüllt“ / „fehlt 2“, wie viele jede Aufgabe haben,
  Durchschnitt, Anzahl Abgaben, verspätete Abgaben, Kommentare, einzelne Abgaben löschen
- Filter nach Klasse und Name, CSV-Export (öffnet in Excel), aktualisiert sich automatisch

## Starten

Benötigt nur [Node.js](https://nodejs.org) ab Version 18 – keine weiteren Pakete.

```bash
TEACHER_PASSWORD=meinPasswort npm start
```

Dann im Browser öffnen: <http://localhost:3000> (Schüler) und <http://localhost:3000/lehrer> (Lehrer).
Ohne `TEACHER_PASSWORD` ist das Passwort `lehrer123` – bitte ändern!

| Variable           | Bedeutung                         | Standard    |
|--------------------|-----------------------------------|-------------|
| `TEACHER_PASSWORD` | Passwort für den Lehrerbereich    | `lehrer123` |
| `PORT`             | Port des Servers                  | `3000`      |
| `DATA_DIR`         | Ordner für die Daten (`db.json`)  | `./data`    |

Alle Daten liegen in `data/db.json`. Zum Sichern einfach die Datei kopieren.

## Demo auf GitHub Pages

Es gibt eine Demo-Version, die ganz ohne Server läuft: Alle Daten bleiben im Browser
(`localStorage`), es sind schon Beispieldaten drin, und das Lehrer-Passwort ist `demo`.
Gut zum Ausprobieren und Herzeigen – **für echte Abgaben aber nicht geeignet**, weil jeder
Browser seine eigenen Daten hat und der Lehrer die Abgaben der Schüler nicht sieht.

Einrichten (einmalig): im Repo unter **Settings → Pages → Build and deployment → Source**
„**GitHub Actions**“ auswählen. Danach baut der Workflow `.github/workflows/pages.yml` die Demo
bei jedem Push automatisch (oder manuell unter *Actions → Demo auf GitHub Pages → Run workflow*).
Die Seite ist dann unter `https://<benutzername>.github.io/Abgabemathe/` erreichbar.

Lokal bauen: `npm run build:pages` erzeugt den Ordner `_site/`.
Die Demo nutzt dieselbe Logik wie der Server (`public/core.js`), nur die Speicherung ist anders (`demo/demo.js`).

## Online stellen (echter Betrieb)

Die Seite braucht einen kleinen Server (GitHub Pages reicht nicht, weil Abgaben gespeichert werden).
Geht z. B. mit Render, Railway, Fly.io oder einem eigenen Rechner/Raspberry Pi im Schulnetz:
Startbefehl `npm start`, Umgebungsvariable `TEACHER_PASSWORD` setzen und – falls der Anbieter das
Dateisystem bei Neustarts löscht – `DATA_DIR` auf ein dauerhaftes Laufwerk (Volume/Disk) zeigen lassen.

## Test

```bash
npm test
```

## Hinweis

Schüler melden sich nur mit Namen an (kein Konto). Gleicher Name + Klasse = gleicher Schüler,
Groß-/Kleinschreibung und Leerzeichen sind egal. Theoretisch könnte also jemand unter fremdem
Namen abgeben – für eine Ankreuzliste ist das meist in Ordnung.
