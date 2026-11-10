// Lehrerseite
const $ = (id) => document.getElementById(id);
let me = null;
let data = { sheets: [], submissions: [], users: [], questions: [] };
let showResolved = false;
let usersById = new Map();
let tab = sessionStorage.getItem('teacherTab') || 'overview';
let filterKlasse = '';
let search = '';

const adminApi = (path, opts = {}) => api('admin' + path, opts);

// ---------- Anmeldung & Ersteinrichtung ----------

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await api('login', { method: 'POST', body: { username: $('lUser').value, password: $('pw').value } });
    if (r.user.role !== 'teacher') {
      $('loginMsg').innerHTML = '<div class="msg warn">Das ist ein Schüler-Konto. <a href="./">Zur Schülerseite</a></div>';
      return;
    }
    start();
  } catch (err) {
    $('loginMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
};

$('sUser').oninput = () => { $('sUser').dataset.edited = '1'; };
$('sName').oninput = () => { if (!$('sUser').dataset.edited) $('sUser').value = suggestUsername($('sName').value.replace(/^(mag|dr|prof|di|bed|msc|ba|ma)\.?\s+/gi, '')); };

$('setupForm').onsubmit = async (e) => {
  e.preventDefault();
  if ($('sPw').value !== $('sPw2').value) {
    $('setupMsg').innerHTML = '<div class="msg err">Die Passwörter stimmen nicht überein.</div>';
    return;
  }
  try {
    await api('setup', { method: 'POST', body: { code: $('sCode').value, name: $('sName').value, username: $('sUser').value, password: $('sPw').value } });
    start();
  } catch (err) {
    $('setupMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
};

function show(which) {
  $('loading').classList.add('hidden');
  $('loginCard').classList.toggle('hidden', which !== 'login');
  $('setupCard').classList.toggle('hidden', which !== 'setup');
  $('app').classList.toggle('hidden', which !== 'app');
}

function renderUserBox() {
  $('userBox').innerHTML = me
    ? `<a href="./">Zur Schülerseite</a>
       <span class="small"><b>${esc(me.name)}</b></span>
       <button type="button" class="ghost small" id="pwBtn">Passwort</button>
       <button type="button" class="ghost small" id="logoutBtn">Abmelden</button>`
    : '<a href="./">Zur Schülerseite</a>';
  if (me) {
    $('pwBtn').onclick = openPasswordDialog;
    $('logoutBtn').onclick = logout;
  }
}

let started = false;
async function start() {
  let status;
  try {
    status = await loadMe();
  } catch (err) {
    $('loading').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    return;
  }
  me = status.user;
  renderUserBox();
  if (status.setupNeeded) return show('setup');
  if (!me || me.role !== 'teacher') {
    show('login');
    if (me) $('loginMsg').innerHTML = '<div class="msg warn">Du bist mit einem Schüler-Konto angemeldet. Melde dich mit deinem Lehrer-Konto an.</div>';
    return;
  }
  show('app');
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
    usersById = new Map(data.users.map((u) => [u.id, u]));
    $('klassenList').innerHTML = classes().map((c) => `<option value="${esc(c)}">`).join('');
    render();
  } catch (err) {
    if (err.status === 401 || err.status === 403) location.reload();
    else console.error(err);
  }
}

// ---------- Auswertung ----------

const byKlasseName = (a, b) => a.klasse.localeCompare(b.klasse, 'de', { numeric: true }) || a.name.localeCompare(b.name, 'de');

// Alle freigeschalteten Schüler-Konten
function activeStudents() {
  return data.users.filter((u) => u.role === 'student' && u.status === 'active').sort(byKlasseName);
}

function appliesTo(sheet, klasse) {
  return !sheet.klasse || sheet.klasse === klasse;
}

// Fasst alle Abgaben eines Blattes pro Schüler zusammen (Vereinigung aller angekreuzten Beispiele).
// Enthält auch Schüler der Klasse, die noch nichts abgegeben haben.
function summarize(sheet) {
  const byStudent = new Map();
  const add = (u) => {
    if (!byStudent.has(u.id)) {
      byStudent.set(u.id, { key: u.id, name: u.name, klasse: u.klasse, username: u.username, done: new Set(), onTime: new Set(), subs: [], late: false, last: null });
    }
    return byStudent.get(u.id);
  };
  activeStudents().filter((u) => appliesTo(sheet, u.klasse)).forEach(add);
  const subs = data.submissions.filter((s) => s.sheetId === sheet.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const s of subs) {
    const u = usersById.get(s.userId);
    if (!u) continue;
    const st = add(u);
    s.tasks.forEach((t) => {
      st.done.add(t);
      if (!s.late) st.onTime.add(t);
    });
    st.subs.push(s);
    if (s.late) st.late = true;
    st.last = s.createdAt;
  }
  return [...byStudent.values()].sort(byKlasseName);
}

function classes() {
  const set = new Set(data.users.filter((u) => u.role === 'student').map((u) => u.klasse).filter(Boolean));
  data.sheets.forEach((s) => { if (s.klasse) set.add(s.klasse); });
  return [...set].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
}

function matchesFilter(st) {
  if (filterKlasse && st.klasse !== filterKlasse) return false;
  if (search && !st.name.toLowerCase().includes(search.toLowerCase())) return false;
  return true;
}

function pct(n, total) {
  return total ? Math.round((n / total) * 100) : 0;
}

function progressHtml(n, total, need = 0) {
  const p = pct(n, total);
  return `<div class="actions" style="gap:6px;flex-wrap:nowrap"><div class="progress"><span class="${n >= need ? '' : 'warn'}" style="width:${p}%"></span></div><span class="small">${p}%</span></div>`;
}

// Status-Badge: erfüllt, fehlt X, oder nichts abgegeben
function statusBadge(st, need) {
  if (st.done.size >= need) return '<span class="badge ok">✓ erfüllt</span>';
  if (!st.subs.length) return '<span class="badge bad">nichts abgegeben</span>';
  return `<span class="badge warn">fehlt ${need - st.done.size}</span>`;
}

const pendingUsers = () => data.users.filter((u) => u.status === 'pending');

// Fragen zu einem Blatt (nur von existierenden Konten und zu Beispielen, die es noch gibt)
function questionsOf(sheet, { onlyOpen = false } = {}) {
  return (data.questions || []).filter((q) => q.sheetId === sheet.id && usersById.has(q.userId) && sheet.tasks.includes(q.task)
    && (!onlyOpen || !q.resolved));
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
  const fixed = ['overview', 'manage', 'accounts'];
  if (!fixed.includes(tab) && !data.sheets.some((s) => s.id === tab)) tab = 'overview';
  renderTabs();
  const manage = tab === 'manage';
  $('manageView').classList.toggle('hidden', !manage);
  $('sheetListCard').classList.toggle('hidden', !manage);
  if (manage) {
    $('view').innerHTML = '';
    renderSheetList();
  } else if (tab === 'overview') renderOverview();
  else if (tab === 'accounts') renderAccounts();
  else renderSheet(data.sheets.find((s) => s.id === tab));
}

function renderTabs() {
  const pending = pendingUsers().length;
  const items = [
    ['overview', '📋 Gesamtübersicht'],
    ...data.sheets.map((s) => [s.id, s.title, 0, questionsOf(s, { onlyOpen: true }).length]),
    ['manage', '⚙️ Blätter verwalten'],
    ['accounts', '👥 Konten', pending],
  ];
  $('tabs').innerHTML = items
    .map(([id, label, count, qCount]) => `<button type="button" class="${tab === id ? 'active' : ''}" data-tab="${esc(id)}">${esc(label)}${count ? ` <span class="count">${count}</span>` : ''}${qCount ? ` <span class="count q" title="offene Fragen">? ${qCount}</span>` : ''}</button>`)
    .join('');
  $('tabs').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      tab = b.dataset.tab;
      sessionStorage.setItem('teacherTab', tab);
      render();
      refresh(); // gleich die neuesten Abgaben holen
    };
  });
}

function pendingHint() {
  const n = pendingUsers().length;
  return n ? `<div class="msg warn">👋 ${n} offene Konto-Anfrage${n === 1 ? '' : 'n'} – <a href="#" id="goAccounts">jetzt ansehen</a></div>` : '';
}
function bindPendingHint() {
  const a = $('goAccounts');
  if (a) a.onclick = (e) => { e.preventDefault(); tab = 'accounts'; sessionStorage.setItem('teacherTab', tab); render(); };
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
    $('view').innerHTML = `${pendingHint()}<section class="card"><h2>Noch keine Aufgabenblätter</h2>
      <p class="muted">Lege unter „Blätter verwalten“ dein erstes Aufgabenblatt an.</p></section>`;
    bindPendingHint();
    return;
  }
  const summaries = new Map(sheets.map((s) => [s.id, new Map(summarize(s).map((st) => [st.key, st]))]));
  const students = activeStudents().map((u) => ({ key: u.id, name: u.name, klasse: u.klasse })).filter(matchesFilter);
  const mySheets = (st) => sheets.filter((sh) => appliesTo(sh, st.klasse));
  const metCount = (st) => mySheets(st).filter((sh) => {
    const x = summaries.get(sh.id).get(st.key);
    return x && x.done.size >= requiredOf(sh);
  }).length;

  const rows = students.map((st) => {
    const cells = sheets.map((sh) => {
      if (!appliesTo(sh, st.klasse)) return '<td class="c na" title="nicht für diese Klasse"></td>';
      const x = summaries.get(sh.id).get(st.key);
      if (!x || !x.subs.length) return '<td class="c no">–</td>';
      const met = x.done.size >= requiredOf(sh);
      return `<td class="c ${met ? 'yes' : ''}" title="${met ? 'erfüllt' : `fehlt ${requiredOf(sh) - x.done.size}`}">${x.done.size}/${sh.tasks.length}${met ? ' ✓' : ''}${x.late ? ' <span class="badge warn">spät</span>' : ''}</td>`;
    }).join('');
    const met = metCount(st);
    const total = mySheets(st).length;
    return `<tr><td class="sticky">${esc(st.name)}</td><td>${esc(st.klasse)}</td>${cells}
      <td class="c ${met === total ? 'yes' : ''}"><b>${met}/${total}</b></td></tr>`;
  }).join('');

  const foot = sheets.map((sh) => {
    const all = [...summaries.get(sh.id).values()].filter(matchesFilter);
    const handed = all.filter((x) => x.subs.length).length;
    const met = all.filter((x) => x.done.size >= requiredOf(sh)).length;
    return `<td class="c">${handed} von ${all.length} abgegeben<br><span style="color:var(--ok)">${met} erfüllt</span></td>`;
  }).join('');

  $('view').innerHTML = `${pendingHint()}<section class="card">
    <div class="actions" style="justify-content: space-between">
      <h2 style="margin:0">Gesamtübersicht</h2>
      <button type="button" class="secondary small" id="csvAll">CSV exportieren</button>
    </div>
    <p class="muted small">Erledigte Beispiele pro Schüler und Blatt (alle Abgaben zusammengerechnet). ✓ = Blatt erfüllt, – = noch nichts abgegeben. Aktualisiert sich automatisch.</p>
    ${filterBarHtml()}
    ${students.length ? `<div class="table-wrap"><table>
      <thead><tr><th class="sticky">Name</th><th>Klasse</th>${sheets.map((s) => `<th class="c">${esc(s.title)}<br><span class="muted">${s.klasse ? 'nur ' + esc(s.klasse) + ' · ' : ''}${s.deadline ? fmtDate(s.deadline) : 'ohne Frist'} · ${requiredOf(s)}/${s.tasks.length} nötig</span>${questionsOf(s, { onlyOpen: true }).length ? `<br><span class="qbadge">❓ ${questionsOf(s, { onlyOpen: true }).length} offene Fragen</span>` : ''}</th>`).join('')}<th class="c">Blätter<br>erfüllt</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="sticky">${students.length} Schüler</td><td></td>${foot}<td></td></tr></tfoot>
    </table></div>` : '<p class="muted">Noch keine Schüler-Konten. Schüler können auf der Startseite ein Konto anfragen.</p>'}
  </section>`;
  bindFilters();
  bindPendingHint();
  $('csvAll').onclick = () => {
    const header = ['Name', 'Klasse', ...sheets.flatMap((s) => [s.title, s.title + ' erfüllt']), 'Blätter erfüllt', 'Blätter gesamt'];
    const lines = students.map((st) => {
      const cells = sheets.flatMap((sh) => {
        if (!appliesTo(sh, st.klasse)) return ['', ''];
        const x = summaries.get(sh.id).get(st.key);
        if (!x || !x.subs.length) return ['', 'nein'];
        return [`${x.done.size}/${sh.tasks.length}`, x.done.size >= requiredOf(sh) ? 'ja' : 'nein'];
      });
      return [st.name, st.klasse, ...cells, metCount(st), mySheets(st).length];
    });
    downloadCsv('gesamtuebersicht.csv', [header, ...lines]);
  };
}

function renderSheet(sheet) {
  const students = summarize(sheet).filter(matchesFilter);
  const n = sheet.tasks.length;
  const need = requiredOf(sheet);
  const handed = students.filter((s) => s.subs.length).length;
  const complete = students.filter((s) => s.done.size >= need).length;
  const avg = students.length ? Math.round(students.reduce((a, s) => a + pct(s.done.size, n), 0) / students.length) : 0;
  const lateCount = students.filter((s) => s.late).length;
  const subCount = students.reduce((a, s) => a + s.subs.length, 0);

  const openQ = questionsOf(sheet, { onlyOpen: true });
  const qByCell = new Map(openQ.map((q) => [q.userId + '|' + q.task, q]));
  const cellQ = (st, t) => {
    const q = qByCell.get(st.key + '|' + t);
    return q ? `<span class="cellq" title="Frage${q.text ? ': ' + esc(q.text) : ''}">?</span>` : '';
  };
  const rows = students.map((st) => `<tr class="${st.subs.length ? '' : 'missing'}">
      <td class="sticky">${esc(st.name)}${st.late ? ' <span class="badge warn">spät</span>' : ''}</td>
      <td>${esc(st.klasse)}</td>
      ${sheet.tasks.map((t) => st.done.has(t)
        ? `<td class="c yes" title="${st.onTime.has(t) ? 'rechtzeitig' : 'verspätet'}">${st.onTime.has(t) ? '✓' : '<span style="color:var(--warn)">✓</span>'}${cellQ(st, t)}</td>`
        : `<td class="c no">·${cellQ(st, t)}</td>`).join('')}
      <td>${st.done.size}/${n}</td>
      <td>${progressHtml(st.done.size, n, need)}</td>
      <td>${statusBadge(st, need)}</td>
      <td class="c">${st.subs.length}</td>
      <td class="small">${fmtDate(st.last)}</td>
    </tr>`).join('');

  const colTotals = sheet.tasks.map((t) => {
    const c = students.filter((s) => s.done.has(t)).length;
    return `<td class="c" title="${c} von ${students.length}">${c}</td>`;
  }).join('');

  const history = data.submissions
    .filter((s) => s.sheetId === sheet.id)
    .map((s) => ({ ...s, user: usersById.get(s.userId) || { name: '?', klasse: '' } }))
    .filter((s) => matchesFilter(s.user))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  $('view').innerHTML = `<section class="card">
    <div class="actions" style="justify-content: space-between">
      <h2 style="margin:0">${esc(sheet.title)} ${sheet.klasse ? `<span class="badge">${esc(sheet.klasse)}</span>` : ''} ${sheet.open ? '' : '<span class="badge bad">versteckt</span>'}</h2>
      <span data-deadline="${esc(sheet.deadline || '')}">${timerHtml(sheet.deadline)}</span>
    </div>
    <p class="muted small">${sheet.description ? esc(sheet.description) + ' · ' : ''}Erfüllt ab ${sheet.minPercent} % = <b>${need} von ${n}</b> Beispielen. ${sheet.deadline ? `Frist: ${fmtDate(sheet.deadline)} · ${sheet.lockAfterDeadline ? 'danach gesperrt' : 'späte Abgaben erlaubt'}` : ''}</p>
    <div class="stats">
      <div class="stat"><b>${handed}<small> / ${students.length}</small></b><span class="muted small">haben abgegeben</span></div>
      <div class="stat"><b>${complete}</b><span class="muted small">erfüllt (≥ ${sheet.minPercent} %)</span></div>
      <div class="stat"><b>${students.length - complete}</b><span class="muted small">noch nicht erfüllt</span></div>
      <div class="stat"><b>${avg}%</b><span class="muted small">Durchschnitt erledigt</span></div>
      <div class="stat"><b>${subCount}</b><span class="muted small">Abgaben insgesamt</span></div>
      <div class="stat"><b>${lateCount}</b><span class="muted small">mit verspäteter Abgabe</span></div>
    </div>
    ${filterBarHtml()}
    ${students.length ? `<div class="table-wrap"><table>
      <thead><tr><th class="sticky">Name</th><th>Klasse</th>${sheet.tasks.map((t) => {
        const qn = openQ.filter((q) => q.task === t).length;
        return `<th class="c">${esc(t)}${partsOf(sheet, t).length ? `<br><span class="muted">${esc(partsOf(sheet, t).join(''))}</span>` : ''}${qn ? `<br><span class="qbadge" title="${qn} offene Fragen">❓${qn}</span>` : ''}</th>`;
      }).join('')}<th>Erledigt</th><th></th><th>Status</th><th class="c">Abgaben</th><th>Letzte Abgabe</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="sticky">Wie viele haben's?</td><td></td>${colTotals}<td colspan="5"></td></tr></tfoot>
    </table></div>
    <p class="muted small">✓ grün = rechtzeitig, <span style="color:var(--warn)">✓</span> orange = nur verspätet abgegeben, <span class="cellq" style="position:static">?</span> = Frage markiert.</p>` : '<p class="muted">Noch keine Schüler für dieses Blatt.</p>'}
    <div class="actions" style="margin-top: 12px">
      <button type="button" class="secondary small" id="csvSheet" ${students.length ? '' : 'disabled'}>CSV exportieren</button>
    </div>
  </section>
  ${questionsCardHtml(sheet)}
  <section class="card">
    <details class="history">
      <summary>Alle einzelnen Abgaben (${history.length})</summary>
      ${history.length ? `<div class="table-wrap" style="margin-top: 10px"><table>
        <thead><tr><th>Zeit</th><th>Name</th><th>Klasse</th><th>Angekreuzt</th><th>Kommentar</th><th></th></tr></thead>
        <tbody>${history.map((s) => `<tr>
          <td class="small">${fmtDate(s.createdAt)} ${s.late ? '<span class="badge warn">spät</span>' : ''}</td>
          <td>${esc(s.user.name)}</td><td>${esc(s.user.klasse)}</td>
          <td style="white-space: normal">${esc(s.tasks.join(', '))}</td>
          <td style="white-space: normal">${esc(s.comment || '')}</td>
          <td><button type="button" class="danger small" data-del="${esc(s.id)}">Löschen</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Keine.</p>'}
    </details>
  </section>
  ${students.some((s) => s.subs.some((x) => x.comment)) ? `<section class="card"><h2>Kommentare</h2>${students.flatMap((st) => st.subs.filter((x) => x.comment).map((x) => `<p><b>${esc(st.name)}</b> <span class="muted small">${fmtDate(x.createdAt)}</span><br>${esc(x.comment)}</p>`)).join('')}</section>` : ''}`;

  bindFilters();
  bindQuestionsCard();
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
    const header = ['Name', 'Klasse', ...sheet.tasks.map((t) => taskText(sheet, t)), 'Erledigt', 'Von', 'Nötig', 'Erfüllt', 'Abgaben', 'Verspätet', 'Letzte Abgabe'];
    const lines = students.map((st) => [
      st.name, st.klasse, ...sheet.tasks.map((t) => (st.done.has(t) ? 'x' : '')),
      st.done.size, n, need, st.done.size >= need ? 'ja' : 'nein', st.subs.length, st.late ? 'ja' : 'nein', st.last ? fmtDate(st.last) : '',
    ]);
    downloadCsv(sheet.title.replace(/[^\w\-äöüÄÖÜß ]+/g, '_') + '.csv', [header, ...lines]);
  };
}

// Fragen-Karte: gruppiert nach Beispiel, meistgefragte zuerst
function questionsCardHtml(sheet) {
  const all = questionsOf(sheet).filter((q) => matchesFilter(usersById.get(q.userId)));
  if (!all.length) return '';
  const open = all.filter((q) => !q.resolved);
  const shown = showResolved ? all : open;
  const groups = sheet.tasks
    .map((t) => ({ task: t, items: shown.filter((q) => q.task === t), open: open.filter((q) => q.task === t).length }))
    .filter((g) => g.items.length)
    .sort((a, b) => b.open - a.open || sheet.tasks.indexOf(a.task) - sheet.tasks.indexOf(b.task));
  const resolvedCount = all.length - open.length;
  return `<section class="card">
    <div class="actions" style="justify-content: space-between">
      <h2 style="margin:0">❓ Fragen ${open.length ? `<span class="count q">${open.length}</span>` : ''}</h2>
      ${resolvedCount ? `<label class="checkline small"><input type="checkbox" id="showResolved" ${showResolved ? 'checked' : ''}> beantwortete anzeigen (${resolvedCount})</label>` : ''}
    </div>
    <p class="muted small">Beispiele, bei denen Schüler eine Frage markiert haben – die meistgefragten zuerst. Gut zum Besprechen in der Stunde.</p>
    ${groups.length ? groups.map((g) => `<div class="qgroup">
      <div class="actions" style="justify-content: space-between">
        <h3 style="margin:0">${esc(g.task)}${partsOf(sheet, g.task).length ? ` <span class="muted small">${esc(partsOf(sheet, g.task).join(''))}</span>` : ''}
          <span class="muted small">· ${g.open} offen${g.items.length > g.open ? `, ${g.items.length - g.open} beantwortet` : ''}</span></h3>
        ${g.open > 1 ? `<button type="button" class="secondary small" data-resolve-task="${esc(g.task)}">Alle zu ${esc(g.task)} beantwortet</button>` : ''}
      </div>
      <ul>${g.items.map((q) => {
        const u = usersById.get(q.userId);
        return `<li class="${q.resolved ? 'resolved' : ''}">
          <span><b>${esc(u.name)}</b> <span class="muted small">${esc(u.klasse)} · ${fmtDate(q.updatedAt)}</span>
          ${q.text ? `<br>„${esc(q.text)}“` : ''}</span>
          <button type="button" class="${q.resolved ? 'ghost' : 'secondary'} small" data-resolve="${esc(q.id)}" data-resolved="${q.resolved ? '0' : '1'}">${q.resolved ? 'wieder öffnen' : '✓ beantwortet'}</button>
        </li>`;
      }).join('')}</ul>
    </div>`).join('') : '<p class="muted">Alle Fragen sind beantwortet. 🎉</p>'}
  </section>`;
}

function bindQuestionsCard() {
  const cb = $('showResolved');
  if (cb) cb.onchange = () => { showResolved = cb.checked; render(); };
  $('view').querySelectorAll('[data-resolve]').forEach((b) => {
    b.onclick = () => userAction(() => adminApi(`/questions/${b.dataset.resolve}/resolve`, { method: 'POST', body: { resolved: b.dataset.resolved === '1' } }));
  });
  $('view').querySelectorAll('[data-resolve-task]').forEach((b) => {
    b.onclick = () => userAction(async () => {
      const sheet = data.sheets.find((s) => s.id === tab);
      const open = questionsOf(sheet, { onlyOpen: true }).filter((q) => q.task === b.dataset.resolveTask && matchesFilter(usersById.get(q.userId)));
      for (const q of open) await adminApi(`/questions/${q.id}/resolve`, { method: 'POST', body: { resolved: true } });
    });
  });
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

// ---------- Konten ----------

async function userAction(fn) {
  try {
    await fn();
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

function renderAccounts() {
  const pending = pendingUsers().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const accounts = data.users.filter((u) => u.status === 'active')
    .filter((u) => !filterKlasse || u.klasse === filterKlasse)
    .filter((u) => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.username.includes(search.toLowerCase()))
    .sort((a, b) => (a.role === b.role ? byKlasseName(a, b) : a.role === 'teacher' ? -1 : 1));

  $('view').innerHTML = `
  <section class="card">
    <h2>Offene Anfragen ${pending.length ? `<span class="count">${pending.length}</span>` : ''}</h2>
    ${pending.length ? `<p class="muted small">Prüfe, ob Name und Klasse stimmen. Erst nach „Annehmen“ kann sich der Schüler anmelden.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Klasse</th><th>Benutzername</th><th>Angefragt</th><th></th></tr></thead>
        <tbody>${pending.map((u) => `<tr>
          <td><b>${esc(u.name)}</b></td><td>${esc(u.klasse)}</td><td><code>${esc(u.username)}</code></td>
          <td class="small">${fmtDate(u.createdAt)}</td>
          <td><div class="actions" style="flex-wrap: nowrap">
            <button type="button" class="small" data-approve="${esc(u.id)}">✓ Annehmen</button>
            <button type="button" class="danger small" data-reject="${esc(u.id)}">Ablehnen</button>
          </div></td>
        </tr>`).join('')}</tbody></table></div>
      ${pending.length > 1 ? '<div class="actions" style="margin-top: 10px"><button type="button" class="secondary small" id="approveAll">Alle annehmen</button></div>' : ''}`
    : '<p class="muted">Keine offenen Anfragen. Schüler fragen auf der Startseite unter „Konto anfragen“ ein Konto an.</p>'}
  </section>

  <section class="card">
    <h2>Konten</h2>
    ${filterBarHtml()}
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Klasse</th><th>Benutzername</th><th>Rolle</th><th class="c">Abgaben</th><th></th></tr></thead>
      <tbody>${accounts.map((u) => `<tr>
        <td>${esc(u.name)}${u.id === me.id ? ' <span class="muted small">(du)</span>' : ''}</td>
        <td>${esc(u.klasse) || '<span class="muted">–</span>'}</td>
        <td><code>${esc(u.username)}</code></td>
        <td>${u.role === 'teacher' ? '<span class="badge">Lehrkraft</span>' : 'Schüler'}</td>
        <td class="c">${data.submissions.filter((s) => s.userId === u.id).length}</td>
        <td><div class="actions" style="flex-wrap: nowrap">
          <button type="button" class="ghost small" data-edit-user="${esc(u.id)}">Bearbeiten</button>
          <button type="button" class="ghost small" data-pw="${esc(u.id)}">Neues Passwort</button>
          ${u.id === me.id ? '' : `<button type="button" class="danger small" data-delete-user="${esc(u.id)}">Löschen</button>`}
        </div></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">Keine Konten gefunden.</td></tr>'}</tbody>
    </table></div>
  </section>

  <section class="card">
    <h2>Konto selbst anlegen</h2>
    <p class="muted small">Zum Beispiel für eine Kollegin oder einen Schüler, der sich nicht selbst registrieren kann. Das Konto ist sofort aktiv.</p>
    <form id="newUserForm">
      <div class="row">
        <div class="field"><label for="nuName">Name</label><input id="nuName" type="text" required></div>
        <div class="field" style="flex: 0 1 120px"><label for="nuKlasse">Klasse</label><input id="nuKlasse" type="text" list="klassenList"></div>
        <div class="field" style="flex: 0 1 160px"><label for="nuRole">Rolle</label>
          <select id="nuRole"><option value="student">Schüler</option><option value="teacher">Lehrkraft</option></select></div>
      </div>
      <div class="row">
        <div class="field"><label for="nuUser">Benutzername</label><input id="nuUser" type="text" autocapitalize="none" spellcheck="false" required></div>
        <div class="field"><label for="nuPw">Start-Passwort</label><input id="nuPw" type="text" minlength="6" autocomplete="off" required></div>
      </div>
      <div id="newUserMsg"></div>
      <button type="submit">Konto anlegen</button>
    </form>
  </section>`;

  bindFilters();
  const find = (id) => data.users.find((u) => u.id === id);
  $('view').querySelectorAll('[data-approve]').forEach((b) => {
    b.onclick = () => userAction(() => adminApi(`/users/${b.dataset.approve}/approve`, { method: 'POST' }));
  });
  if ($('approveAll')) {
    $('approveAll').onclick = () => userAction(async () => {
      for (const u of pending) await adminApi(`/users/${u.id}/approve`, { method: 'POST' });
    });
  }
  $('view').querySelectorAll('[data-reject]').forEach((b) => {
    b.onclick = () => {
      const u = find(b.dataset.reject);
      if (confirm(`Anfrage von „${u.name}“ ablehnen und löschen?`)) userAction(() => adminApi(`/users/${u.id}`, { method: 'DELETE' }));
    };
  });
  $('view').querySelectorAll('[data-delete-user]').forEach((b) => {
    b.onclick = () => {
      const u = find(b.dataset.deleteUser);
      if (confirm(`Konto „${u.name}“ (${u.username}) und alle Abgaben davon endgültig löschen?`)) userAction(() => adminApi(`/users/${u.id}`, { method: 'DELETE' }));
    };
  });
  $('view').querySelectorAll('[data-pw]').forEach((b) => {
    b.onclick = () => {
      const u = find(b.dataset.pw);
      const pw = prompt(`Neues Passwort für ${u.name} (mind. 6 Zeichen):`);
      if (pw) userAction(async () => {
        await adminApi(`/users/${u.id}/password`, { method: 'POST', body: { password: pw } });
        alert(`Passwort für ${u.username} wurde geändert.`);
      });
    };
  });
  $('view').querySelectorAll('[data-edit-user]').forEach((b) => {
    b.onclick = () => {
      const u = find(b.dataset.editUser);
      const name = prompt('Name:', u.name);
      if (name === null) return;
      const klasse = prompt('Klasse:', u.klasse);
      if (klasse === null) return;
      let role = u.role;
      if (u.id !== me.id) role = confirm(`Soll ${name} eine Lehrkraft sein?\nOK = Lehrkraft, Abbrechen = Schüler`) ? 'teacher' : 'student';
      userAction(() => adminApi(`/users/${u.id}`, { method: 'PUT', body: { name, klasse, role } }));
    };
  });
  $('nuName').oninput = () => { if (!$('nuUser').dataset.edited) $('nuUser').value = suggestUsername($('nuName').value); };
  $('nuUser').oninput = () => { $('nuUser').dataset.edited = '1'; };
  $('newUserForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const u = await adminApi('/users', {
        method: 'POST',
        body: { name: $('nuName').value, klasse: $('nuKlasse').value, role: $('nuRole').value, username: $('nuUser').value, password: $('nuPw').value },
      });
      await refresh();
      $('newUserMsg').innerHTML = `<div class="msg ok">Konto <b>${esc(u.username)}</b> angelegt.</div>`;
    } catch (err) {
      $('newUserMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  };
}

// ---------- Blätter verwalten ----------

function renderSheetList() {
  if (!data.sheets.length) {
    $('sheetList').innerHTML = '<p class="muted">Noch keine.</p>';
    return;
  }
  $('sheetList').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Titel</th><th>Klasse</th><th>Beispiele</th><th>Frist</th><th>Status</th><th class="c">Abgegeben</th><th></th></tr></thead>
    <tbody>${data.sheets.map((s) => {
      const sum = summarize(s);
      return `<tr>
      <td>${esc(s.title)}</td>
      <td>${s.klasse ? esc(s.klasse) : '<span class="muted">alle</span>'}</td>
      <td class="small" style="white-space: normal; max-width: 260px">${esc(s.tasks.map((t) => taskText(s, t)).join(', '))}<br><span class="muted">erfüllt ab ${s.minPercent} % = ${requiredOf(s)} von ${s.tasks.length}</span></td>
      <td class="small">${s.deadline ? fmtDate(s.deadline) : '–'}<br><span data-deadline="${esc(s.deadline || '')}">${timerHtml(s.deadline)}</span></td>
      <td>${s.open ? '<span class="badge ok">sichtbar</span>' : '<span class="badge bad">versteckt</span>'}</td>
      <td class="c">${sum.filter((x) => x.subs.length).length} / ${sum.length}</td>
      <td><div class="actions" style="flex-wrap: nowrap">
        <button type="button" class="secondary small" data-edit="${esc(s.id)}">Bearbeiten</button>
        <button type="button" class="ghost small" data-toggle="${esc(s.id)}">${s.open ? 'Verstecken' : 'Freigeben'}</button>
        <button type="button" class="danger small" data-remove="${esc(s.id)}">Löschen</button>
      </div></td>
    </tr>`;
    }).join('')}</tbody></table></div>`;

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
  $('fKlasseSheet').value = s.klasse || '';
  $('fTasks').value = s.tasks.map((t) => taskText(s, t)).join(', ');
  $('fDesc').value = s.description || '';
  $('fDeadline').value = toLocalInput(s.deadline);
  $('fLock').checked = !!s.lockAfterDeadline;
  $('fOpen').checked = !!s.open;
  $('fMin').value = s.minPercent ?? 80;
  renderPreview();
  $('formTitle').textContent = 'Aufgabenblatt bearbeiten';
  $('cancelEdit').classList.remove('hidden');
  $('formMsg').innerHTML = '';
  $('manageView').scrollIntoView({ behavior: 'smooth' });
}

// Live-Vorschau: welche Beispiele aus der Eingabe erkannt werden
function renderPreview() {
  const examples = AbgabeCore.parseExamples($('fTasks').value);
  if (!examples.length) { $('tasksPreview').innerHTML = ''; return; }
  const p = Number($('fMin').value) || 80;
  const need = AbgabeCore.requiredCount({ tasks: examples, minPercent: p });
  $('tasksPreview').innerHTML = `Erkannt: <b>${examples.length} Beispiele</b> – bei ${p} % sind <b>${need}</b> nötig<br>`
    + examples.map((e) => `<span class="chip">${esc(e.id)}${e.parts.length ? ` <small>${esc(e.parts.join(''))}</small>` : ''}</span>`).join('');
}
$('fTasks').oninput = renderPreview;
$('fMin').oninput = renderPreview;

function resetForm() {
  $('sheetForm').reset();
  $('tasksPreview').innerHTML = '';
  $('editId').value = '';
  $('formTitle').textContent = 'Neues Aufgabenblatt';
  $('cancelEdit').classList.add('hidden');
}
$('cancelEdit').onclick = () => { resetForm(); $('formMsg').innerHTML = ''; };

$('quick').querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    const days = Number(b.dataset.days);
    if (!days) { $('fDeadline').value = ''; return; }
    const d = new Date(now());
    d.setDate(d.getDate() + days);
    d.setHours(8, 0, 0, 0);
    $('fDeadline').value = toLocalInput(d.toISOString());
  };
});

$('sheetForm').onsubmit = async (e) => {
  e.preventDefault();
  // Beispiele im Browser erkennen: "2.16abc 3.18c" -> ["2.16", "3.18"] + Teilaufgaben
  const examples = AbgabeCore.parseExamples($('fTasks').value);
  const taskParts = {};
  examples.forEach((ex) => { if (ex.parts.length) taskParts[ex.id] = ex.parts; });
  const body = {
    title: $('fTitle').value,
    klasse: $('fKlasseSheet').value,
    tasks: examples.map((ex) => ex.id),
    taskParts,
    description: $('fDesc').value,
    deadline: $('fDeadline').value ? new Date($('fDeadline').value).toISOString() : null,
    lockAfterDeadline: $('fLock').checked,
    open: $('fOpen').checked,
    minPercent: Number($('fMin').value) || 80,
  };
  const id = $('editId').value;
  try {
    const saved = await adminApi(id ? '/sheets/' + id : '/sheets', { method: id ? 'PUT' : 'POST', body });
    $('formMsg').innerHTML = `<div class="msg ok">Gespeichert: „${esc(saved.title)}“ mit ${saved.tasks.length} Beispielen.</div>`;
    resetForm();
    refresh();
  } catch (err) {
    $('formMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
};

// ---------- Start ----------
start();
