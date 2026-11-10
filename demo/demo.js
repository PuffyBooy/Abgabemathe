// GitHub-Pages-Demo: ersetzt das PHP-Backend (api.php) durch eine Nachbildung im Browser (localStorage).
// Verhält sich wie api.php, inklusive Konten, Anfragen und Login. Wird nur in die Demo-Seite eingebunden.
(function () {
  'use strict';
  const KEY = 'abgabemathe-demo-v4';
  const SESSION_KEY = 'abgabemathe-demo-v4-session';
  const DEMO_PASSWORD = 'demo';
  const core = window.AbgabeCore;
  let memoryDb = null; // falls localStorage nicht verfügbar ist
  let memorySession = null;

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  const nowIso = () => new Date().toISOString();
  const newId = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-8);
  const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const isPast = (iso) => !!iso && Date.now() > new Date(iso).getTime();

  // ---------- Beispieldaten ----------

  function seed() {
    const dayAt = (days, h, m = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
    // Frist an einem Schultag (Mo–Fr) um 8:00; fällt sie aufs Wochenende, wird sie verschoben
    const schoolDay = (days, dir) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + dir);
      d.setHours(8, 0, 0, 0);
      return d;
    };
    const rel = (base, days, h, m = 0) => {
      const d = new Date(base);
      d.setDate(d.getDate() + days);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const due4 = schoolDay(-2, -1);
    const due5 = schoolDay(3, 1);
    const due6 = schoolDay(8, 1);

    const sheet = (id, createdAt, title, description, tasks, deadline, lockAfterDeadline) => {
      const examples = core.parseExamples(tasks);
      const taskParts = {};
      examples.forEach((e) => { if (e.parts.length) taskParts[e.id] = e.parts; });
      return {
        id, createdAt, title, description, klasse: '', tasks: examples.map((e) => e.id), taskParts,
        deadline: deadline.toISOString(), lockAfterDeadline, open: true, minPercent: 80,
      };
    };
    const sheets = [
      sheet('demo-hue4', rel(due4, -7, 9, 5), 'Hausübung 4 – Prozentrechnung', 'Buch S. 18–31', '1.12ab 1.14 1.15a-c 1.18 1.19 2.3ab', due4, false),
      sheet('demo-hue5', dayAt(-3, 10, 15), 'Hausübung 5 – Bruchrechnen', 'Buch S. 40–62', '2.16abc 2.18 2.21ab 3.4 3.7c 3.11 3.18c 3.20ab 4.2 4.5', due5, false),
      sheet('demo-hue6', dayAt(-1, 11, 50), 'Hausübung 6 – Gleichungen', 'Buch S. 120–131', '7.19 7.22ab 7.25 8.3a-d 8.6', due6, true),
    ];

    const user = (username, name, klasse, role = 'student', status = 'active', createdAt = dayAt(-30, 9)) => ({
      id: 'u-' + username, username, password: DEMO_PASSWORD, name, klasse, role, status, createdAt,
      approvedAt: status === 'active' ? createdAt : null,
    });
    const users = [
      user('lehrer', 'Mag. Anna Huber', '', 'teacher'),
      user('lena', 'Lena Huber', '3B'), user('max', 'Max Gruber', '3B'), user('sara', 'Sara Novak', '3A'),
      user('jonas', 'Jonas Berger', '3A'), user('emma', 'Emma Wagner', '3B'), user('paul', 'Paul Steiner', '3A'),
      user('mia', 'Mia Hofer', '3B'), user('david', 'David Bauer', '3A'),
      // offene Anfragen
      user('tobias.lang', 'Tobias Lang', '3A', 'student', 'pending', minutesAgo(95)),
      user('nina.pichler', 'Nina Pichler', '3B', 'student', 'pending', minutesAgo(12)),
    ];

    // [Blatt, Benutzer, Beispiele, Zeitpunkt, Kommentar]
    const subs = [
      ['demo-hue4', 'lena', '1.12 1.14 1.15 1.18 1.19 2.3', rel(due4, -4, 17, 30)],
      ['demo-hue4', 'sara', '1.12 1.14 1.15 1.18 1.19 2.3', rel(due4, -3, 15, 5)],
      ['demo-hue4', 'jonas', '1.12 1.14', rel(due4, -3, 18, 40)],
      ['demo-hue4', 'emma', '1.12 1.14 1.15 1.18 1.19 2.3', rel(due4, -2, 16, 50)],
      ['demo-hue4', 'max', '1.12 1.14 1.15 1.18', rel(due4, -1, 20, 15)],
      ['demo-hue4', 'paul', '1.12 1.14 1.15 1.18 1.19', rel(due4, -1, 21, 5)],
      ['demo-hue4', 'mia', '1.12 1.14 1.15', rel(due4, 0, 7, 40), 'Bei 1.18 und 2.3 kenne ich mich nicht aus.'],
      ['demo-hue4', 'david', '1.12 1.14 1.15 1.18 1.19 2.3', rel(due4, 0, 7, 55)],
      ['demo-hue4', 'jonas', '1.15 1.18 1.19', rel(due4, 1, 19, 10)], // verspätet nachgereicht
      ['demo-hue5', 'lena', '2.16 2.18 2.21 3.4 3.7 3.11', dayAt(-2, 17, 20)],
      ['demo-hue5', 'emma', '2.16 2.18 2.21 3.4', dayAt(-2, 19, 30)],
      ['demo-hue5', 'paul', '2.16 2.18 2.21 3.4 3.7 3.11 3.18', dayAt(-1, 15, 55)],
      ['demo-hue5', 'sara', '2.16 2.18 2.21 3.4 3.7 3.11 3.18 3.20 4.2 4.5', dayAt(-1, 16, 30)],
      ['demo-hue5', 'lena', '3.18 3.20', dayAt(-1, 18, 5)],
      ['demo-hue5', 'max', '2.16 2.18', dayAt(-1, 20, 45), 'Bei 2.21 bin ich nicht weitergekommen.'],
      ['demo-hue5', 'mia', '2.16 2.18 2.21 3.4 3.7 3.11 3.18 3.20 4.2', dayAt(-1, 21, 10)],
      ['demo-hue6', 'sara', '7.19 7.22', minutesAgo(25)],
    ];
    const submissions = subs.map(([sheetId, who, tasks, createdAt, comment]) => {
      const s = sheets.find((x) => x.id === sheetId);
      return {
        id: newId(), sheetId, userId: 'u-' + who, tasks: core.parseExamples(tasks).map((e) => e.id),
        comment: comment || '', createdAt, late: new Date(createdAt) > new Date(s.deadline),
      };
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return { users, sheets, submissions };
  }

  // ---------- Speicher ----------

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignorieren */ }
    if (memoryDb) return memoryDb;
    const db = seed();
    save(db);
    return db;
  }
  function save(db) {
    memoryDb = db;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* nur im Speicher */ }
  }
  function getSession() {
    try { return localStorage.getItem(SESSION_KEY) || memorySession; } catch { return memorySession; }
  }
  function setSession(id) {
    memorySession = id;
    try {
      if (id) localStorage.setItem(SESSION_KEY, id);
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* ignorieren */ }
  }

  // ---------- Nachbildung von api.php ----------

  const publicUser = (u) => ({
    id: u.id, username: u.username, name: u.name, klasse: u.klasse, role: u.role, status: u.status, createdAt: u.createdAt, approvedAt: u.approvedAt,
  });
  const required = (s) => core.requiredCount(s);
  const canSubmit = (s) => s.open && !(s.lockAfterDeadline && isPast(s.deadline));
  const sheetOut = (s) => ({ ...s, required: required(s), acceptsSubmissions: canSubmit(s) });
  const visibleFor = (s, u) => s.open && (!s.klasse || s.klasse === u.klasse);

  function validUsername(v) {
    const u = clean(v, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new ApiError(400, 'Benutzername: 3–30 Zeichen, nur Buchstaben a–z, Zahlen, Punkt, Minus oder Unterstrich.');
    return u;
  }
  function validPassword(v) {
    const p = String(v ?? '');
    if (p.length < 6) throw new ApiError(400, 'Das Passwort muss mindestens 6 Zeichen haben.');
    return p;
  }
  function validName(v) {
    const n = clean(v, 80);
    if (n.length < 3) throw new ApiError(400, 'Bitte Vor- und Nachnamen angeben.');
    return n;
  }
  const validKlasse = (v) => clean(v, 30).toUpperCase();

  function currentUser(db) {
    const id = getSession();
    const u = id && db.users.find((x) => x.id === id);
    if (!u || u.status !== 'active') return null;
    return u;
  }
  function requireUser(db) {
    const u = currentUser(db);
    if (!u) throw new ApiError(401, 'Bitte melde dich an.');
    return u;
  }
  function requireTeacher(db) {
    const u = requireUser(db);
    if (u.role !== 'teacher') throw new ApiError(403, 'Nur für Lehrkräfte.');
    return u;
  }

  function doneOf(db, sheetId, userId) {
    const mine = db.submissions.filter((s) => s.sheetId === sheetId && s.userId === userId);
    return { done: new Set(mine.flatMap((s) => s.tasks)), count: mine.length };
  }

  function sheetFields(b, existing = {}) {
    const f = { ...existing };
    f.title = clean(b.title ?? existing.title, 120);
    if (!f.title) throw new ApiError(400, 'Bitte einen Titel angeben.');
    f.description = clean(b.description ?? existing.description ?? '', 500);
    f.klasse = 'klasse' in b ? validKlasse(b.klasse) : existing.klasse || '';
    if ('tasks' in b) {
      f.tasks = [...new Set((b.tasks || []).map((t) => clean(t, 40)).filter(Boolean))].slice(0, 300);
      f.taskParts = {};
      Object.entries(b.taskParts || {}).forEach(([id, letters]) => {
        if (f.tasks.includes(id) && Array.isArray(letters)) f.taskParts[id] = letters.filter((l) => /^[a-z]$/.test(l));
      });
    }
    if (!f.tasks || !f.tasks.length) throw new ApiError(400, 'Bitte mindestens ein Beispiel angeben.');
    if ('deadline' in b) f.deadline = b.deadline ? new Date(b.deadline).toISOString() : null;
    if ('lockAfterDeadline' in b) f.lockAfterDeadline = !!b.lockAfterDeadline;
    if ('open' in b) f.open = !!b.open;
    if ('minPercent' in b) f.minPercent = Math.min(100, Math.max(1, Math.round(Number(b.minPercent)) || 80));
    f.lockAfterDeadline = !!f.lockAfterDeadline;
    f.open = f.open ?? true;
    f.minPercent = f.minPercent ?? 80;
    f.deadline = f.deadline ?? null;
    return f;
  }

  function route(db, method, p, b) {
    const n = p.length;
    if (method === 'GET' && p[0] === 'me') {
      const u = currentUser(db);
      return [200, { user: u ? publicUser(u) : null, csrf: 'demo', setupNeeded: false, serverTime: nowIso() }];
    }
    if (method === 'POST' && p[0] === 'register') {
      const name = validName(b.name);
      const klasse = validKlasse(b.klasse);
      if (!klasse) throw new ApiError(400, 'Bitte deine Klasse angeben.');
      const username = validUsername(b.username);
      const password = validPassword(b.password);
      if (db.users.some((u) => u.username === username)) throw new ApiError(409, 'Dieser Benutzername ist schon vergeben.');
      db.users.push({ id: 'u-' + newId(), username, password, name, klasse, role: 'student', status: 'pending', createdAt: nowIso(), approvedAt: null });
      return [201, { ok: true }];
    }
    if (method === 'POST' && p[0] === 'login') {
      const u = db.users.find((x) => x.username === clean(b.username, 40).toLowerCase());
      if (!u || u.password !== String(b.password ?? '')) throw new ApiError(401, 'Benutzername oder Passwort falsch.');
      if (u.status === 'pending') throw new ApiError(403, 'Deine Anfrage wurde noch nicht bestätigt. Bitte warte, bis deine Lehrkraft sie annimmt.');
      setSession(u.id);
      return [200, { user: publicUser(u) }];
    }
    if (method === 'POST' && p[0] === 'logout') {
      setSession(null);
      return [200, { ok: true }];
    }
    if (method === 'POST' && p[0] === 'password') {
      const u = requireUser(db);
      if (u.password !== String(b.oldPassword ?? '')) throw new ApiError(400, 'Das alte Passwort stimmt nicht.');
      u.password = validPassword(b.newPassword);
      return [200, { ok: true }];
    }

    if (method === 'GET' && p[0] === 'sheets' && n === 1) {
      const u = requireUser(db);
      const sheets = db.sheets.filter((s) => visibleFor(s, u)).map((s) => {
        const { done, count } = doneOf(db, s.id, u.id);
        return { ...sheetOut(s), myDone: s.tasks.filter((t) => done.has(t)), mySubmissions: count };
      });
      return [200, { serverTime: nowIso(), sheets }];
    }
    if (method === 'POST' && p[0] === 'sheets' && n === 3 && p[2] === 'submit') {
      const u = requireUser(db);
      const s = db.sheets.find((x) => x.id === p[1]);
      if (!s || !visibleFor(s, u)) throw new ApiError(404, 'Dieses Aufgabenblatt gibt es nicht (mehr).');
      if (!canSubmit(s)) throw new ApiError(403, 'Die Abgabefrist ist abgelaufen.');
      const tasks = [...new Set((b.tasks || []).map(String))].filter((t) => s.tasks.includes(t));
      const comment = clean(b.comment, 500);
      if (!tasks.length && !comment) throw new ApiError(400, 'Bitte mindestens ein Beispiel ankreuzen.');
      const late = isPast(s.deadline);
      db.submissions.push({ id: newId(), sheetId: s.id, userId: u.id, tasks, comment, createdAt: nowIso(), late });
      const { done, count } = doneOf(db, s.id, u.id);
      return [201, { ok: true, late, submissionCount: count, required: required(s), doneTasks: s.tasks.filter((t) => done.has(t)) }];
    }

    if (p[0] === 'admin') {
      const me = requireTeacher(db);
      if (method === 'GET' && p[1] === 'data') {
        return [200, {
          serverTime: nowIso(), me: publicUser(me), sheets: db.sheets.map(sheetOut), submissions: db.submissions,
          users: db.users.map(publicUser),
        }];
      }
      if (p[1] === 'sheets' && n === 2 && method === 'POST') {
        const s = { id: newId(), createdAt: nowIso(), ...sheetFields(b) };
        db.sheets.push(s);
        return [201, sheetOut(s)];
      }
      if (p[1] === 'sheets' && n === 3) {
        const i = db.sheets.findIndex((x) => x.id === p[2]);
        if (i === -1) throw new ApiError(404, 'Aufgabenblatt nicht gefunden.');
        if (method === 'PUT') {
          db.sheets[i] = sheetFields(b, db.sheets[i]);
          return [200, sheetOut(db.sheets[i])];
        }
        if (method === 'DELETE') {
          const [removed] = db.sheets.splice(i, 1);
          db.submissions = db.submissions.filter((s) => s.sheetId !== removed.id);
          return [200, { ok: true }];
        }
      }
      if (p[1] === 'submissions' && n === 3 && method === 'DELETE') {
        db.submissions = db.submissions.filter((s) => s.id !== p[2]);
        return [200, { ok: true }];
      }
      if (p[1] === 'users' && n === 2 && method === 'POST') {
        const username = validUsername(b.username);
        if (db.users.some((u) => u.username === username)) throw new ApiError(409, 'Dieser Benutzername ist schon vergeben.');
        const u = {
          id: 'u-' + newId(), username, password: validPassword(b.password), name: validName(b.name), klasse: validKlasse(b.klasse),
          role: b.role === 'teacher' ? 'teacher' : 'student', status: 'active', createdAt: nowIso(), approvedAt: nowIso(),
        };
        db.users.push(u);
        return [201, publicUser(u)];
      }
      if (p[1] === 'users' && n >= 3) {
        const u = db.users.find((x) => x.id === p[2]);
        if (!u) throw new ApiError(404, 'Konto nicht gefunden.');
        const action = p[3] || '';
        if (method === 'POST' && action === 'approve') {
          u.status = 'active';
          u.approvedAt = nowIso();
          return [200, { ok: true }];
        }
        if (method === 'POST' && action === 'password') {
          u.password = validPassword(b.password);
          return [200, { ok: true }];
        }
        if (method === 'PUT' && !action) {
          const role = 'role' in b ? (b.role === 'teacher' ? 'teacher' : 'student') : u.role;
          if (u.id === me.id && role !== 'teacher') throw new ApiError(400, 'Du kannst dir nicht selbst die Lehrer-Rechte nehmen.');
          if ('name' in b) u.name = validName(b.name);
          if ('klasse' in b) u.klasse = validKlasse(b.klasse);
          u.role = role;
          return [200, publicUser(u)];
        }
        if (method === 'DELETE' && !action) {
          if (u.id === me.id) throw new ApiError(400, 'Du kannst dein eigenes Konto nicht löschen.');
          db.users = db.users.filter((x) => x.id !== u.id);
          db.submissions = db.submissions.filter((s) => s.userId !== u.id);
          return [200, { ok: true }];
        }
      }
    }
    throw new ApiError(404, 'Nicht gefunden.');
  }

  function request(method, path, body) {
    const db = load();
    const parts = String(path).split('?')[0].split('/').filter(Boolean);
    try {
      const [status, data] = route(db, method, parts, body || {});
      if (method !== 'GET') save(db);
      // Kopie zurückgeben, damit die Seite die gespeicherten Daten nicht verändert
      return { status, data: JSON.parse(JSON.stringify(data)) };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, data: { error: e.message } };
      throw e;
    }
  }

  function reset() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('abgabemathe-demo')).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignorieren */ }
    memoryDb = null;
    memorySession = null;
    location.reload();
  }

  window.AbgabeDemo = { request, reset };

  // Hinweis-Leiste oben auf der Seite, mit Schnell-Login
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.className = 'demo-bar';
    bar.innerHTML = `<div class="inner">
      <span><b>Demo</b> – Daten bleiben nur in deinem Browser. Passwort überall <code>demo</code>.
        Schnell anmelden als:
        <button type="button" class="ghost small" data-demo-login="lehrer">Lehrkraft</button>
        <button type="button" class="ghost small" data-demo-login="lena">Schülerin Lena</button></span>
      <button type="button" class="ghost small" id="demoReset">Demo zurücksetzen</button>
    </div>`;
    bar.querySelectorAll('[data-demo-login]').forEach((btn) => {
      btn.onclick = () => {
        const who = btn.dataset.demoLogin;
        request('POST', 'login', { username: who, password: DEMO_PASSWORD });
        location.href = who === 'lehrer' ? 'lehrer.html' : './';
      };
    });
    bar.querySelector('#demoReset').onclick = () => {
      if (confirm('Alle Demo-Daten löschen und Beispieldaten neu laden?')) reset();
    };
    document.body.prepend(bar);
  });
})();
