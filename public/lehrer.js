// Lehrerseite
const $ = (id) => document.getElementById(id);
let password = sessionStorage.getItem('teacherPw') || '';
let data = { sheets: [], submissions: [] };
let tab = sessionStorage.getItem('teacherTab') || 'overview';
let filterKlasse = '';
let search = '';

const adminApi = (path, opts = {}) => api('api/admin' + path, { ...opts, headers: { 'X-Teacher-Password': password } });

// ---------- Anmeldung ----------

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  password = $('pw').value;
  try {
    await adminApi('/login', { method: 'POST' });
    sessionStorage.setItem('teacherPw', password);
    start();
  } catch (err) {
    $('loginMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
};

$('logoutBtn').onclick = () => {
  sessionStorage.removeItem('teacherPw');
  location.reload();
};

function showLogin() {
  $('loginCard').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  $('pw').focus();
}

let started = false;
async function start() {
  $('loginCard').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  await refresh();
  if (started) return;
  started = true;
  setInterval(refresh, 15000);
  setInterval(tickTimers, 1000);
}

async function refresh() {
  try {
    data = await adminApi('/data');
    syncServerTime(data.serverTime);
    render();
  } catch (err) {
    if (err.status === 401) showLogin();
    else console.error(err);
  }
}

// ---------- Auswertung ----------

// Fasst alle Abgaben eines Blattes pro Schüler zusammen (Vereinigung aller angekreuzten Aufgaben).
function summarize(sheet) {
  const byStudent = new Map();
  const subs = data.submissions
    .filter((s) => s.sheetId === sheet.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const s of subs) {
    let st = byStudent.get(s.key);
    if (!st) {
      st = { key: s.key, name: s.name, klasse: s.klasse, done: new Set(), subs: [], late: false, onTime: new Set() };
      byStudent.set(s.key, st);
    }
    st.name = s.name; // neuester Schreibweise folgen
    st.klasse = s.klasse;
    s.tasks.forEach((t) => {
      st.done.add(t);
      if (!s.late) st.onTime.add(t);
    });
    st.subs.push(s);
    if (s.late) st.late = true;
    st.last = s.createdAt;
  }
  return [...byStudent.values()].sort((a, b) => a.klasse.localeCompare(b.klasse, 'de') || a.name.localeCompare(b.name, 'de'));
}

function allStudents() {
  const map = new Map();
  for (const s of data.submissions) {
    if (!map.has(s.key) || map.get(s.key).createdAt < s.createdAt) map.set(s.key, s);
  }
  return [...map.values()]
    .map((s) => ({ key: s.key, name: s.name, klasse: s.klasse }))
    .sort((a, b) => a.klasse.localeCompare(b.klasse, 'de') || a.name.localeCompare(b.name, 'de'));
}

function classes() {
  return [...new Set(data.submissions.map((s) => s.klasse).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
}

function matchesFilter(st) {
  if (filterKlasse && st.klasse !== filterKlasse) return false;
  if (search && !st.name.toLowerCase().includes(search.toLowerCase())) return false;
  return true;
}

function pct(n, total) {
  return total ? Math.round((n / total) * 100) : 0;
}

function progressHtml(n, total) {
  const p = pct(n, total);
  return `<div class="actions" style="gap:6px;flex-wrap:nowrap"><div class="progress"><span style="width:${p}%"></span></div><span class="small">${p}%</span></div>`;
}

// ---------- Darstellung ----------

function render() {
  // Fokus im Suchfeld beim automatischen Aktualisieren behalten
  const active = document.activeElement && document.activeElement.id === 'fSearch' ? $('fSearch').selectionStart : null;
  renderView();
  if (active !== null && $('fSearch')) {
    $('fSearch').focus();
    $('fSearch').setSelectionRange(active, active);
  }
}

function renderView() {
  if (tab !== 'overview' && tab !== 'manage' && !data.sheets.some((s) => s.id === tab)) tab = 'overview';
  renderTabs();
  const manage = tab === 'manage';
  $('manageView').classList.toggle('hidden', !manage);
  $('sheetListCard').classList.toggle('hidden', !manage);
  if (manage) {
    $('view').innerHTML = '';
    renderSheetList();
  } else if (tab === 'overview') renderOverview();
  else renderSheet(data.sheets.find((s) => s.id === tab));
}

function renderTabs() {
  const items = [['overview', '📋 Gesamtübersicht'], ...data.sheets.map((s) => [s.id, s.title]), ['manage', '⚙️ Blätter verwalten']];
  $('tabs').innerHTML = items
    .map(([id, label]) => `<button type="button" class="${tab === id ? 'active' : ''}" data-tab="${esc(id)}">${esc(label)}</button>`)
    .join('');
  $('tabs').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      tab = b.dataset.tab;
      sessionStorage.setItem('teacherTab', tab);
      render();
    };
  });
}

function filterBarHtml() {
  const cls = classes();
  return `<div class="row" style="margin-bottom: 12px; align-items: flex-end">
    <div class="field" style="flex: 0 1 180px; margin: 0">
      <label for="fKlasse">Klasse</label>
      <select id="fKlasse"><option value="">Alle</option>${cls.map((c) => `<option ${c === filterKlasse ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    </div>
    <div class="field" style="flex: 1 1 200px; margin: 0">
      <label for="fSearch">Name suchen</label>
      <input id="fSearch" type="text" value="${esc(search)}" placeholder="Name …">
    </div>
  </div>`;
}

function bindFilters() {
  $('fKlasse').onchange = (e) => { filterKlasse = e.target.value; render(); };
  $('fSearch').oninput = (e) => {
    search = e.target.value;
    render();
  };
}

function renderOverview() {
  const sheets = data.sheets;
  if (!sheets.length) {
    $('view').innerHTML = `<section class="card"><h2>Noch keine Aufgabenblätter</h2>
      <p class="muted">Lege unter „Blätter verwalten“ dein erstes Aufgabenblatt an.</p></section>`;
    return;
  }
  const summaries = new Map(sheets.map((s) => [s.id, new Map(summarize(s).map((st) => [st.key, st]))]));
  const students = allStudents().filter(matchesFilter);
  const totalTasks = sheets.reduce((n, s) => n + s.tasks.length, 0);

  const rows = students.map((st) => {
    let doneAll = 0;
    const cells = sheets.map((sh) => {
      const x = summaries.get(sh.id).get(st.key);
      if (!x) return '<td class="c no">–</td>';
      doneAll += x.done.size;
      const full = x.done.size === sh.tasks.length;
      return `<td class="c ${full ? 'yes' : ''}">${x.done.size}/${sh.tasks.length}${x.late ? ' <span class="badge warn">spät</span>' : ''}</td>`;
    }).join('');
    return `<tr><td class="sticky">${esc(st.name)}</td><td>${esc(st.klasse)}</td>${cells}<td>${progressHtml(doneAll, totalTasks)}</td></tr>`;
  }).join('');

  const foot = sheets.map((sh) => {
    const subs = [...summaries.get(sh.id).values()].filter(matchesFilter);
    return `<td class="c">${subs.length} abgegeben</td>`;
  }).join('');

  $('view').innerHTML = `<section class="card">
    <div class="actions" style="justify-content: space-between">
      <h2 style="margin:0">Gesamtübersicht</h2>
      <button type="button" class="secondary small" id="csvAll">CSV exportieren</button>
    </div>
    <p class="muted small">Erledigte Aufgaben pro Schüler und Blatt (alle Abgaben zusammengerechnet). Aktualisiert sich automatisch.</p>
    ${filterBarHtml()}
    ${students.length ? `<div class="table-wrap"><table>
      <thead><tr><th class="sticky">Name</th><th>Klasse</th>${sheets.map((s) => `<th class="c">${esc(s.title)}<br><span class="muted">${s.deadline ? fmtDate(s.deadline) : 'ohne Frist'}</span></th>`).join('')}<th>Gesamt</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="sticky">${students.length} Schüler</td><td></td>${foot}<td></td></tr></tfoot>
    </table></div>` : '<p class="muted">Noch keine Abgaben.</p>'}
  </section>`;
  bindFilters();
  $('csvAll').onclick = () => {
    const header = ['Name', 'Klasse', ...sheets.map((s) => s.title), 'Gesamt erledigt', 'Gesamt Aufgaben'];
    const lines = students.map((st) => {
      let doneAll = 0;
      const cells = sheets.map((sh) => {
        const x = summaries.get(sh.id).get(st.key);
        if (!x) return '';
        doneAll += x.done.size;
        return `${x.done.size}/${sh.tasks.length}`;
      });
      return [st.name, st.klasse, ...cells, doneAll, totalTasks];
    });
    downloadCsv('gesamtuebersicht.csv', [header, ...lines]);
  };
}

function renderSheet(sheet) {
  const students = summarize(sheet).filter(matchesFilter);
  const n = sheet.tasks.length;
  const complete = students.filter((s) => s.done.size === n).length;
  const avg = students.length ? Math.round(students.reduce((a, s) => a + pct(s.done.size, n), 0) / students.length) : 0;
  const lateCount = students.filter((s) => s.late).length;
  const subCount = students.reduce((a, s) => a + s.subs.length, 0);

  const rows = students.map((st) => `<tr>
      <td class="sticky">${esc(st.name)}${st.late ? ' <span class="badge warn">spät</span>' : ''}</td>
      <td>${esc(st.klasse)}</td>
      ${sheet.tasks.map((t) => st.done.has(t)
        ? `<td class="c yes" title="${st.onTime.has(t) ? 'rechtzeitig' : 'verspätet'}">${st.onTime.has(t) ? '✓' : '<span style="color:var(--warn)">✓</span>'}</td>`
        : '<td class="c no">·</td>').join('')}
      <td>${st.done.size}/${n}</td>
      <td>${progressHtml(st.done.size, n)}</td>
      <td class="c">${st.subs.length}</td>
      <td class="small">${fmtDate(st.last)}</td>
    </tr>`).join('');

  const colTotals = sheet.tasks.map((t) => {
    const c = students.filter((s) => s.done.has(t)).length;
    return `<td class="c" title="${c} von ${students.length}">${c}</td>`;
  }).join('');

  const history = data.submissions
    .filter((s) => s.sheetId === sheet.id)
    .filter((s) => matchesFilter(s))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  $('view').innerHTML = `<section class="card">
    <div class="actions" style="justify-content: space-between">
      <h2 style="margin:0">${esc(sheet.title)} ${sheet.open ? '' : '<span class="badge bad">versteckt</span>'}</h2>
      <span data-deadline="${esc(sheet.deadline || '')}">${timerHtml(sheet.deadline)}</span>
    </div>
    <p class="muted small">${esc(sheet.description || '')} ${sheet.deadline ? `Frist: ${fmtDate(sheet.deadline)} · ${sheet.lockAfterDeadline ? 'danach gesperrt' : 'späte Abgaben erlaubt'}` : ''}</p>
    <div class="stats">
      <div class="stat"><b>${students.length}</b><span class="muted small">Schüler haben abgegeben</span></div>
      <div class="stat"><b>${complete}</b><span class="muted small">alles erledigt</span></div>
      <div class="stat"><b>${avg}%</b><span class="muted small">Durchschnitt erledigt</span></div>
      <div class="stat"><b>${subCount}</b><span class="muted small">Abgaben insgesamt</span></div>
      <div class="stat"><b>${lateCount}</b><span class="muted small">mit verspäteter Abgabe</span></div>
    </div>
    ${filterBarHtml()}
    ${students.length ? `<div class="table-wrap"><table>
      <thead><tr><th class="sticky">Name</th><th>Klasse</th>${sheet.tasks.map((t) => `<th class="c">${esc(t)}</th>`).join('')}<th>Erledigt</th><th></th><th class="c">Abgaben</th><th>Letzte Abgabe</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="sticky">Wie viele haben's?</td><td></td>${colTotals}<td colspan="4"></td></tr></tfoot>
    </table></div>
    <p class="muted small">✓ grün = rechtzeitig, <span style="color:var(--warn)">✓</span> orange = nur verspätet abgegeben.</p>` : '<p class="muted">Noch keine Abgaben für dieses Blatt.</p>'}
    <div class="actions" style="margin-top: 12px">
      <button type="button" class="secondary small" id="csvSheet" ${students.length ? '' : 'disabled'}>CSV exportieren</button>
    </div>
  </section>
  <section class="card">
    <details class="history">
      <summary>Alle einzelnen Abgaben (${history.length})</summary>
      ${history.length ? `<div class="table-wrap" style="margin-top: 10px"><table>
        <thead><tr><th>Zeit</th><th>Name</th><th>Klasse</th><th>Angekreuzt</th><th>Kommentar</th><th></th></tr></thead>
        <tbody>${history.map((s) => `<tr>
          <td class="small">${fmtDate(s.createdAt)} ${s.late ? '<span class="badge warn">spät</span>' : ''}</td>
          <td>${esc(s.name)}</td><td>${esc(s.klasse)}</td>
          <td style="white-space: normal">${esc(s.tasks.join(', '))}</td>
          <td style="white-space: normal">${esc(s.comment || '')}</td>
          <td><button type="button" class="danger small" data-del="${esc(s.id)}">Löschen</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Keine.</p>'}
    </details>
  </section>
  ${students.some((s) => s.subs.some((x) => x.comment)) ? `<section class="card"><h2>Kommentare</h2>${students.flatMap((st) => st.subs.filter((x) => x.comment).map((x) => `<p><b>${esc(st.name)}</b> <span class="muted small">${fmtDate(x.createdAt)}</span><br>${esc(x.comment)}</p>`)).join('')}</section>` : ''}`;

  bindFilters();
  $('view').querySelector('details.history').open = sessionStorage.getItem('historyOpen') === '1';
  $('view').querySelector('details.history').ontoggle = (e) => sessionStorage.setItem('historyOpen', e.target.open ? '1' : '0');
  $('view').querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Diese Abgabe wirklich löschen?')) return;
      await adminApi('/submissions/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
      refresh();
    };
  });
  $('csvSheet').onclick = () => {
    const header = ['Name', 'Klasse', ...sheet.tasks.map((t) => 'Aufgabe ' + t), 'Erledigt', 'Von', 'Abgaben', 'Verspätet', 'Letzte Abgabe'];
    const lines = students.map((st) => [
      st.name, st.klasse, ...sheet.tasks.map((t) => (st.done.has(t) ? 'x' : '')),
      st.done.size, n, st.subs.length, st.late ? 'ja' : 'nein', fmtDate(st.last),
    ]);
    downloadCsv(sheet.title.replace(/[^\w\-äöüÄÖÜß ]+/g, '_') + '.csv', [header, ...lines]);
  };
}

function tickTimers() {
  document.querySelectorAll('[data-deadline]').forEach((el) => {
    el.innerHTML = timerHtml(el.dataset.deadline || null);
  });
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Blätter verwalten ----------

function renderSheetList() {
  if (!data.sheets.length) {
    $('sheetList').innerHTML = '<p class="muted">Noch keine.</p>';
    return;
  }
  $('sheetList').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Titel</th><th>Aufgaben</th><th>Frist</th><th>Status</th><th class="c">Schüler</th><th></th></tr></thead>
    <tbody>${data.sheets.map((s) => `<tr>
      <td>${esc(s.title)}</td>
      <td class="small" style="white-space: normal; max-width: 260px">${esc(s.tasks.join(', '))}</td>
      <td class="small">${s.deadline ? fmtDate(s.deadline) : '–'}<br><span data-deadline="${esc(s.deadline || '')}">${timerHtml(s.deadline)}</span></td>
      <td>${s.open ? '<span class="badge ok">sichtbar</span>' : '<span class="badge bad">versteckt</span>'}</td>
      <td class="c">${summarize(s).length}</td>
      <td><div class="actions" style="flex-wrap: nowrap">
        <button type="button" class="secondary small" data-edit="${esc(s.id)}">Bearbeiten</button>
        <button type="button" class="ghost small" data-toggle="${esc(s.id)}">${s.open ? 'Verstecken' : 'Freigeben'}</button>
        <button type="button" class="danger small" data-remove="${esc(s.id)}">Löschen</button>
      </div></td>
    </tr>`).join('')}</tbody></table></div>`;

  $('sheetList').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editSheet(data.sheets.find((s) => s.id === b.dataset.edit)); });
  $('sheetList').querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = async () => {
      const s = data.sheets.find((x) => x.id === b.dataset.toggle);
      await adminApi('/sheets/' + s.id, { method: 'PUT', body: { open: !s.open } });
      refresh();
    };
  });
  $('sheetList').querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = async () => {
      const s = data.sheets.find((x) => x.id === b.dataset.remove);
      if (!confirm(`„${s.title}“ und alle zugehörigen Abgaben endgültig löschen?`)) return;
      await adminApi('/sheets/' + s.id, { method: 'DELETE' });
      refresh();
    };
  });
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function editSheet(s) {
  $('editId').value = s.id;
  $('fTitle').value = s.title;
  $('fTasks').value = s.tasks.join(', ');
  $('fDesc').value = s.description || '';
  $('fDeadline').value = toLocalInput(s.deadline);
  $('fLock').checked = !!s.lockAfterDeadline;
  $('fOpen').checked = !!s.open;
  $('formTitle').textContent = 'Aufgabenblatt bearbeiten';
  $('cancelEdit').classList.remove('hidden');
  $('formMsg').innerHTML = '';
  $('manageView').scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
  $('sheetForm').reset();
  $('editId').value = '';
  $('formTitle').textContent = 'Neues Aufgabenblatt';
  $('cancelEdit').classList.add('hidden');
}
$('cancelEdit').onclick = () => { resetForm(); $('formMsg').innerHTML = ''; };

$('quick').querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    let d = new Date(now());
    if (b.dataset.min) d = new Date(d.getTime() + Number(b.dataset.min) * 60000);
    else if (b.dataset.preset === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); }
    else if (b.dataset.preset === 'week') { d.setDate(d.getDate() + 7); d.setHours(23, 59, 0, 0); }
    else { $('fDeadline').value = ''; return; }
    $('fDeadline').value = toLocalInput(d.toISOString());
  };
});

$('sheetForm').onsubmit = async (e) => {
  e.preventDefault();
  const body = {
    title: $('fTitle').value,
    tasks: $('fTasks').value,
    description: $('fDesc').value,
    deadline: $('fDeadline').value ? new Date($('fDeadline').value).toISOString() : null,
    lockAfterDeadline: $('fLock').checked,
    open: $('fOpen').checked,
  };
  const id = $('editId').value;
  try {
    const saved = await adminApi(id ? '/sheets/' + id : '/sheets', { method: id ? 'PUT' : 'POST', body });
    $('formMsg').innerHTML = `<div class="msg ok">Gespeichert: „${esc(saved.title)}“ mit ${saved.tasks.length} Aufgaben.</div>`;
    resetForm();
    refresh();
  } catch (err) {
    $('formMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
};

// ---------- Start ----------
if (password) start();
else showLogin();
