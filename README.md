# 📐 Mathe-Abgabe

Website, auf der Schüler ankreuzen, welche Mathe-Beispiele sie gemacht haben.
Die Lehrkraft sieht eine Übersicht, wer was abgegeben hat. Mit **Konten**: Schüler fragen ein Konto an,
die Lehrkraft nimmt die Anfrage an, und erst dann kann man sich anmelden.

Läuft auf normalem **PHP-Webhosting mit MySQL**, z. B. bei **World4You**.

## Funktionen

**Schüler** (`index.html`)
- **Konto anfragen**: Name, Klasse, Benutzername und Passwort. Anmelden geht erst, wenn die Lehrkraft die Anfrage angenommen hat.
- Aufgabenblatt wählen und erledigte Beispiele antippen, optional ein Kommentar.
- **Mehrmals abgeben**: Neue Beispiele werden zu den bisherigen dazugezählt. Schon abgegebene sind markiert, auch auf einem anderen Gerät.
- Live-Anzeige, wie viele Beispiele bis 80 % noch fehlen, und ein Countdown bis zur Frist.
- Das eigene Passwort lässt sich ändern.
- **❓ Fragen markieren**: Über „Frage markieren“ tippen Schüler die Beispiele an, bei denen sie etwas nicht verstanden haben.
  Optional schreiben sie dazu, was unklar ist. Das wird sofort gespeichert, auch ohne Abgabe und auch nach der Frist.

**Lehrkraft** (`lehrer.html`)
- **Konten**:
  - offene Anfragen annehmen oder ablehnen, auch „Alle annehmen“
  - Konten bearbeiten (Name, Klasse, Rolle), neues Passwort setzen, löschen
  - Konten selbst anlegen, z. B. für Kolleginnen und Kollegen (Rolle „Lehrkraft“)
- **Aufgabenblätter** gibst du so ein wie im Buch, mit Live-Vorschau. Es zählt immer die Nummer:
  - `2.16abc 3.18c 7.19` ergibt 3 Beispiele: 2.16 (abc), 3.18 (c) und 7.19
  - `2.16a b c` und `2.16a-c` bedeuten dasselbe wie `2.16abc`
  - `2.16-2.20` ergibt 5 Beispiele
- **80-%-Regel**: Ein Blatt gilt als erfüllt, wenn mindestens 80 % der Beispiele erledigt sind. Der Wert ist pro Blatt einstellbar.
- **Frist**: Nach Ablauf wird die Abgabe entweder gesperrt, oder späte Abgaben werden als „verspätet“ markiert.
- **Für Klasse**: Ein Blatt gilt für alle Klassen oder nur für eine bestimmte, z. B. 3B.
- **Gesamtübersicht**: Alle Schüler mal alle Blätter, und wie viele Blätter jeder erfüllt hat.
- **Blatt-Ansicht**:
  - Tabelle Schüler mal Beispiele (✓), Status „erfüllt“, „fehlt 2“ oder **„nichts abgegeben“**
  - Kommentare, einzelne Abgaben löschen
- **❓ Fragen**:
  - pro Blatt nach Beispiel gruppiert, die meistgefragten zuerst, gut zum Besprechen in der Stunde
  - in der Tabelle mit einem orangen „?“ markiert, am Tab mit der Zahl offener Fragen
  - mit „✓ beantwortet“ abhaken. Die Schüler sehen dann „beantwortet“, und wenn sie die Frage ändern, ist sie wieder offen.
- Filter nach Klasse und Name, CSV-Export (öffnet in Excel), die Seite aktualisiert sich von selbst.

## Installation auf World4You (oder anderem PHP-Webhosting)

Du brauchst ein Webhosting-Paket mit **PHP (ab 7.4, besser 8.x)** und **MySQL**.

1. **Datenbank anlegen.** Lege im World4You-Kundenbereich eine **MySQL-Datenbank** an und notiere dir:
   Datenbank-Server (Host), Datenbankname, Benutzer und Passwort.
2. **Konfiguration.** Kopiere im Ordner `public/` die Datei `config.sample.php` zu **`config.php`** und trag ein:
   ```php
   'db_dsn'  => 'mysql:host=DEIN-MYSQL-HOST;dbname=DEINE-DATENBANK;charset=utf8mb4',
   'db_user' => 'DEIN-DB-BENUTZER',
   'db_pass' => 'DEIN-DB-PASSWORT',
   'setup_code' => 'irgendein-langer-geheimer-code',
   ```
3. **Hochladen.** Lade den **Inhalt** des Ordners `public/` per FTP (z. B. mit FileZilla) in deinen Webspace,
   etwa in einen Ordner `mathe/`. Die versteckten Dateien `.htaccess` und `data/.htaccess` müssen mit hoch.
   In FileZilla blendest du sie über „Server → Anzeige versteckter Dateien erzwingen“ ein.
4. **HTTPS einschalten.** Aktiviere im Kundenbereich das (kostenlose) SSL-Zertifikat für deine Domain.
   Die `.htaccess` leitet dann automatisch auf `https://` um, damit Passwörter verschlüsselt übertragen werden.
5. **Ersteinrichtung.** Öffne `https://deine-domain.at/mathe/lehrer.html`. Beim ersten Aufruf erscheint
   „Ersteinrichtung“. Gib dort den `setup_code` aus der `config.php` ein und lege dein Lehrer-Konto an.
   Die Tabellen in der Datenbank werden automatisch erstellt.
6. **Schüler einladen.** Gib den Schülern den Link `https://deine-domain.at/mathe/`. Sie fragen dort ein Konto an,
   und du nimmst die Anfragen unter **👥 Konten** an.

**Hinweise**
- Der Ordner `data/` muss für PHP beschreibbar sein, weil dort die Login-Sitzungen gespeichert werden.
  Das ist normalerweise schon so.
- Wenn etwas nicht geht, setz in der `config.php` vorübergehend `'debug' => true`. Dann zeigt die Seite die genaue Fehlermeldung.
- Ohne MySQL: Mit `'db_dsn' => ''` landet alles in `data/abgabe.sqlite`. Das klappt aber nur, wenn PHP die SQLite-Erweiterung hat.
- **Sicherung**: im Kundenbereich die MySQL-Datenbank exportieren (z. B. über phpMyAdmin).

## Sicherheit

- Passwörter werden nur als Hash gespeichert (`password_hash`, bcrypt).
- Nach 5 falschen Passwörtern ist das Konto 5 Minuten gesperrt.
- Ein CSRF-Schutz verhindert, dass fremde Seiten Aktionen in deinem Namen auslösen.
- Das Session-Cookie ist `HttpOnly` und `SameSite=Lax`, bei HTTPS zusätzlich `Secure`.
- `config.php` und `data/` sind per `.htaccess` gesperrt.
- Das erste Lehrer-Konto lässt sich nur mit dem `setup_code` anlegen, und nur solange es noch keine Lehrkraft gibt.

## Lokal ausprobieren

```bash
cp public/config.sample.php public/config.php   # dann 'db_dsn' => '' setzen (SQLite)
npm start                                        # = php -S localhost:8000 -t public
```

Dann <http://localhost:8000/lehrer.html> öffnen.

## Demo auf GitHub Pages

Es gibt auch eine Demo, die ganz ohne Server läuft: Alle Daten bleiben im Browser (`localStorage`),
und es sind schon Beispieldaten mit 8 Schülern und 2 offenen Anfragen drin. Das Passwort ist überall `demo`,
oben gibt es Knöpfe zum schnellen Anmelden als Lehrkraft oder als Schülerin.
Die Demo eignet sich nur zum Ausprobieren und Herzeigen, nicht für echte Abgaben.

Einrichten (einmalig): Im Repo unter **Settings → Pages → Source** „**GitHub Actions**“ auswählen.
Der Workflow `.github/workflows/pages.yml` baut die Demo dann bei jedem Push.
Die Demo bildet die PHP-API in `demo/demo.js` nach. Lokal baust du sie mit `npm run build:pages` nach `_site/`.

## Tests

```bash
npm test   # startet api.php mit dem eingebauten PHP-Server (SQLite) und testet die ganze API
```

Gegen MySQL testen (die Datenbank muss leer sein):

```bash
TEST_DB_DSN='mysql:host=127.0.0.1;dbname=test;charset=utf8mb4' TEST_DB_USER=… TEST_DB_PASS=… npm test
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `public/api.php` | Backend: Konten, Login, Blätter, Abgaben (PHP + PDO) |
| `public/config.sample.php` | Vorlage für `config.php` (Datenbank, Einrichtungs-Code) |
| `public/index.html`, `app.js` | Schülerseite |
| `public/lehrer.html`, `lehrer.js` | Lehrerbereich |
| `public/core.js` | Erkennt Beispiele aus der Eingabe (`2.16abc` …) |
| `public/common.js`, `style.css` | Gemeinsame Funktionen und Aussehen |
| `demo/demo.js` | Nachbau der API im Browser für die GitHub-Pages-Demo |
