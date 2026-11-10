'use strict';
// Tests: startet api.php mit dem eingebauten PHP-Server (SQLite) und prüft die API.
// Aufruf: npm test   (braucht php im PATH)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseTasks, parseExamples, requiredCount } = require('./public/core.js');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

// Kleiner Browser-Ersatz: merkt sich das Session-Cookie und den CSRF-Token
class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async call(method, route, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    if (method !== 'GET') {
      headers['X-CSRF-Token'] = this.csrf;
      headers['X-HTTP-Method'] = method;
    }
    const res = await fetch(`${BASE}/api.php?r=${encodeURIComponent(route)}`, {
      method: method === 'GET' ? 'GET' : 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const data = await res.json();
    if (data && data.csrf) this.csrf = data.csrf;
    return { status: res.status, data };
  }
  async me() { return this.call('GET', 'me'); }
}

async function main() {
  // --- Beispiel-Erkennung (core.js) ---
  assert.deepStrictEqual(parseTasks('2.16a b 3.18c 7.19'), ['2.16a', '2.16b', '3.18c', '7.19']);
  assert.deepStrictEqual(parseExamples('2.16abc 3.18c 7.19 2.16d'), [
    { id: '2.16', parts: ['a', 'b', 'c', 'd'] }, { id: '3.18', parts: ['c'] }, { id: '7.19', parts: [] },
  ]);
  assert.deepStrictEqual(parseExamples('2.16-2.18').map((e) => e.id), ['2.16', '2.17', '2.18']);
  assert.strictEqual(requiredCount({ tasks: parseTasks('1-10'), minPercent: 80 }), 8);
  assert.strictEqual(requiredCount({ tasks: parseTasks('1-4') }), 4);

  // --- PHP-Server starten ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abgabemathe-'));
  const configFile = path.join(tmp, 'config.php');
  // Standard: SQLite. Mit TEST_DB_DSN (+ TEST_DB_USER/TEST_DB_PASS) gegen MySQL testen – Datenbank muss leer sein.
  const dsn = process.env.TEST_DB_DSN || '';
  fs.writeFileSync(configFile, `<?php return ['db_dsn' => ${JSON.stringify(dsn)}, 'db_user' => ${JSON.stringify(process.env.TEST_DB_USER || '')},
    'db_pass' => ${JSON.stringify(process.env.TEST_DB_PASS || '')}, 'setup_code' => 'test-code-123', 'data_dir' => ${JSON.stringify(tmp)}, 'debug' => true];`);
  console.log('Datenbank:', dsn || 'SQLite');
  const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', path.join(__dirname, 'public')], {
    env: { ...process.env, ABGABE_CONFIG: configFile },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let phpLog = '';
  php.stderr.on('data', (d) => { phpLog += d; });
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(BASE + '/index.html'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    await runApiTests();
    console.log('Alle Tests bestanden ✓');
  } catch (e) {
    console.error(phpLog.split('\n').filter((l) => /error|warning|notice/i.test(l)).join('\n'));
    throw e;
  } finally {
    php.kill();
  }
}

async function runApiTests() {
  const teacher = new Client();
  let r = await teacher.me();
  assert.strictEqual(r.data.setupNeeded, true);
  assert.strictEqual(r.data.user, null);

  // Ohne CSRF-Token wird nichts angenommen
  const noCsrf = new Client();
  await noCsrf.me();
  noCsrf.csrf = 'falsch';
  assert.strictEqual((await noCsrf.call('POST', 'register', { name: 'X Y', klasse: '3A', username: 'xy1', password: 'geheim1' })).status, 403);

  // Ersteinrichtung
  assert.strictEqual((await teacher.call('POST', 'setup', { code: 'falsch', name: 'Frau Lehrer', username: 'lehrer', password: 'lehrer123' })).status, 403);
  r = await teacher.call('POST', 'setup', { code: 'test-code-123', name: 'Frau Lehrer', username: 'Lehrer', password: 'lehrer123' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  r = await teacher.me();
  assert.strictEqual(r.data.setupNeeded, false);
  assert.strictEqual(r.data.user.username, 'lehrer');
  assert.strictEqual(r.data.user.role, 'teacher');
  // Zweite Einrichtung geht nicht mehr
  assert.strictEqual((await new Client().call('POST', 'setup', { code: 'test-code-123' })).status, 403);

  // Schülerin fragt Konto an
  const lena = new Client();
  await lena.me();
  r = await lena.call('POST', 'register', { name: 'Lena Huber', klasse: '3b', username: 'lena.huber', password: 'kurz' });
  assert.strictEqual(r.status, 400); // Passwort zu kurz
  r = await lena.call('POST', 'register', { name: 'Lena Huber', klasse: '3b', username: 'lena.huber', password: 'geheim1' });
  assert.strictEqual(r.status, 201);
  r = await lena.call('POST', 'register', { name: 'Lena Huber', klasse: '3b', username: 'lena.huber', password: 'geheim1' });
  assert.strictEqual(r.status, 409); // Name vergeben

  // Vor der Bestätigung kein Login
  r = await lena.call('POST', 'login', { username: 'lena.huber', password: 'geheim1' });
  assert.strictEqual(r.status, 403);
  assert.match(r.data.error, /noch nicht bestätigt/);
  assert.strictEqual((await lena.call('GET', 'sheets')).status, 401);

  // Schüler dürfen nicht in den Lehrerbereich
  assert.strictEqual((await lena.call('GET', 'admin/data')).status, 401);

  // Lehrkraft sieht Anfrage und nimmt sie an
  r = await teacher.call('GET', 'admin/data');
  const pending = r.data.users.find((u) => u.username === 'lena.huber');
  assert.strictEqual(pending.status, 'pending');
  assert.strictEqual(pending.klasse, '3B');
  assert.strictEqual(pending.password_hash, undefined);
  assert.strictEqual((await teacher.call('POST', `admin/users/${pending.id}/approve`)).status, 200);

  // Falsches Passwort, dann richtig
  assert.strictEqual((await lena.call('POST', 'login', { username: 'lena.huber', password: 'falsch!' })).status, 401);
  r = await lena.call('POST', 'login', { username: 'Lena.Huber', password: 'geheim1' });
  assert.strictEqual(r.status, 200);
  await lena.me(); // neuer CSRF-Token nach Login

  // Blätter: eines für alle, eines nur für 3A
  const examples = parseExamples('2.16abc 3.18c 7.19 8.1 8.2');
  r = await teacher.call('POST', 'admin/sheets', {
    title: 'HÜ 5', tasks: examples.map((e) => e.id), taskParts: { '2.16': ['a', 'b', 'c'], '3.18': ['c'], 'gibtsnicht': ['a'] },
    deadline: null, minPercent: 80, open: true,
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  const hue5 = r.data;
  assert.deepStrictEqual(hue5.tasks, ['2.16', '3.18', '7.19', '8.1', '8.2']);
  assert.deepStrictEqual(hue5.taskParts, { '2.16': ['a', 'b', 'c'], '3.18': ['c'] });
  assert.strictEqual(hue5.required, 4);
  r = await teacher.call('POST', 'admin/sheets', { title: 'Nur 3A', tasks: ['1'], klasse: '3a' });
  const only3a = r.data;
  assert.strictEqual(only3a.klasse, '3A');

  // Lena (3B) sieht nur das Blatt für alle
  r = await lena.call('GET', 'sheets');
  assert.deepStrictEqual(r.data.sheets.map((s) => s.title), ['HÜ 5']);
  assert.strictEqual((await lena.call('POST', `sheets/${only3a.id}/submit`, { tasks: ['1'] })).status, 404);

  // Abgeben, zweimal – wird zusammengezählt
  r = await lena.call('POST', `sheets/${hue5.id}/submit`, { tasks: ['2.16', '3.18', 'falsch'] });
  assert.strictEqual(r.status, 201);
  assert.deepStrictEqual(r.data.doneTasks, ['2.16', '3.18']);
  r = await lena.call('POST', `sheets/${hue5.id}/submit`, { tasks: ['7.19', '8.1'], comment: 'Bei 8.2 Probleme' });
  assert.deepStrictEqual(r.data.doneTasks, ['2.16', '3.18', '7.19', '8.1']);
  assert.strictEqual(r.data.submissionCount, 2);
  r = await lena.call('GET', 'sheets');
  assert.deepStrictEqual(r.data.sheets[0].myDone, ['2.16', '3.18', '7.19', '8.1']);
  assert.strictEqual(r.data.sheets[0].mySubmissions, 2);

  // Frist abgelaufen + gesperrt
  await teacher.call('PUT', `admin/sheets/${hue5.id}`, { deadline: new Date(Date.now() - 60000).toISOString(), lockAfterDeadline: true });
  assert.strictEqual((await lena.call('POST', `sheets/${hue5.id}/submit`, { tasks: ['8.2'] })).status, 403);
  // Frist abgelaufen, nicht gesperrt -> verspätet
  r = await teacher.call('PUT', `admin/sheets/${hue5.id}`, { lockAfterDeadline: false, minPercent: 60 });
  assert.strictEqual(r.data.minPercent, 60);
  assert.deepStrictEqual(r.data.tasks, hue5.tasks); // Beispiele bleiben erhalten
  r = await lena.call('POST', `sheets/${hue5.id}/submit`, { tasks: ['8.2'] });
  assert.strictEqual(r.data.late, true);

  // Lehrer-Übersicht
  r = await teacher.call('GET', 'admin/data');
  assert.strictEqual(r.data.submissions.length, 3);
  assert.ok(r.data.submissions.every((s) => s.userId === pending.id));

  // Konto direkt anlegen, bearbeiten, Passwort setzen, löschen
  r = await teacher.call('POST', 'admin/users', { name: 'Max Gruber', klasse: '3B', username: 'max', password: 'start123' });
  assert.strictEqual(r.status, 201);
  const max = r.data;
  r = await teacher.call('PUT', `admin/users/${max.id}`, { klasse: '3a' });
  assert.strictEqual(r.data.klasse, '3A');
  await teacher.call('POST', `admin/users/${max.id}/password`, { password: 'neu12345' });
  const maxClient = new Client();
  await maxClient.me();
  assert.strictEqual((await maxClient.call('POST', 'login', { username: 'max', password: 'neu12345' })).status, 200);
  await maxClient.me();
  r = await maxClient.call('POST', 'password', { oldPassword: 'neu12345', newPassword: 'eigenes1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await teacher.call('DELETE', `admin/users/${max.id}`)).status, 200);
  assert.strictEqual((await maxClient.call('GET', 'sheets')).status, 401); // gelöscht -> abgemeldet

  // Lehrkraft kann sich nicht selbst löschen
  const me = (await teacher.me()).data.user;
  assert.strictEqual((await teacher.call('DELETE', `admin/users/${me.id}`)).status, 400);

  // Sperre nach 5 Fehlversuchen
  const bad = new Client();
  await bad.me();
  for (let i = 0; i < 5; i++) await bad.call('POST', 'login', { username: 'lena.huber', password: 'falsch' + i });
  assert.strictEqual((await bad.call('POST', 'login', { username: 'lena.huber', password: 'geheim1' })).status, 429);

  // Abmelden
  await lena.call('POST', 'logout');
  assert.strictEqual((await lena.call('GET', 'sheets')).status, 401);

  // Blatt löschen löscht Abgaben mit
  await teacher.call('DELETE', `admin/sheets/${hue5.id}`);
  r = await teacher.call('GET', 'admin/data');
  assert.strictEqual(r.data.submissions.length, 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
