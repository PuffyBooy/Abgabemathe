'use strict';
// Abgabemathe – kleiner Server ohne externe Abhängigkeiten.
// Start: node server.js   (Port über PORT, Lehrer-Passwort über TEACHER_PASSWORD)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'lehrer123';

if (!process.env.TEACHER_PASSWORD) {
  console.warn('WARNUNG: TEACHER_PASSWORD ist nicht gesetzt – Standardpasswort "lehrer123" wird verwendet.');
}

// ---------- Datenhaltung (JSON-Datei) ----------

function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.sheets = db.sheets || [];
    db.submissions = db.submissions || [];
    return db;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Konnte Datenbank nicht lesen:', e);
    return { sheets: [], submissions: [] };
  }
}

let db = loadDb();

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const newId = () => crypto.randomBytes(8).toString('hex');

// ---------- Hilfsfunktionen ----------

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Schlüssel, um denselben Schüler bei mehreren Abgaben zu erkennen.
function studentKey(name, klasse) {
  return (cleanText(klasse, 30) + '|' + cleanText(name, 80)).toLocaleLowerCase('de');
}

// "1-5, 6a, 6b" -> ["1","2","3","4","5","6a","6b"]
function parseTasks(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[,;\n]+/);
  const out = [];
  for (const raw of parts) {
    const p = cleanText(raw, 40);
    if (!p) continue;
    const range = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b >= a && b - a < 200) {
        for (let i = a; i <= b; i++) out.push(String(i));
        continue;
      }
    }
    out.push(p);
  }
  return [...new Set(out)].slice(0, 300);
}

function parseDeadline(value) {
  if (value === null || value === undefined || value === '') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function isPastDeadline(sheet, now = Date.now()) {
  return !!sheet.deadline && now > new Date(sheet.deadline).getTime();
}

function canSubmit(sheet) {
  if (!sheet.open) return false;
  if (sheet.lockAfterDeadline && isPastDeadline(sheet)) return false;
  return true;
}

function publicSheet(sheet) {
  return {
    id: sheet.id,
    title: sheet.title,
    description: sheet.description,
    tasks: sheet.tasks,
    deadline: sheet.deadline,
    lockAfterDeadline: sheet.lockAfterDeadline,
    open: sheet.open,
    acceptsSubmissions: canSubmit(sheet),
  };
}

function sheetFromBody(body, existing = {}) {
  const title = cleanText(body.title ?? existing.title, 120);
  const tasks = body.tasks !== undefined ? parseTasks(body.tasks) : existing.tasks;
  if (!title) throw new HttpError(400, 'Bitte einen Titel angeben.');
  if (!tasks || tasks.length === 0) throw new HttpError(400, 'Bitte mindestens eine Aufgabe angeben.');
  return {
    ...existing,
    title,
    description: cleanText(body.description ?? existing.description ?? '', 500),
    tasks,
    deadline: body.deadline !== undefined ? parseDeadline(body.deadline) : existing.deadline ?? null,
    lockAfterDeadline: body.lockAfterDeadline !== undefined ? !!body.lockAfterDeadline : !!existing.lockAfterDeadline,
    open: body.open !== undefined ? !!body.open : existing.open ?? true,
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(new HttpError(413, 'Anfrage zu groß.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Ungültiges JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function isTeacher(req) {
  const given = Buffer.from(String(req.headers['x-teacher-password'] || ''));
  const expected = Buffer.from(TEACHER_PASSWORD);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ["api", ...]
  const method = req.method;

  // Öffentlich: Liste der Aufgabenblätter
  if (method === 'GET' && parts[1] === 'sheets' && parts.length === 2) {
    const sheets = db.sheets.filter((s) => s.open).map(publicSheet);
    return send(res, 200, { serverTime: new Date().toISOString(), sheets });
  }

  // Öffentlich: Abgabe
  if (method === 'POST' && parts[1] === 'sheets' && parts[3] === 'submit' && parts.length === 4) {
    const sheet = db.sheets.find((s) => s.id === parts[2]);
    if (!sheet || !sheet.open) throw new HttpError(404, 'Dieses Aufgabenblatt gibt es nicht (mehr).');
    if (!canSubmit(sheet)) throw new HttpError(403, 'Die Abgabefrist ist abgelaufen.');
    const body = await readBody(req);
    const name = cleanText(body.name, 80);
    const klasse = cleanText(body.klasse, 30);
    if (name.length < 2) throw new HttpError(400, 'Bitte deinen Namen eingeben.');
    const valid = new Set(sheet.tasks);
    const tasks = [...new Set((Array.isArray(body.tasks) ? body.tasks : []).map(String))].filter((t) => valid.has(t));
    const comment = cleanText(body.comment, 500);
    if (tasks.length === 0 && !comment) throw new HttpError(400, 'Bitte mindestens eine Aufgabe ankreuzen.');

    const submission = {
      id: newId(),
      sheetId: sheet.id,
      name,
      klasse,
      key: studentKey(name, klasse),
      tasks,
      comment,
      createdAt: new Date().toISOString(),
      late: isPastDeadline(sheet),
    };
    db.submissions.push(submission);
    saveDb();

    const mine = db.submissions.filter((s) => s.sheetId === sheet.id && s.key === submission.key);
    const done = new Set(mine.flatMap((s) => s.tasks));
    return send(res, 201, {
      ok: true,
      late: submission.late,
      submissionCount: mine.length,
      doneTasks: sheet.tasks.filter((t) => done.has(t)),
    });
  }

  // ---- Lehrerbereich ----
  if (parts[1] === 'admin') {
    if (!isTeacher(req)) throw new HttpError(401, 'Falsches Passwort.');

    if (method === 'POST' && parts[2] === 'login') return send(res, 200, { ok: true });

    if (method === 'GET' && parts[2] === 'data') {
      return send(res, 200, { serverTime: new Date().toISOString(), sheets: db.sheets, submissions: db.submissions });
    }

    if (method === 'POST' && parts[2] === 'sheets' && parts.length === 3) {
      const body = await readBody(req);
      const sheet = { id: newId(), createdAt: new Date().toISOString(), ...sheetFromBody(body) };
      db.sheets.push(sheet);
      saveDb();
      return send(res, 201, sheet);
    }

    if (parts[2] === 'sheets' && parts.length === 4) {
      const idx = db.sheets.findIndex((s) => s.id === parts[3]);
      if (idx === -1) throw new HttpError(404, 'Aufgabenblatt nicht gefunden.');
      if (method === 'PUT') {
        const body = await readBody(req);
        db.sheets[idx] = sheetFromBody(body, db.sheets[idx]);
        saveDb();
        return send(res, 200, db.sheets[idx]);
      }
      if (method === 'DELETE') {
        const [removed] = db.sheets.splice(idx, 1);
        db.submissions = db.submissions.filter((s) => s.sheetId !== removed.id);
        saveDb();
        return send(res, 200, { ok: true });
      }
    }

    if (method === 'DELETE' && parts[2] === 'submissions' && parts.length === 4) {
      const before = db.submissions.length;
      db.submissions = db.submissions.filter((s) => s.id !== parts[3]);
      if (db.submissions.length === before) throw new HttpError(404, 'Abgabe nicht gefunden.');
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Nicht gefunden.');
}

// ---------- Statische Dateien ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/lehrer') pathname = '/lehrer.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Verboten');
  fs.readFile(file, (err, content) => {
    if (err) return send(res, 404, 'Nicht gefunden');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else send(res, 405, 'Methode nicht erlaubt');
  } catch (e) {
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else {
      console.error(e);
      send(res, 500, { error: 'Serverfehler.' });
    }
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Abgabemathe läuft auf http://localhost:${PORT}`);
    console.log(`Lehrerbereich:     http://localhost:${PORT}/lehrer`);
  });
}

module.exports = { server, parseTasks };
