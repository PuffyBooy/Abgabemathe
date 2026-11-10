// Erkennt Beispiele aus der Eingabe der Lehrkraft (z. B. "2.16abc 3.18c 7.19").
// Läuft im Browser (window.AbgabeCore) und in Node für die Tests (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AbgabeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function cleanText(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
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
      } else if ((m = t.match(/^(\d+(?:\.\d+)*)([a-z]{0,10})$/i))) { // 2.16a, 2.16ab, 7.19
        base = m[1];
        bareIndex = -1;
        if (m[2]) addLetters([...m[2]]);
        else {
          out.push(base);
          bareIndex = out.length - 1;
        }
      } else if (base && /^[a-z]{1,10}$/i.test(t)) { // b, bc (zur vorigen Nummer)
        addLetters([...t]);
      } else {
        out.push(t);
        base = null;
        bareIndex = -1;
      }
    }
    return [...new Set(out)].slice(0, 300);
  }

  // Fasst Teilaufgaben zu Beispielen zusammen – es zählt die Nummer:
  //   "2.16a b 3.18c 7.19" -> [{ id: "2.16", parts: ["a","b"] }, { id: "3.18", parts: ["c"] }, { id: "7.19", parts: [] }]
  function parseExamples(input) {
    const examples = [];
    const byId = new Map();
    for (const t of parseTasks(input)) {
      const m = t.match(/^(\d+(?:\.\d+)*)([a-z])$/);
      const id = m ? m[1] : t;
      let ex = byId.get(id);
      if (!ex) {
        ex = { id, parts: [] };
        byId.set(id, ex);
        examples.push(ex);
      }
      if (m && !ex.parts.includes(m[2])) ex.parts.push(m[2]);
    }
    return examples;
  }

  // Wie viele Beispiele für "erfüllt" nötig sind (Standard: 80 %).
  function requiredCount(sheet) {
    const p = sheet.minPercent ?? 80;
    return Math.ceil((sheet.tasks.length * p) / 100 - 1e-9);
  }

  return { parseTasks, parseExamples, requiredCount };
});
