'use strict';
// Einfacher API-Test: node test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'abgabemathe-'));
process.env.TEACHER_PASSWORD = 'geheim';
const { server } = require('./server');
const { parseTasks, parseExamples, requiredCount } = require('./public/core.js');

async function main() {
  assert.deepStrictEqual(parseTasks('1-3, 4a; 4b'), ['1', '2', '3', '4a', '4b']);
  assert.deepStrictEqual(parseTasks('2.16a b 3.18c 7.19'), ['2.16a', '2.16b', '3.18c', '7.19']);
  assert.deepStrictEqual(parseTasks('2.16a-c, 3.1-3'), ['2.16a', '2.16b', '2.16c', '3.1', '3.2', '3.3']);
  assert.deepStrictEqual(parseTasks('7.19 a b und c'), ['7.19a', '7.19b', '7.19c']);
  assert.deepStrictEqual(parseExamples('2.16abc 3.18c 7.19 2.16d'), [
    { id: '2.16', parts: ['a', 'b', 'c', 'd'] }, { id: '3.18', parts: ['c'] }, { id: '7.19', parts: [] },
  ]);
  assert.strictEqual(requiredCount({ tasks: parseTasks('1-10'), minPercent: 80 }), 8);
  assert.strictEqual(requiredCount({ tasks: parseTasks('1-4') }), 4); // 3,2 -> aufrunden

  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, p, body, pw) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(pw ? { 'X-Teacher-Password': pw } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  assert.strictEqual((await call('GET', '/api/admin/data', null, 'falsch')).status, 401);

  const created = await call('POST', '/api/admin/sheets', { title: 'HÜ 1', tasks: '1-4', deadline: null }, 'geheim');
  assert.strictEqual(created.status, 201);
  const id = created.data.id;

  const s1 = await call('POST', `/api/sheets/${id}/submit`, { name: 'Lena Huber', klasse: '3B', tasks: ['1', '2', 'x'] });
  assert.strictEqual(s1.status, 201);
  assert.deepStrictEqual(s1.data.doneTasks, ['1', '2']);
  assert.strictEqual(s1.data.required, 4);

  // Zweite Abgabe – wird dazugezählt, Name mit anderer Schreibweise
  const s2 = await call('POST', `/api/sheets/${id}/submit`, { name: ' lena  huber ', klasse: '3b', tasks: ['4'] });
  assert.deepStrictEqual(s2.data.doneTasks, ['1', '2', '4']);
  assert.strictEqual(s2.data.submissionCount, 2);

  // Abgelaufene Frist mit Sperre
  await call('PUT', `/api/admin/sheets/${id}`, { deadline: new Date(Date.now() - 1000).toISOString(), lockAfterDeadline: true }, 'geheim');
  assert.strictEqual((await call('POST', `/api/sheets/${id}/submit`, { name: 'Max', tasks: ['1'] })).status, 403);

  // Abgelaufene Frist ohne Sperre -> verspätet
  await call('PUT', `/api/admin/sheets/${id}`, { lockAfterDeadline: false }, 'geheim');
  const late = await call('POST', `/api/sheets/${id}/submit`, { name: 'Max', tasks: ['1'] });
  assert.strictEqual(late.data.late, true);

  // Beispiele: es zählt die Nummer
  const ex = await call('POST', '/api/admin/sheets', { title: 'HÜ 2', tasks: '2.16a b 3.18c 7.19' }, 'geheim');
  assert.deepStrictEqual(ex.data.tasks, ['2.16', '3.18', '7.19']);
  assert.deepStrictEqual(ex.data.taskParts, { '2.16': ['a', 'b'], '3.18': ['c'] });
  const exSub = await call('POST', `/api/sheets/${ex.data.id}/submit`, { name: 'Lena', tasks: ['2.16', '7.19'] });
  assert.deepStrictEqual(exSub.data.doneTasks, ['2.16', '7.19']);
  assert.strictEqual(exSub.data.required, 3);
  await call('DELETE', `/api/admin/sheets/${ex.data.id}`, null, 'geheim');

  // Prozentsatz ändern
  const upd = await call('PUT', `/api/admin/sheets/${id}`, { minPercent: 50 }, 'geheim');
  assert.strictEqual(upd.data.minPercent, 50);

  // Verstecktes Blatt ist nicht sichtbar
  await call('PUT', `/api/admin/sheets/${id}`, { open: false }, 'geheim');
  assert.strictEqual((await call('GET', '/api/sheets')).data.sheets.length, 0);

  const all = await call('GET', '/api/admin/data', null, 'geheim');
  assert.strictEqual(all.data.submissions.length, 3);

  server.close();
  console.log('Alle Tests bestanden ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
