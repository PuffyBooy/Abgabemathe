'use strict';
// Einfacher API-Test: node test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'abgabemathe-'));
process.env.TEACHER_PASSWORD = 'geheim';
const { server, parseTasks } = require('./server');

async function main() {
  assert.deepStrictEqual(parseTasks('1-3, 4a; 4b'), ['1', '2', '3', '4a', '4b']);

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
