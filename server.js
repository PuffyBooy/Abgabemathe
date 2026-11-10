'use strict';
// Abgabemathe – kleiner Server ohne externe Abhängigkeiten.
// Start: node server.js   (Port über PORT, Lehrer-Passwort über TEACHER_PASSWORD)
// Die eigentliche API-Logik steckt in public/core.js (wird auch von der GitHub-Pages-Demo genutzt).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./public/core.js');

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
    return core.emptyDb();
  }
}

const db = loadDb();

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- HTTP ----------

function send(res, status, data) {
  const isText = typeof data === 'string';
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(isText ? data : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(new core.HttpError(413, 'Anfrage zu groß.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new core.HttpError(400, 'Ungültiges JSON.'));
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

async function handleApi(req, res, url) {
  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
  const result = core.handle(db, { method: req.method, path: url.pathname, body, isTeacher: isTeacher(req) });
  if (result.changed) saveDb();
  send(res, result.status, result.data);
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
    if (e instanceof core.HttpError) send(res, e.status, { error: e.message });
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

module.exports = { server, parseTasks: core.parseTasks };
