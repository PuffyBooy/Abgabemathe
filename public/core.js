// Gemeinsame Abgabe-Logik (API).
// Läuft auf dem Server (Node, über require) und in der GitHub-Pages-Demo im Browser (window.AbgabeCore).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('crypto').webcrypto);
  else root.AbgabeCore = factory(root.crypto);
})(typeof self !== 'undefined' ? self : this, function (webcrypto) {
  'use strict';

  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function newId() {
    const bytes = new Uint8Array(8);
    webcrypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function cleanText(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // Schlüssel, um denselben Schüler bei mehreren Abgaben zu erkennen.
  function studentKey(name, klasse) {
    return (cleanText(klasse, 30) + '|' + cleanText(name, 80)).toLocaleLowerCase('de');
  }

  // Wandelt die Aufgaben-Eingabe des Lehrers in eine Liste um. Beispiele:
  //   "2.16a b 3.18c 7.19"   -> 2.16a, 2.16b, 3.18c, 7.19
  //   "2.16a-d"              -> 2.16a, 2.16b, 2.16c, 2.16d
  //   "2.16-2.18" / "2.16-18" -> 2.16, 2.17, 2.18
  //   "1-5, 6a, 6b"          -> 1, 2, 3, 4, 5, 6a, 6b
  // Trennzeichen: Leerzeichen, Komma, Strichpunkt, Zeilenumbruch, "und".
  function parseTasks(input) {
    if (Array.isArray(input)) return [...new Set(input.map((t) => cleanText(t, 40)).filter(Boolean))].slice(0, 300);

    const tokens = String(input ?? '')
      .replace(/\s+bis\s+/gi, '-')
      .replace(/\s*[-–]\s*/g, '-')
      .split(/[\s,;+&]+/)
      .filter((t) => t && !/^(und|u\.?)$/i.test(t));

    const out = [];
    let base = null; // zuletzt gesehene Nummer, z. B. "2.16" – für nachfolgende Buchstaben
    let bareIndex = -1; // Position einer Nummer ohne Buchstaben, die durch "a b …" ersetzt wird

    const letterRange = (a, b) => {
      const r = [];
      for (let c = a.toLowerCase().charCodeAt(0); c <= b.toLowerCase().charCodeAt(0); c++) r.push(String.fromCharCode(c));
      return r;
    };
    const addLetters = (letters) => {
      if (bareIndex !== -1 && out[bareIndex] === base) out.splice(bareIndex, 1);
      bareIndex = -1;
      letters.forEach((l) => out.push(base + l.toLowerCase()));
    };

    for (const t of tokens.map((x) => x.slice(0, 40))) {
      let m;
      if ((m = t.match(/^(\d+(?:\.\d+)*)([a-z])-([a-z])$/i))) { // 2.16a-d
        base = m[1];
        bareIndex = -1;
        addLetters(letterRange(m[2], m[3]));
      } else if (base && (m = t.match(/^([a-z])-([a-z])$/i))) { // a-d (zur vorigen Nummer)
        addLetters(letterRange(m[1], m[2]));
      } else if ((m = t.match(/^(\d+(?:\.\d+)*)-(\d+(?:\.\d+)*)$/))) { // 2.16-2.20, 2.16-20, 1-10
        const a = m[1].split('.');
        const b = m[2].split('.');
        const prefix = a.slice(0, -1);
        const from = Number(a[a.length - 1]);
        let to = null;
        if (b.length === 1) to = Number(b[0]);
        else if (b.length === a.length && b.slice(0, -1).join('.') === prefix.join('.')) to = Number(b[b.length - 1]);
        if (to !== null && to >= from && to - from < 100) {
          for (let i = from; i <= to; i++) out.push([...prefix, i].join('.'));
          base = out[out.length - 1];
          bareIndex = out.length - 1;
        } else {
          out.push(t);
          base = null;
        }
      } else if ((m = t.match(/^(\d+(?:\.\d+)*)([a-z]{0,4})$/i))) { // 2.16a, 2.16ab, 7.19
        base = m[1];
        bareIndex = -1;
        if (m[2]) addLetters([...m[2]]);
        else {
          out.push(base);
          bareIndex = out.length - 1;
        }
      } else if (base && /^[a-z]{1,4}$/i.test(t)) { // b, bc (zur vorigen Nummer)
        addLetters([...t]);
      } else {
        out.push(t);
        base = null;
        bareIndex = -1;
      }
    }
    return [...new Set(out)].slice(0, 300);
  }

  // Wie viele Aufgaben für "erfüllt" nötig sind (Standard: 80 %).
  function requiredCount(sheet) {
    const p = sheet.minPercent ?? 80;
    return Math.ceil((sheet.tasks.length * p) / 100 - 1e-9);
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
      minPercent: sheet.minPercent ?? 80,
      required: requiredCount(sheet),
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
      minPercent: body.minPercent !== undefined
        ? Math.min(100, Math.max(1, Math.round(Number(body.minPercent)) || 80))
        : existing.minPercent ?? 80,
    };
  }

  function emptyDb() {
    return { sheets: [], submissions: [] };
  }

  // Verarbeitet eine API-Anfrage.
  // req = { method, path: "/api/...", body, isTeacher }
  // Rückgabe: { status, data, changed } – changed = true, wenn db gespeichert werden muss.
  // Fehler werden als HttpError geworfen.
  function handle(db, req) {
    const parts = req.path.split('?')[0].split('/').filter(Boolean); // ["api", ...]
    const method = req.method;
    const body = req.body || {};
    const ok = (status, data, changed = false) => ({ status, data, changed });

    // Öffentlich: Liste der Aufgabenblätter
    if (method === 'GET' && parts[1] === 'sheets' && parts.length === 2) {
      const sheets = db.sheets.filter((s) => s.open).map(publicSheet);
      return ok(200, { serverTime: new Date().toISOString(), sheets });
    }

    // Öffentlich: Abgabe
    if (method === 'POST' && parts[1] === 'sheets' && parts[3] === 'submit' && parts.length === 4) {
      const sheet = db.sheets.find((s) => s.id === parts[2]);
      if (!sheet || !sheet.open) throw new HttpError(404, 'Dieses Aufgabenblatt gibt es nicht (mehr).');
      if (!canSubmit(sheet)) throw new HttpError(403, 'Die Abgabefrist ist abgelaufen.');
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

      const mine = db.submissions.filter((s) => s.sheetId === sheet.id && s.key === submission.key);
      const done = new Set(mine.flatMap((s) => s.tasks));
      return ok(201, {
        ok: true,
        late: submission.late,
        submissionCount: mine.length,
        required: requiredCount(sheet),
        doneTasks: sheet.tasks.filter((t) => done.has(t)),
      }, true);
    }

    // ---- Lehrerbereich ----
    if (parts[1] === 'admin') {
      if (!req.isTeacher) throw new HttpError(401, 'Falsches Passwort.');

      if (method === 'POST' && parts[2] === 'login') return ok(200, { ok: true });

      if (method === 'GET' && parts[2] === 'data') {
        return ok(200, { serverTime: new Date().toISOString(), sheets: db.sheets, submissions: db.submissions });
      }

      if (method === 'POST' && parts[2] === 'sheets' && parts.length === 3) {
        const sheet = { id: newId(), createdAt: new Date().toISOString(), ...sheetFromBody(body) };
        db.sheets.push(sheet);
        return ok(201, sheet, true);
      }

      if (parts[2] === 'sheets' && parts.length === 4) {
        const idx = db.sheets.findIndex((s) => s.id === parts[3]);
        if (idx === -1) throw new HttpError(404, 'Aufgabenblatt nicht gefunden.');
        if (method === 'PUT') {
          db.sheets[idx] = sheetFromBody(body, db.sheets[idx]);
          return ok(200, db.sheets[idx], true);
        }
        if (method === 'DELETE') {
          const [removed] = db.sheets.splice(idx, 1);
          db.submissions = db.submissions.filter((s) => s.sheetId !== removed.id);
          return ok(200, { ok: true }, true);
        }
      }

      if (method === 'DELETE' && parts[2] === 'submissions' && parts.length === 4) {
        const before = db.submissions.length;
        db.submissions = db.submissions.filter((s) => s.id !== parts[3]);
        if (db.submissions.length === before) throw new HttpError(404, 'Abgabe nicht gefunden.');
        return ok(200, { ok: true }, true);
      }
    }

    throw new HttpError(404, 'Nicht gefunden.');
  }

  return { HttpError, handle, parseTasks, requiredCount, studentKey, emptyDb, newId };
});
