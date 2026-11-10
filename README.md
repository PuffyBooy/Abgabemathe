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
- Aufgabenblätter anlegen: Aufgaben als `1-10, 11a, 11b` eingeben
- **Zeitlimit**: Frist als Datum/Uhrzeit oder per Knopf „+10/+20/+45/+90 Min“ ab jetzt
- Nach Ablauf entweder sperren oder späte Abgaben als „verspätet“ markieren
- Blätter verstecken/freigeben, bearbeiten, löschen
- **Gesamtübersicht**: alle Schüler × alle Blätter (z. B. `6/10`) mit Fortschritt
- **Blatt-Ansicht**: Tabelle Schüler × Aufgaben (✓), wie viele jede Aufgabe haben,
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

## Online stellen

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
