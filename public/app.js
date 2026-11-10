// Schülerseite
const $ = (id) => document.getElementById(id);
let me = null;
let sheets = [];
let current = null;

const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorieren */ } },
};

// ---------- Anmelden / Konto anfragen ----------

function showAuth(which) {
  document.querySelectorAll('[data-auth]').forEach((b) => b.classList.toggle('active', b.dataset.auth === which));
  $('loginForm').classList.toggle('hidden', which !== 'login');
  $('registerForm').classList.toggle('hidden', which !== 'register');
}
document.querySelectorAll('[data-auth]').forEach((b) => { b.onclick = () => showAuth(b.dataset.auth); });

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('login', { method: 'POST', body: { username: $('lUser').value, password: $('lPw').value } });
    start();
  } catch (err) {
    $('loginMsg').innerHTML = `<div class="msg ${err.status === 403 ? 'warn' : 'err'}">${esc(err.message)}</div>`;
  }
};

// Benutzernamen aus dem Namen vorschlagen, solange er nicht selbst geändert wurde
let userEdited = false;
$('rUser').oninput = () => { userEdited = true; };
$('rName').oninput = () => { if (!userEdited) $('rUser').value = suggestUsername($('rName').value); };

$('registerForm').onsubmit = async (e) => {
  e.preventDefault();
  if ($('rPw').value !== $('rPw2').value) {
    $('registerMsg').innerHTML = '<div class="msg err">Die Passwörter stimmen nicht überein.</div>';
    return;
  }
  try {
    await api('register', {
      method: 'POST',
      body: { name: $('rName').value, klasse: $('rKlasse').value, username: $('rUser').value, password: $('rPw').value },
    });
    const username = $('rUser').value.trim().toLowerCase();
    $('registerForm').reset();
    userEdited = false;
    showAuth('login');
    $('lUser').value = username;
    $('loginMsg').innerHTML = `<div class="msg ok">✅ Anfrage gesendet! Sobald deine Lehrkraft sie annimmt, kannst du dich hier mit
      <b>${esc(username)}</b> anmelden.</div>`;
  } catch (err) {
    $('registerMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
};

function renderUserBox() {
  $('userBox').innerHTML = me
    ? `<span class="small"><b>${esc(me.name)}</b>${me.klasse ? ' · ' + esc(me.klasse) : ''}</span>
       <button type="button" class="ghost small" id="pwBtn">Passwort</button>
       <button type="button" class="ghost small" id="logoutBtn">Abmelden</button>`
    : '<a href="lehrer.html">Lehrerbereich</a>';
  if (me) {
    $('pwBtn').onclick = openPasswordDialog;
    $('logoutBtn').onclick = logout;
  }
}

// ---------- Aufgabenblätter ----------

async function loadSheets() {
  try {
    const data = await api('sheets');
    syncServerTime(data.serverTime);
    sheets = data.sheets;
    if (current) {
      const updated = sheets.find((s) => s.id === current.id);
      const changed = !updated || updated.tasks.join() !== current.tasks.join() || updated.myDone.join() !== current.myDone.join();
      current = updated || null;
      if (changed) renderTasks();
      else renderHeader();
    } else {
      const remembered = sheets.find((s) => s.id === store.get('sheet', null));
      if (remembered) { current = remembered; renderTasks(); }
    }
    renderSheets();
  } catch (e) {
    if (e.status === 401) return location.reload();
    $('sheets').innerHTML = `<div class="msg err">Konnte Aufgabenblätter nicht laden: ${esc(e.message)}</div>`;
  }
}

function renderSheets() {
  if (!sheets.length) {
    $('sheets').innerHTML = '<p class="muted">Gerade gibt es keine Aufgabenblätter für dich.</p>';
    return;
  }
  $('sheets').innerHTML = sheets.map((s) => {
    const met = s.myDone.length >= s.required;
    const mine = s.mySubmissions
      ? ` · <span style="color:var(--${met ? 'ok' : 'warn'})">${met ? '✓ erfüllt' : `${s.myDone.length}/${s.tasks.length} erledigt`}</span>`
      : '';
    const status = !s.acceptsSubmissions
      ? '<span class="badge bad">geschlossen</span>'
      : s.deadline ? timerHtml(s.deadline).replace('class="timer', 'class="badge') : '<span class="badge">ohne Frist</span>';
    return `<button type="button" class="sheet-option ${current && current.id === s.id ? 'active' : ''} ${s.acceptsSubmissions ? '' : 'closed'}" data-id="${esc(s.id)}">
      <span>${esc(s.title)} <span class="muted small">· ${s.tasks.length} Beispiele, ${s.required} nötig</span>${mine}</span>${status}
    </button>`;
  }).join('');
  $('sheets').querySelectorAll('.sheet-option').forEach((btn) => {
    btn.onclick = () => {
      current = sheets.find((s) => s.id === btn.dataset.id);
      store.set('sheet', current.id);
      $('message').innerHTML = '';
      $('comment').value = '';
      $('tasks').innerHTML = '';
      renderSheets();
      renderTasks();
      $('taskCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function renderHeader() {
  if (!current) return;
  $('sheetTitle').textContent = current.title;
  $('sheetDesc').textContent = current.description || '';
  $('timer').innerHTML = timerHtml(current.deadline);
  let info = current.deadline ? `Abgabe bis ${fmtDate(current.deadline)}.` : '';
  if (current.deadline && !current.lockAfterDeadline) info += ' Spätere Abgaben werden als „verspätet“ markiert.';
  $('deadlineInfo').textContent = info;
  const closed = !current.acceptsSubmissions || (current.lockAfterDeadline && current.deadline && new Date(current.deadline).getTime() <= now());
  $('submitBtn').disabled = closed;
  $('submitBtn').textContent = closed ? 'Abgabe geschlossen' : 'Abgeben';
}

function renderTasks() {
  if (!current) { $('taskCard').classList.add('hidden'); return; }
  $('taskCard').classList.remove('hidden');
  const prev = new Set(current.myDone);
  const checked = new Set([...$('tasks').querySelectorAll('input:checked')].map((i) => i.value));
  $('tasks').innerHTML = current.tasks.map((t) => `
    <label class="task ${prev.has(t) ? 'prev' : ''}" title="${prev.has(t) ? 'schon abgegeben' : ''}">
      <input type="checkbox" value="${esc(t)}" ${prev.has(t) || checked.has(t) ? 'checked' : ''}>${esc(t)}${partsOf(current, t).length ? `<small>${esc(partsOf(current, t).join(' '))}</small>` : ''}
    </label>`).join('');
  $('prevInfo').textContent = prev.size
    ? `Gestrichelt = schon abgegeben (${prev.size} von ${current.tasks.length}, ${current.mySubmissions} Abgabe${current.mySubmissions === 1 ? '' : 'n'}).`
    : '';
  $('tasks').onchange = renderGoal;
  renderGoal();
  renderHeader();
}

// Fortschritt Richtung 80 % (bzw. eingestelltem Prozentsatz)
function renderGoal() {
  if (!current) return;
  const n = current.tasks.length;
  const need = current.required;
  const have = $('tasks').querySelectorAll('input:checked').length;
  const p = Math.round((have / n) * 100);
  const reached = have >= need;
  $('goal').innerHTML = `
    <div class="progress big"><span class="${reached ? '' : 'warn'}" style="width:${Math.min(100, p)}%"></span><i style="left:${current.minPercent}%"></i></div>
    <p class="small" style="margin: 6px 0 0">
      <b>${have} von ${n}</b> angekreuzt (${p} %) ·
      ${reached
        ? `<span style="color:var(--ok)"><b>✓ ${current.minPercent} % erreicht</b></span>`
        : `noch <b>${need - have}</b> bis ${current.minPercent} % (${need} Beispiele nötig)`}
    </p>`;
}

$('allBtn').onclick = () => { $('tasks').querySelectorAll('input').forEach((i) => { i.checked = true; }); renderGoal(); };
$('noneBtn').onclick = () => { $('tasks').querySelectorAll('input').forEach((i) => { i.checked = false; }); renderGoal(); };

$('submitBtn').onclick = async () => {
  const tasks = [...$('tasks').querySelectorAll('input:checked')].map((i) => i.value);
  const comment = $('comment').value.trim();
  if (!tasks.length && !comment) {
    $('message').innerHTML = '<div class="msg err">Bitte kreuze mindestens ein Beispiel an.</div>';
    return;
  }
  $('submitBtn').disabled = true;
  try {
    const r = await api(`sheets/${encodeURIComponent(current.id)}/submit`, { method: 'POST', body: { tasks, comment } });
    current.myDone = r.doneTasks;
    current.mySubmissions = r.submissionCount;
    $('comment').value = '';
    renderTasks();
    renderSheets();
    const reached = r.doneTasks.length >= r.required;
    $('message').innerHTML = `<div class="msg ${r.late ? 'warn' : 'ok'}">
      ✅ Abgegeben! ${r.late ? '(verspätet) ' : ''}Insgesamt erledigt: <b>${r.doneTasks.length} von ${current.tasks.length}</b> Beispiele
      · ${r.submissionCount}. Abgabe zu diesem Blatt.<br>
      ${reached ? '<b>🎉 Blatt erfüllt!</b>' : `Dir fehlen noch <b>${r.required - r.doneTasks.length}</b> Beispiele bis ${current.minPercent} %. Du kannst später nochmal abgeben.`}</div>`;
  } catch (e) {
    $('message').innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
    loadSheets();
  } finally {
    renderHeader();
  }
};

// ---------- Start ----------

let timersStarted = false;
async function start() {
  try {
    const status = await loadMe();
    me = status.user;
  } catch (e) {
    $('loading').innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
    return;
  }
  $('loading').classList.add('hidden');
  renderUserBox();
  if (!me) {
    $('authCard').classList.remove('hidden');
    $('mainView').classList.add('hidden');
    return;
  }
  if (me.role === 'teacher') {
    location.href = 'lehrer.html';
    return;
  }
  $('authCard').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  await loadSheets();
  if (!timersStarted) {
    timersStarted = true;
    // Countdown jede Sekunde aktualisieren, Blätter alle 30 s neu laden
    setInterval(() => {
      if (current) renderHeader();
      document.querySelectorAll('.sheet-option').forEach((btn) => {
        const s = sheets.find((x) => x.id === btn.dataset.id);
        const badge = btn.lastElementChild;
        if (s && s.deadline && s.acceptsSubmissions && badge) badge.outerHTML = timerHtml(s.deadline).replace('class="timer', 'class="badge');
      });
    }, 1000);
    setInterval(loadSheets, 30000);
  }
}
start();
