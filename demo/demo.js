// GitHub-Pages-Demo: ersetzt den Server durch eine Speicherung im Browser (localStorage).
// Nutzt dieselbe Logik wie der echte Server (core.js). Wird nur in die Demo-Seite eingebunden.
(function () {
  'use strict';
  const KEY = 'abgabemathe-demo-db';
  const PASSWORD = 'demo';
  const core = window.AbgabeCore;
  let memoryDb = null; // falls localStorage nicht verfügbar ist

  function seed() {
    const now = Date.now();
    const min = 60 * 1000;
    const day = 24 * 60 * min;
    const at = (offset) => new Date(now + offset).toISOString();
    const sheets = [
      {
        id: 'demo-hue5', createdAt: at(-2 * day), title: 'Hausübung 5 – Bruchrechnen', description: 'Buch S. 42–45',
        tasks: core.parseTasks('1-8, 9a, 9b'), deadline: at(3 * day), lockAfterDeadline: false, open: true,
      },
      {
        id: 'demo-stunde', createdAt: at(-5 * min), title: 'Stundenübung (Zeitlimit 20 Min)', description: 'Arbeitsblatt Gleichungen',
        tasks: core.parseTasks('1-6'), deadline: at(20 * min), lockAfterDeadline: true, open: true,
      },
      {
        id: 'demo-hue4', createdAt: at(-9 * day), title: 'Hausübung 4 – Prozentrechnung', description: '',
        tasks: core.parseTasks('1-6'), deadline: at(-2 * day), lockAfterDeadline: false, open: true,
      },
    ];
    const people = [['Lena Huber', '3B'], ['Max Gruber', '3B'], ['Sara Novak', '3A'], ['Jonas Berger', '3A'], ['Emma Wagner', '3B']];
    const subs = [
      ['demo-hue4', 0, '1-6', -4 * day], ['demo-hue4', 1, '1-4', -3 * day], ['demo-hue4', 2, '1-6', -3 * day],
      ['demo-hue4', 3, '1-3', -2.5 * day], ['demo-hue4', 3, '4,5', -1 * day], ['demo-hue4', 4, '1-6', -2.2 * day],
      ['demo-hue5', 0, '1-5, 9a', -1 * day], ['demo-hue5', 0, '6,7', -3 * 60 * min], ['demo-hue5', 2, '1-8, 9a, 9b', -20 * 60 * min],
      ['demo-hue5', 1, '1,2', -2 * 60 * min, 'Bei 3 bin ich nicht weitergekommen.'],
      ['demo-stunde', 2, '1-3', -1 * min],
    ];
    const submissions = subs.map(([sheetId, p, tasks, offset, comment]) => {
      const sheet = sheets.find((s) => s.id === sheetId);
      const [name, klasse] = people[p];
      const createdAt = at(offset);
      return {
        id: core.newId(), sheetId, name, klasse, key: core.studentKey(name, klasse),
        tasks: core.parseTasks(tasks), comment: comment || '', createdAt,
        late: !!sheet.deadline && new Date(createdAt) > new Date(sheet.deadline),
      };
    });
    return { sheets, submissions };
  }

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

  function request(method, path, body, headers) {
    const db = load();
    const pw = headers['X-Teacher-Password'] || headers['x-teacher-password'] || '';
    try {
      const r = core.handle(db, { method, path: '/' + path.replace(/^\//, ''), body: body || {}, isTeacher: pw === PASSWORD });
      if (r.changed) save(db);
      // Kopie zurückgeben, damit die Seite die gespeicherten Daten nicht verändert
      return { status: r.status, data: JSON.parse(JSON.stringify(r.data)) };
    } catch (e) {
      if (e instanceof core.HttpError) return { status: e.status, data: { error: e.message } };
      throw e;
    }
  }

  function reset() {
    try {
      localStorage.removeItem(KEY);
      Object.keys(localStorage).filter((k) => k.startsWith('done:')).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignorieren */ }
    memoryDb = null;
    location.reload();
  }

  window.AbgabeDemo = { request, reset, PASSWORD };

  // Hinweis-Leiste oben auf der Seite
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.className = 'demo-bar';
    bar.innerHTML = `<div class="inner">
      <span><b>Demo</b> – alle Daten bleiben nur in deinem Browser. Lehrer-Passwort: <code>${PASSWORD}</code></span>
      <button type="button" class="ghost small">Demo zurücksetzen</button>
    </div>`;
    bar.querySelector('button').onclick = () => {
      if (confirm('Alle Demo-Daten löschen und Beispieldaten neu laden?')) reset();
    };
    document.body.prepend(bar);
    const pw = document.getElementById('pw');
    if (pw) pw.placeholder = `Demo: ${PASSWORD}`;
  });
})();
