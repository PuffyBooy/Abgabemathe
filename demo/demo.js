// GitHub-Pages-Demo: ersetzt den Server durch eine Speicherung im Browser (localStorage).
// Nutzt dieselbe Logik wie der echte Server (core.js). Wird nur in die Demo-Seite eingebunden.
(function () {
  'use strict';
  const KEY = 'abgabemathe-demo-db-v2';
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
        id: 'demo-hue5', createdAt: at(-2 * day), title: 'Hausübung 5 – Bruchrechnen', description: 'Buch Kapitel 2 und 3',
        tasks: '2.16abc 2.17 2.18a-c 2.19 2.20ab 3.18c 3.19 3.20ab 3.21 3.22', deadline: at(3 * day), lockAfterDeadline: false, open: true, minPercent: 80,
      },
      {
        id: 'demo-hue6', createdAt: at(-1 * day), title: 'Hausübung 6 – Gleichungen', description: '',
        tasks: '7.19 7.20ab 7.21 7.22a-d 7.23', deadline: at(7 * day), lockAfterDeadline: true, open: true, minPercent: 80,
      },
      {
        id: 'demo-hue4', createdAt: at(-9 * day), title: 'Hausübung 4 – Prozentrechnung', description: '',
        tasks: '1.12 1.13ab 1.14 1.15a-c 1.16 1.17', deadline: at(-2 * day), lockAfterDeadline: false, open: true, minPercent: 80,
      },
    ];
    const people = [['Lena Huber', '3B'], ['Max Gruber', '3B'], ['Sara Novak', '3A'], ['Jonas Berger', '3A'], ['Emma Wagner', '3B']];
    const subs = [
      ['demo-hue4', 0, '1.12-1.17', -4 * day], ['demo-hue4', 1, '1.12 1.13 1.14 1.15', -3 * day],
      ['demo-hue4', 2, '1.12-1.16', -3 * day], ['demo-hue4', 3, '1.12 1.13', -2.5 * day],
      ['demo-hue4', 3, '1.14 1.15 1.16', -1 * day], ['demo-hue4', 4, '1.12-1.17', -2.2 * day],
      ['demo-hue5', 0, '2.16-2.20 3.18', -1 * day], ['demo-hue5', 0, '3.19 3.20', -3 * 60 * min],
      ['demo-hue5', 2, '2.16-2.20 3.18-3.22', -20 * 60 * min],
      ['demo-hue5', 1, '2.16 2.17', -2 * 60 * min, 'Bei 2.18 bin ich nicht weitergekommen.'],
      ['demo-hue6', 2, '7.19 7.20', -30 * min],
    ];
    // Aufgaben-Text -> Beispiele (Nummern) mit Teilaufgaben
    sheets.forEach((s) => {
      const examples = core.parseExamples(s.tasks);
      s.tasks = examples.map((e) => e.id);
      s.taskParts = {};
      examples.forEach((e) => { if (e.parts.length) s.taskParts[e.id] = e.parts; });
    });
    const submissions = subs.map(([sheetId, p, tasks, offset, comment]) => {
      const sheet = sheets.find((s) => s.id === sheetId);
      const [name, klasse] = people[p];
      const createdAt = at(offset);
      return {
        id: core.newId(), sheetId, name, klasse, key: core.studentKey(name, klasse),
        tasks: core.parseExamples(tasks).map((e) => e.id), comment: comment || '', createdAt,
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
