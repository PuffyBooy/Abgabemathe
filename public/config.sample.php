<?php
// Konfiguration für Mathe-Abgabe.
// Diese Datei zu "config.php" kopieren und ausfüllen. config.php NICHT veröffentlichen.

return [
    // ---- Datenbank (MySQL bei World4You) ----
    // Die Daten findest du im World4You-Kundenbereich unter "MySQL-Datenbanken".
    // Beispiel: 'mysql:host=mysqlsvr12.world4you.com;dbname=1234567db1;charset=utf8mb4'
    'db_dsn'  => 'mysql:host=DEIN-MYSQL-SERVER;dbname=DEINE-DATENBANK;charset=utf8mb4',
    'db_user' => 'DEIN-DB-BENUTZER',
    'db_pass' => 'DEIN-DB-PASSWORT',

    // Alternative ohne MySQL: 'db_dsn' => '' speichert alles in data/abgabe.sqlite
    // (funktioniert nur, wenn PHP die SQLite-Erweiterung hat).

    // Einrichtungs-Code: wird einmalig gebraucht, um das erste Lehrer-Konto anzulegen.
    // Bitte etwas Eigenes, Langes eintragen!
    'setup_code' => 'BITTE-AENDERN',

    // Name des Login-Cookies (nur ändern, wenn mehrere Installationen auf einer Domain laufen)
    'session_name' => 'mathe_abgabe',

    // Ordner für Sitzungen (und SQLite-Datenbank). Standard: data/ neben api.php
    // 'data_dir' => __DIR__ . '/data',

    // true zeigt genaue Fehlermeldungen – nur zum Testen einschalten
    'debug' => false,
];
