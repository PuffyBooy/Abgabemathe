<?php
// Mathe-Abgabe – Backend für PHP-Webhosting (z. B. World4You).
// Alle Anfragen laufen über api.php?r=<pfad>, z. B. api.php?r=sheets oder api.php?r=admin/data.
// Benötigt PHP >= 7.4 mit PDO (MySQL oder SQLite).

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

class ApiError extends Exception
{
    public $status;
    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

function respond(int $status, $data): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ---------- Konfiguration ----------

$configFile = getenv('ABGABE_CONFIG') ?: __DIR__ . '/config.php';
if (!is_file($configFile)) {
    respond(500, ['error' => 'config.php fehlt. Bitte config.sample.php zu config.php kopieren und ausfüllen.']);
}
$config = require $configFile;
$dataDir = $config['data_dir'] ?? (__DIR__ . '/data');

// ---------- Hilfsfunktionen ----------

function nowIso(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function newId(): string
{
    return bin2hex(random_bytes(8));
}

function clean($value, int $max): string
{
    $s = trim(preg_replace('/\s+/u', ' ', (string) ($value ?? '')) ?? '');
    return function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max);
}

function isoOrNull($value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    try {
        $d = new DateTime((string) $value);
    } catch (Exception $e) {
        return null;
    }
    $d->setTimezone(new DateTimeZone('UTC'));
    return $d->format('Y-m-d\TH:i:s\Z');
}

function isPast(?string $iso): bool
{
    return $iso !== null && time() > strtotime($iso);
}

function body(): array
{
    static $body = null;
    if ($body === null) {
        $raw = file_get_contents('php://input', false, null, 0, 200000);
        $body = $raw ? json_decode($raw, true) : [];
        if (!is_array($body)) {
            throw new ApiError(400, 'Ungültige Anfrage.');
        }
    }
    return $body;
}

// ---------- Datenbank ----------

function db(): PDO
{
    global $config, $dataDir;
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $dsn = $config['db_dsn'] ?? '';
    if ($dsn === '') {
        if (!is_dir($dataDir)) {
            mkdir($dataDir, 0700, true);
        }
        $dsn = 'sqlite:' . $dataDir . '/abgabe.sqlite';
    }
    $pdo = new PDO($dsn, $config['db_user'] ?? null, $config['db_pass'] ?? null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    ensureSchema($pdo);
    return $pdo;
}

function ensureSchema(PDO $pdo): void
{
    $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    $suffix = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(32) NOT NULL PRIMARY KEY,
        username VARCHAR(40) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(80) NOT NULL,
        klasse VARCHAR(30) NOT NULL DEFAULT '',
        role VARCHAR(10) NOT NULL DEFAULT 'student',
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        created_at VARCHAR(30) NOT NULL,
        approved_at VARCHAR(30) NULL,
        failed_logins INT NOT NULL DEFAULT 0,
        locked_until VARCHAR(30) NULL
    )$suffix");
    $pdo->exec("CREATE TABLE IF NOT EXISTS sheets (
        id VARCHAR(32) NOT NULL PRIMARY KEY,
        title VARCHAR(120) NOT NULL,
        description TEXT NULL,
        klasse VARCHAR(30) NOT NULL DEFAULT '',
        tasks TEXT NOT NULL,
        task_parts TEXT NOT NULL,
        deadline VARCHAR(30) NULL,
        lock_after INT NOT NULL DEFAULT 0,
        is_open INT NOT NULL DEFAULT 1,
        min_percent INT NOT NULL DEFAULT 80,
        created_at VARCHAR(30) NOT NULL
    )$suffix");
    $pdo->exec("CREATE TABLE IF NOT EXISTS submissions (
        id VARCHAR(32) NOT NULL PRIMARY KEY,
        sheet_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        tasks TEXT NOT NULL,
        comment TEXT NULL,
        created_at VARCHAR(30) NOT NULL,
        late INT NOT NULL DEFAULT 0
    )$suffix");
    // Fragen: Schüler markieren Beispiele, bei denen sie etwas nicht verstanden haben
    $pdo->exec("CREATE TABLE IF NOT EXISTS questions (
        id VARCHAR(32) NOT NULL PRIMARY KEY,
        sheet_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        task VARCHAR(40) NOT NULL,
        text TEXT NULL,
        created_at VARCHAR(30) NOT NULL,
        updated_at VARCHAR(30) NOT NULL,
        resolved_at VARCHAR(30) NULL
    )$suffix");
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

// ---------- Session & Anmeldung ----------

function startSession(): void
{
    global $config, $dataDir;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $path = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/';
    $lifetime = 60 * 60 * 24 * 14; // 14 Tage angemeldet bleiben

    // Eigener Session-Ordner, damit das Hosting die Sessions nicht vorzeitig löscht
    $sessionDir = $dataDir . '/sessions';
    if (!is_dir($sessionDir)) {
        @mkdir($sessionDir, 0700, true);
    }
    if (is_dir($sessionDir) && is_writable($sessionDir)) {
        session_save_path($sessionDir);
        ini_set('session.gc_maxlifetime', (string) $lifetime);
    }
    session_name($config['session_name'] ?? 'mathe_abgabe');
    session_set_cookie_params([
        'lifetime' => $lifetime,
        'path' => $path,
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
}

function publicUser(array $u): array
{
    return [
        'id' => $u['id'],
        'username' => $u['username'],
        'name' => $u['name'],
        'klasse' => $u['klasse'],
        'role' => $u['role'],
        'status' => $u['status'],
        'createdAt' => $u['created_at'],
        'approvedAt' => $u['approved_at'],
    ];
}

function currentUser(): ?array
{
    if (empty($_SESSION['uid'])) {
        return null;
    }
    $u = q('SELECT * FROM users WHERE id = ?', [$_SESSION['uid']])->fetch();
    if (!$u || $u['status'] !== 'active') {
        unset($_SESSION['uid']);
        return null;
    }
    return $u;
}

function requireUser(): array
{
    $u = currentUser();
    if (!$u) {
        throw new ApiError(401, 'Bitte melde dich an.');
    }
    return $u;
}

function requireTeacher(): array
{
    $u = requireUser();
    if ($u['role'] !== 'teacher') {
        throw new ApiError(403, 'Nur für Lehrkräfte.');
    }
    return $u;
}

function validUsername($value): string
{
    $u = strtolower(clean($value, 40));
    if (!preg_match('/^[a-z0-9._-]{3,30}$/', $u)) {
        throw new ApiError(400, 'Benutzername: 3–30 Zeichen, nur Buchstaben a–z, Zahlen, Punkt, Minus oder Unterstrich.');
    }
    return $u;
}

function validPassword($value): string
{
    $p = (string) ($value ?? '');
    if (strlen($p) < 6) {
        throw new ApiError(400, 'Das Passwort muss mindestens 6 Zeichen haben.');
    }
    if (strlen($p) > 200) {
        throw new ApiError(400, 'Das Passwort ist zu lang.');
    }
    return $p;
}

function validName($value): string
{
    $n = clean($value, 80);
    if (function_exists('mb_strlen') ? mb_strlen($n) < 3 : strlen($n) < 3) {
        throw new ApiError(400, 'Bitte Vor- und Nachnamen angeben.');
    }
    return $n;
}

function validKlasse($value): string
{
    $k = clean($value, 30);
    return function_exists('mb_strtoupper') ? mb_strtoupper($k, 'UTF-8') : strtoupper($k);
}

function usernameTaken(string $username, string $exceptId = ''): bool
{
    return (bool) q('SELECT id FROM users WHERE username = ? AND id <> ?', [$username, $exceptId])->fetch();
}

// ---------- Aufgabenblätter ----------

function canSubmit(array $s): bool
{
    if (!(int) $s['is_open']) {
        return false;
    }
    return !((int) $s['lock_after'] && isPast($s['deadline']));
}

function requiredCount(array $s): int
{
    $n = count(json_decode($s['tasks'], true) ?: []);
    return (int) ceil($n * (int) $s['min_percent'] / 100 - 1e-9);
}

function sheetOut(array $s): array
{
    return [
        'id' => $s['id'],
        'title' => $s['title'],
        'description' => $s['description'] ?? '',
        'klasse' => $s['klasse'],
        'tasks' => json_decode($s['tasks'], true) ?: [],
        'taskParts' => (object) (json_decode($s['task_parts'], true) ?: []),
        'deadline' => $s['deadline'],
        'lockAfterDeadline' => (bool) (int) $s['lock_after'],
        'open' => (bool) (int) $s['is_open'],
        'minPercent' => (int) $s['min_percent'],
        'required' => requiredCount($s),
        'acceptsSubmissions' => canSubmit($s),
        'createdAt' => $s['created_at'],
    ];
}

// Liest Blatt-Daten aus der Anfrage. Die Beispiele werden im Browser aus der Eingabe erkannt
// (core.js) und hier nur noch geprüft.
function sheetFields(array $b, ?array $existing): array
{
    $f = [];
    $f['title'] = clean($b['title'] ?? ($existing['title'] ?? ''), 120);
    if ($f['title'] === '') {
        throw new ApiError(400, 'Bitte einen Titel angeben.');
    }
    $f['description'] = clean($b['description'] ?? ($existing['description'] ?? ''), 500);
    $f['klasse'] = array_key_exists('klasse', $b) ? validKlasse($b['klasse']) : ($existing['klasse'] ?? '');

    if (array_key_exists('tasks', $b)) {
        if (!is_array($b['tasks'])) {
            throw new ApiError(400, 'Ungültige Beispiele.');
        }
        $tasks = [];
        foreach ($b['tasks'] as $t) {
            $t = clean($t, 40);
            if ($t !== '' && !in_array($t, $tasks, true)) {
                $tasks[] = $t;
            }
        }
        $tasks = array_slice($tasks, 0, 300);
        $parts = [];
        if (isset($b['taskParts']) && is_array($b['taskParts'])) {
            foreach ($b['taskParts'] as $id => $letters) {
                if (!in_array((string) $id, $tasks, true) || !is_array($letters)) {
                    continue;
                }
                $ok = [];
                foreach ($letters as $l) {
                    $l = strtolower(clean($l, 1));
                    if (preg_match('/^[a-z]$/', $l) && !in_array($l, $ok, true)) {
                        $ok[] = $l;
                    }
                }
                if ($ok) {
                    $parts[(string) $id] = $ok;
                }
            }
        }
        $f['tasks'] = json_encode($tasks, JSON_UNESCAPED_UNICODE);
        $f['task_parts'] = json_encode((object) $parts, JSON_UNESCAPED_UNICODE);
    } else {
        $f['tasks'] = $existing['tasks'] ?? '[]';
        $f['task_parts'] = $existing['task_parts'] ?? '{}';
    }
    if (!json_decode($f['tasks'], true)) {
        throw new ApiError(400, 'Bitte mindestens ein Beispiel angeben.');
    }
    $f['deadline'] = array_key_exists('deadline', $b) ? isoOrNull($b['deadline']) : ($existing['deadline'] ?? null);
    $f['lock_after'] = array_key_exists('lockAfterDeadline', $b) ? (int) (bool) $b['lockAfterDeadline'] : (int) ($existing['lock_after'] ?? 0);
    $f['is_open'] = array_key_exists('open', $b) ? (int) (bool) $b['open'] : (int) ($existing['is_open'] ?? 1);
    $f['min_percent'] = array_key_exists('minPercent', $b)
        ? max(1, min(100, (int) round((float) $b['minPercent']) ?: 80))
        : (int) ($existing['min_percent'] ?? 80);
    return $f;
}

function sheetVisibleFor(array $s, array $user): bool
{
    return (int) $s['is_open'] && ($s['klasse'] === '' || strcasecmp($s['klasse'], $user['klasse']) === 0);
}

// Eigene Fragen eines Schülers zu einem Blatt, in der Reihenfolge der Beispiele
function myQuestions(array $s, string $userId): array
{
    $tasks = json_decode($s['tasks'], true) ?: [];
    $byTask = [];
    foreach (q('SELECT * FROM questions WHERE sheet_id = ? AND user_id = ?', [$s['id'], $userId]) as $row) {
        $byTask[$row['task']] = $row;
    }
    $out = [];
    foreach ($tasks as $t) {
        if (isset($byTask[$t])) {
            $out[] = ['task' => $t, 'text' => $byTask[$t]['text'] ?? '', 'resolved' => $byTask[$t]['resolved_at'] !== null];
        }
    }
    return $out;
}

function doneTasksOf(string $sheetId, string $userId): array
{
    $done = [];
    $count = 0;
    foreach (q('SELECT tasks FROM submissions WHERE sheet_id = ? AND user_id = ?', [$sheetId, $userId]) as $row) {
        $count++;
        foreach (json_decode($row['tasks'], true) ?: [] as $t) {
            $done[$t] = true;
        }
    }
    return [$done, $count];
}

// ---------- Routen ----------

function route(string $method, array $p): array
{
    $n = count($p);
    $r0 = $p[0] ?? '';

    // Status: wer ist angemeldet? Muss das System noch eingerichtet werden?
    if ($method === 'GET' && $r0 === 'me') {
        $u = currentUser();
        $hasTeacher = (bool) q("SELECT id FROM users WHERE role = 'teacher' LIMIT 1")->fetch();
        return [200, [
            'user' => $u ? publicUser($u) : null,
            'csrf' => $_SESSION['csrf'],
            'setupNeeded' => !$hasTeacher,
            'serverTime' => nowIso(),
        ]];
    }

    // Ersteinrichtung: erstes Lehrer-Konto anlegen (nur mit Einrichtungs-Code aus config.php)
    if ($method === 'POST' && $r0 === 'setup') {
        global $config;
        if (q("SELECT id FROM users WHERE role = 'teacher' LIMIT 1")->fetch()) {
            throw new ApiError(403, 'Das System ist schon eingerichtet.');
        }
        $b = body();
        $code = (string) ($config['setup_code'] ?? '');
        if ($code === '' || $code === 'BITTE-AENDERN' || !hash_equals($code, (string) ($b['code'] ?? ''))) {
            throw new ApiError(403, 'Falscher Einrichtungs-Code (siehe setup_code in config.php).');
        }
        $username = validUsername($b['username'] ?? '');
        $id = newId();
        q('INSERT INTO users (id, username, password_hash, name, klasse, role, status, created_at, approved_at) VALUES (?,?,?,?,?,?,?,?,?)', [
            $id, $username, password_hash(validPassword($b['password'] ?? ''), PASSWORD_DEFAULT),
            validName($b['name'] ?? ''), '', 'teacher', 'active', nowIso(), nowIso(),
        ]);
        session_regenerate_id(true);
        $_SESSION['uid'] = $id;
        return [201, ['ok' => true]];
    }

    // Konto anfragen (Schüler)
    if ($method === 'POST' && $r0 === 'register') {
        $b = body();
        $name = validName($b['name'] ?? '');
        $klasse = validKlasse($b['klasse'] ?? '');
        if ($klasse === '') {
            throw new ApiError(400, 'Bitte deine Klasse angeben.');
        }
        $username = validUsername($b['username'] ?? '');
        $password = validPassword($b['password'] ?? '');
        if (usernameTaken($username)) {
            throw new ApiError(409, 'Dieser Benutzername ist schon vergeben.');
        }
        $pending = (int) q("SELECT COUNT(*) AS c FROM users WHERE status = 'pending'")->fetch()['c'];
        if ($pending >= 200) {
            throw new ApiError(429, 'Gerade sind zu viele Anfragen offen. Bitte später nochmal versuchen.');
        }
        q('INSERT INTO users (id, username, password_hash, name, klasse, role, status, created_at) VALUES (?,?,?,?,?,?,?,?)', [
            newId(), $username, password_hash($password, PASSWORD_DEFAULT), $name, $klasse, 'student', 'pending', nowIso(),
        ]);
        return [201, ['ok' => true]];
    }

    if ($method === 'POST' && $r0 === 'login') {
        $b = body();
        $username = strtolower(clean($b['username'] ?? '', 40));
        $u = q('SELECT * FROM users WHERE username = ?', [$username])->fetch();
        if (!$u) {
            password_verify('x', '$2y$10$LIFxTj6uc7h5..DxCdv6rOhBu0BSnItsQ1ZPVJry/TptdazFUBg1e'); // gleiche Antwortzeit
            throw new ApiError(401, 'Benutzername oder Passwort falsch.');
        }
        if ($u['locked_until'] && !isPast($u['locked_until'])) {
            throw new ApiError(429, 'Zu viele Fehlversuche. Bitte in ein paar Minuten nochmal probieren.');
        }
        if (!password_verify((string) ($b['password'] ?? ''), $u['password_hash'])) {
            $fails = (int) $u['failed_logins'] + 1;
            if ($fails >= 5) {
                q('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', [gmdate('Y-m-d\TH:i:s\Z', time() + 300), $u['id']]);
            } else {
                q('UPDATE users SET failed_logins = ? WHERE id = ?', [$fails, $u['id']]);
            }
            throw new ApiError(401, 'Benutzername oder Passwort falsch.');
        }
        if ($u['status'] === 'pending') {
            throw new ApiError(403, 'Deine Anfrage wurde noch nicht bestätigt. Bitte warte, bis deine Lehrkraft sie annimmt.');
        }
        if ($u['status'] !== 'active') {
            throw new ApiError(403, 'Dieses Konto ist gesperrt.');
        }
        q('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [$u['id']]);
        if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
            q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string) $b['password'], PASSWORD_DEFAULT), $u['id']]);
        }
        session_regenerate_id(true);
        $_SESSION['uid'] = $u['id'];
        return [200, ['user' => publicUser($u)]];
    }

    if ($method === 'POST' && $r0 === 'logout') {
        unset($_SESSION['uid']);
        session_regenerate_id(true);
        return [200, ['ok' => true]];
    }

    // Eigenes Passwort ändern
    if ($method === 'POST' && $r0 === 'password') {
        $u = requireUser();
        $b = body();
        if (!password_verify((string) ($b['oldPassword'] ?? ''), $u['password_hash'])) {
            throw new ApiError(400, 'Das alte Passwort stimmt nicht.');
        }
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash(validPassword($b['newPassword'] ?? ''), PASSWORD_DEFAULT), $u['id']]);
        return [200, ['ok' => true]];
    }

    // ----- Schüler: Blätter ansehen und abgeben -----

    if ($method === 'GET' && $r0 === 'sheets' && $n === 1) {
        $u = requireUser();
        $out = [];
        foreach (q('SELECT * FROM sheets ORDER BY created_at') as $s) {
            if (!sheetVisibleFor($s, $u)) {
                continue;
            }
            [$done, $count] = doneTasksOf($s['id'], $u['id']);
            $sheet = sheetOut($s);
            $sheet['myDone'] = array_values(array_filter($sheet['tasks'], function ($t) use ($done) {
                return isset($done[$t]);
            }));
            $sheet['mySubmissions'] = $count;
            $sheet['myQuestions'] = myQuestions($s, $u['id']);
            $out[] = $sheet;
        }
        return [200, ['serverTime' => nowIso(), 'sheets' => $out]];
    }

    if ($method === 'POST' && $r0 === 'sheets' && $n === 3 && $p[2] === 'submit') {
        $u = requireUser();
        $s = q('SELECT * FROM sheets WHERE id = ?', [$p[1]])->fetch();
        if (!$s || !sheetVisibleFor($s, $u)) {
            throw new ApiError(404, 'Dieses Aufgabenblatt gibt es nicht (mehr).');
        }
        if (!canSubmit($s)) {
            throw new ApiError(403, 'Die Abgabefrist ist abgelaufen.');
        }
        $b = body();
        $valid = json_decode($s['tasks'], true) ?: [];
        $tasks = [];
        foreach ((array) ($b['tasks'] ?? []) as $t) {
            $t = (string) $t;
            if (in_array($t, $valid, true) && !in_array($t, $tasks, true)) {
                $tasks[] = $t;
            }
        }
        $comment = clean($b['comment'] ?? '', 500);
        if (!$tasks && $comment === '') {
            throw new ApiError(400, 'Bitte mindestens ein Beispiel ankreuzen.');
        }
        $late = isPast($s['deadline']);
        q('INSERT INTO submissions (id, sheet_id, user_id, tasks, comment, created_at, late) VALUES (?,?,?,?,?,?,?)', [
            newId(), $s['id'], $u['id'], json_encode($tasks, JSON_UNESCAPED_UNICODE), $comment, nowIso(), (int) $late,
        ]);
        [$done, $count] = doneTasksOf($s['id'], $u['id']);
        return [201, [
            'ok' => true,
            'late' => $late,
            'submissionCount' => $count,
            'required' => requiredCount($s),
            'doneTasks' => array_values(array_filter($valid, function ($t) use ($done) {
                return isset($done[$t]);
            })),
        ]];
    }

    // Frage zu einem Beispiel markieren, Text ändern oder wieder entfernen.
    // Geht auch nach der Frist – Fragen kann man immer stellen.
    if ($method === 'POST' && $r0 === 'sheets' && $n === 3 && $p[2] === 'question') {
        $u = requireUser();
        $s = q('SELECT * FROM sheets WHERE id = ?', [$p[1]])->fetch();
        if (!$s || !sheetVisibleFor($s, $u)) {
            throw new ApiError(404, 'Dieses Aufgabenblatt gibt es nicht (mehr).');
        }
        $b = body();
        $task = clean($b['task'] ?? '', 40);
        if (!in_array($task, json_decode($s['tasks'], true) ?: [], true)) {
            throw new ApiError(400, 'Dieses Beispiel gibt es auf dem Blatt nicht.');
        }
        $existing = q('SELECT * FROM questions WHERE sheet_id = ? AND user_id = ? AND task = ?', [$s['id'], $u['id'], $task])->fetch();
        if (!empty($b['remove'])) {
            if ($existing) {
                q('DELETE FROM questions WHERE id = ?', [$existing['id']]);
            }
        } else {
            $text = clean($b['text'] ?? '', 300);
            if ($existing) {
                // Geänderte Frage gilt wieder als offen
                $reopen = $text !== (string) ($existing['text'] ?? '');
                q('UPDATE questions SET text = ?, updated_at = ?, resolved_at = ' . ($reopen ? 'NULL' : 'resolved_at') . ' WHERE id = ?', [$text, nowIso(), $existing['id']]);
            } else {
                q('INSERT INTO questions (id, sheet_id, user_id, task, text, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [
                    newId(), $s['id'], $u['id'], $task, $text, nowIso(), nowIso(),
                ]);
            }
        }
        return [200, ['myQuestions' => myQuestions($s, $u['id'])]];
    }

    // ----- Lehrerbereich -----

    if ($r0 === 'admin') {
        $me = requireTeacher();
        $r1 = $p[1] ?? '';

        if ($method === 'GET' && $r1 === 'data') {
            $sheets = array_map('sheetOut', q('SELECT * FROM sheets ORDER BY created_at')->fetchAll());
            $subs = [];
            foreach (q('SELECT * FROM submissions ORDER BY created_at') as $row) {
                $subs[] = [
                    'id' => $row['id'],
                    'sheetId' => $row['sheet_id'],
                    'userId' => $row['user_id'],
                    'tasks' => json_decode($row['tasks'], true) ?: [],
                    'comment' => $row['comment'] ?? '',
                    'createdAt' => $row['created_at'],
                    'late' => (bool) (int) $row['late'],
                ];
            }
            $users = array_map('publicUser', q('SELECT * FROM users ORDER BY klasse, name')->fetchAll());
            $questions = [];
            foreach (q('SELECT * FROM questions ORDER BY created_at') as $row) {
                $questions[] = [
                    'id' => $row['id'],
                    'sheetId' => $row['sheet_id'],
                    'userId' => $row['user_id'],
                    'task' => $row['task'],
                    'text' => $row['text'] ?? '',
                    'createdAt' => $row['created_at'],
                    'updatedAt' => $row['updated_at'],
                    'resolved' => $row['resolved_at'] !== null,
                ];
            }
            return [200, ['serverTime' => nowIso(), 'me' => publicUser($me), 'sheets' => $sheets, 'submissions' => $subs, 'users' => $users, 'questions' => $questions]];
        }

        // Blätter
        if ($r1 === 'sheets' && $n === 2 && $method === 'POST') {
            $f = sheetFields(body(), null);
            $id = newId();
            q('INSERT INTO sheets (id, title, description, klasse, tasks, task_parts, deadline, lock_after, is_open, min_percent, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
                $id, $f['title'], $f['description'], $f['klasse'], $f['tasks'], $f['task_parts'], $f['deadline'], $f['lock_after'], $f['is_open'], $f['min_percent'], nowIso(),
            ]);
            return [201, sheetOut(q('SELECT * FROM sheets WHERE id = ?', [$id])->fetch())];
        }
        if ($r1 === 'sheets' && $n === 3) {
            $s = q('SELECT * FROM sheets WHERE id = ?', [$p[2]])->fetch();
            if (!$s) {
                throw new ApiError(404, 'Aufgabenblatt nicht gefunden.');
            }
            if ($method === 'PUT') {
                $f = sheetFields(body(), $s);
                q('UPDATE sheets SET title=?, description=?, klasse=?, tasks=?, task_parts=?, deadline=?, lock_after=?, is_open=?, min_percent=? WHERE id=?', [
                    $f['title'], $f['description'], $f['klasse'], $f['tasks'], $f['task_parts'], $f['deadline'], $f['lock_after'], $f['is_open'], $f['min_percent'], $s['id'],
                ]);
                return [200, sheetOut(q('SELECT * FROM sheets WHERE id = ?', [$s['id']])->fetch())];
            }
            if ($method === 'DELETE') {
                q('DELETE FROM submissions WHERE sheet_id = ?', [$s['id']]);
                q('DELETE FROM questions WHERE sheet_id = ?', [$s['id']]);
                q('DELETE FROM sheets WHERE id = ?', [$s['id']]);
                return [200, ['ok' => true]];
            }
        }

        // Frage als beantwortet markieren (oder wieder öffnen) bzw. löschen
        if ($r1 === 'questions' && $n >= 3) {
            $qu = q('SELECT * FROM questions WHERE id = ?', [$p[2]])->fetch();
            if (!$qu) {
                throw new ApiError(404, 'Frage nicht gefunden.');
            }
            if ($method === 'POST' && ($p[3] ?? '') === 'resolve') {
                $resolved = !array_key_exists('resolved', body()) || !empty(body()['resolved']);
                q('UPDATE questions SET resolved_at = ? WHERE id = ?', [$resolved ? nowIso() : null, $qu['id']]);
                return [200, ['ok' => true]];
            }
            if ($method === 'DELETE' && $n === 3) {
                q('DELETE FROM questions WHERE id = ?', [$qu['id']]);
                return [200, ['ok' => true]];
            }
        }

        if ($r1 === 'submissions' && $n === 3 && $method === 'DELETE') {
            $st = q('DELETE FROM submissions WHERE id = ?', [$p[2]]);
            if (!$st->rowCount()) {
                throw new ApiError(404, 'Abgabe nicht gefunden.');
            }
            return [200, ['ok' => true]];
        }

        // Konten
        if ($r1 === 'users' && $n === 2 && $method === 'POST') {
            $b = body();
            $username = validUsername($b['username'] ?? '');
            if (usernameTaken($username)) {
                throw new ApiError(409, 'Dieser Benutzername ist schon vergeben.');
            }
            $role = ($b['role'] ?? '') === 'teacher' ? 'teacher' : 'student';
            $id = newId();
            q('INSERT INTO users (id, username, password_hash, name, klasse, role, status, created_at, approved_at) VALUES (?,?,?,?,?,?,?,?,?)', [
                $id, $username, password_hash(validPassword($b['password'] ?? ''), PASSWORD_DEFAULT),
                validName($b['name'] ?? ''), validKlasse($b['klasse'] ?? ''), $role, 'active', nowIso(), nowIso(),
            ]);
            return [201, publicUser(q('SELECT * FROM users WHERE id = ?', [$id])->fetch())];
        }
        if ($r1 === 'users' && $n >= 3) {
            $u = q('SELECT * FROM users WHERE id = ?', [$p[2]])->fetch();
            if (!$u) {
                throw new ApiError(404, 'Konto nicht gefunden.');
            }
            $action = $p[3] ?? '';
            if ($method === 'POST' && $action === 'approve') {
                q("UPDATE users SET status = 'active', approved_at = ? WHERE id = ?", [nowIso(), $u['id']]);
                return [200, ['ok' => true]];
            }
            if ($method === 'POST' && $action === 'password') {
                q('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [
                    password_hash(validPassword(body()['password'] ?? ''), PASSWORD_DEFAULT), $u['id'],
                ]);
                return [200, ['ok' => true]];
            }
            if ($method === 'PUT' && $action === '') {
                $b = body();
                $name = array_key_exists('name', $b) ? validName($b['name']) : $u['name'];
                $klasse = array_key_exists('klasse', $b) ? validKlasse($b['klasse']) : $u['klasse'];
                $role = array_key_exists('role', $b) ? ($b['role'] === 'teacher' ? 'teacher' : 'student') : $u['role'];
                if ($u['id'] === $me['id'] && $role !== 'teacher') {
                    throw new ApiError(400, 'Du kannst dir nicht selbst die Lehrer-Rechte nehmen.');
                }
                q('UPDATE users SET name = ?, klasse = ?, role = ? WHERE id = ?', [$name, $klasse, $role, $u['id']]);
                return [200, publicUser(q('SELECT * FROM users WHERE id = ?', [$u['id']])->fetch())];
            }
            if ($method === 'DELETE' && $action === '') {
                if ($u['id'] === $me['id']) {
                    throw new ApiError(400, 'Du kannst dein eigenes Konto nicht löschen.');
                }
                q('DELETE FROM submissions WHERE user_id = ?', [$u['id']]);
                q('DELETE FROM questions WHERE user_id = ?', [$u['id']]);
                q('DELETE FROM users WHERE id = ?', [$u['id']]);
                return [200, ['ok' => true]];
            }
        }
    }

    throw new ApiError(404, 'Nicht gefunden.');
}

// ---------- Ablauf ----------

try {
    startSession();
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    // PUT/DELETE werden als POST mit X-HTTP-Method geschickt (manche Hoster blockieren PUT/DELETE)
    if ($method === 'POST' && !empty($_SERVER['HTTP_X_HTTP_METHOD'])) {
        $override = strtoupper($_SERVER['HTTP_X_HTTP_METHOD']);
        if (in_array($override, ['PUT', 'DELETE'], true)) {
            $method = $override;
        }
    }
    if ($method !== 'GET') {
        if (!hash_equals($_SESSION['csrf'], (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
            throw new ApiError(403, 'Sitzung abgelaufen. Bitte die Seite neu laden.');
        }
    }
    $path = array_values(array_filter(explode('/', (string) ($_GET['r'] ?? '')), 'strlen'));
    [$status, $data] = route($method, $path);
    respond($status, $data);
} catch (ApiError $e) {
    respond($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('Mathe-Abgabe: ' . $e);
    respond(500, ['error' => !empty($config['debug']) ? $e->getMessage() : 'Serverfehler. Bitte später nochmal versuchen.']);
}
