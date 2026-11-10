// GitHub-Pages-Demo: ersetzt den Server durch eine Speicherung im Browser (localStorage).
// Nutzt dieselbe Logik wie der echte Server (core.js). Wird nur in die Demo-Seite eingebunden.
(function () {
  'use strict';
  const KEY = 'abgabemathe-demo-db-v3';
  const PASSWORD = 'demo';
  const core = window.AbgabeCore;
  let memoryDb = null; // falls localStorage nicht verfügbar ist

  function seed() {
    // Zeitpunkt relativ zu heute: dayAt(-1, 17, 30) = gestern 17:30 (Ortszeit)
    const dayAt = (days, h, m = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
    // Frist an einem Schultag (Mo–Fr) um 8:00; fällt sie aufs Wochenende, wird sie verschoben (dir = -1 früher, +1 später)
    const schoolDay = (days, dir) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + dir);
      d.setHours(8, 0, 0, 0);
      return d;
    };
    // Zeitpunkt relativ zu einem Datum: rel(frist, -1, 20, 15) = Vortag 20:15
    const rel = (base, days, h, m = 0) => {
      const d = new Date(base);
      d.setDate(d.getDate() + days);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const due4 = schoolDay(-2, -1); // Hausübung 4: schon abgelaufen
    const due5 = schoolDay(3, 1);
    const due6 = schoolDay(8, 1);

    const sheets = [
      {
        id: 'demo-hue4', createdAt: rel(due4, -7, 9, 5), title: 'Hausübung 4 – Prozentrechnung', description: 'Buch S. 18–31',
        tasks: '1.12ab 1.14 1.15a-c 1.18 1.19 2.3ab', deadline: due4.toISOString(), lockAfterDeadline: false, open: true, minPercent: 80,
      },
      {
        id: 'demo-hue5', createdAt: dayAt(-3, 10, 15), title: 'Hausübung 5 – Bruchrechnen', description: 'Buch S. 40–62',
        tasks: '2.16abc 2.18 2.21ab 3.4 3.7c 3.11 3.18c 3.20ab 4.2 4.5', deadline: due5.toISOString(), lockAfterDeadline: false, open: true, minPercent: 80,
      },
      {
        id: 'demo-hue6', createdAt: dayAt(-1, 11, 50), title: 'Hausübung 6 – Gleichungen', description: 'Buch S. 120–131',
        tasks: '7.19 7.22ab 7.25 8.3a-d 8.6', deadline: due6.toISOString(), lockAfterDeadline: true, open: true, minPercent: 80,
      },
    ];

    const people = {
      lena: ['Lena Huber', '3B'], max: ['Max Gruber', '3B'], sara: ['Sara Novak', '3A'], jonas: ['Jonas Berger', '3A'],
      emma: ['Emma Wagner', '3B'], paul: ['Paul Steiner', '3A'], mia: ['Mia Hofer', '3B'], david: ['David Bauer', '3A'],
    };

    // [Blatt, Schüler, Beispiele, Zeitpunkt, Kommentar]
    const subs = [
      // Hausübung 4 (6 Beispiele, 5 nötig) – Frist schon abgelaufen
      ['demo-hue4', 'lena', '1.12 1.14 1.15 1.18 1.19 2.3', rel(due4, -4, 17, 30)],
      ['demo-hue4', 'sara', '1.12 1.14 1.15 1.18 1.19 2.3', rel(due4, -3, 15, 5)],
      ['demo-hue4', 'jonas', '1.12 1.14', rel(due4, -3, 18, 40)],
      ['demo-hue4', 'emma', '1.12 1.14 1.15 1.18 1.19 2.3', rel(due4, -2, 16, 50)],
      ['demo-hue4', 'max', '1.12 1.14 1.15 1.18', rel(due4, -1, 20, 15)],
      ['demo-hue4', 'paul', '1.12 1.14 1.15 1.18 1.19', rel(due4, -1, 21, 5)],
      ['demo-hue4', 'mia', '1.12 1.14 1.15', rel(due4, 0, 7, 40), 'Bei 1.18 und 2.3 kenne ich mich nicht aus.'],
      ['demo-hue4', 'david', '1.12 1.14 1.15 1.18 1.19 2.3', rel(due4, 0, 7, 55)],
      ['demo-hue4', 'jonas', '1.15 1.18 1.19', rel(due4, 1, 19, 10)], // verspätet nachgereicht

      // Hausübung 5 (10 Beispiele, 8 nötig) – Frist in 3 Tagen
      ['demo-hue5', 'lena', '2.16 2.18 2.21 3.4 3.7 3.11', dayAt(-2, 17, 20)],
      ['demo-hue5', 'emma', '2.16 2.18 2.21 3.4', dayAt(-2, 19, 30)],
      ['demo-hue5', 'paul', '2.16 2.18 2.21 3.4 3.7 3.11 3.18', dayAt(-1, 15, 55)],
      ['demo-hue5', 'sara', '2.16 2.18 2.21 3.4 3.7 3.11 3.18 3.20 4.2 4.5', dayAt(-1, 16, 30)],
      ['demo-hue5', 'lena', '3.18 3.20', dayAt(-1, 18, 5)],
      ['demo-hue5', 'max', '2.16 2.18', dayAt(-1, 20, 45), 'Bei 2.21 bin ich nicht weitergekommen.'],
      ['demo-hue5', 'mia', '2.16 2.18 2.21 3.4 3.7 3.11 3.18 3.20 4.2', dayAt(-1, 21, 10)],

      // Hausübung 6 (5 Beispiele, 4 nötig) – gerade erst ausgegeben
      ['demo-hue6', 'sara', '7.19 7.22', minutesAgo(25)],
    ];
    // Aufgaben-Text -> Beispiele (Nummern) mit Teilaufgaben
    sheets.forEach((s) => {
      const examples = core.parseExamples(s.tasks);
      s.tasks = examples.map((e) => e.id);
      s.taskParts = {};
      examples.forEach((e) => { if (e.parts.length) s.taskParts[e.id] = e.parts; });
    });
    const submissions = subs.map(([sheetId, who, tasks, createdAt, comment]) => {
      const sheet = sheets.find((s) => s.id === sheetId);
      const [name, klasse] = people[who];
      return {
        id: core.newId(), sheetId, name, klasse, key: core.studentKey(name, klasse),
        tasks: core.parseExamples(tasks).map((e) => e.id), comment: comment || '', createdAt,
        late: !!sheet.deadline && new Date(createdAt) > new Date(sheet.deadline),
      };
    });
    submissions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
