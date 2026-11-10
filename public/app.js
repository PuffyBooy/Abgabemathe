// Schülerseite
const $ = (id) => document.getElementById(id);
let sheets = [];
let current = null;

const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorieren */ } },
};

$('name').value = store.get('name', '');
$('klasse').value = store.get('klasse', '');
$('name').addEventListener('input', () => { store.set('name', $('name').value); renderTasks(); });
$('klasse').addEventListener('input', () => { store.set('klasse', $('klasse').value); renderTasks(); });

function doneKey(sheetId) {
  const who = ($('klasse').value.trim() + '|' + $('name').value.trim()).toLowerCase();
  return `done:${sheetId}:${who}`;
}

async function loadSheets() {
  try {
    const data = await api('api/sheets');
    syncServerTime(data.serverTime);
    sheets = data.sheets;
    if (current) {
      const updated = sheets.find((s) => s.id === current.id);
      const tasksChanged = !updated || updated.tasks.join() !== current.tasks.join();
      current = updated || null;
      if (tasksChanged) renderTasks();
      else renderHeader();
    } else {
      const remembered = sheets.find((s) => s.id === store.get('sheet', null));
      if (remembered) { current = remembered; renderTasks(); }
    }
    renderSheets();
  } catch (e) {
    $('sheets').innerHTML = `<div class="msg err">Konnte Aufgabenblätter nicht laden: ${esc(e.message)}</div>`;
  }
}

function renderSheets() {
  if (!sheets.length) {
    $('sheets').innerHTML = '<p class="muted">Gerade gibt es keine offenen Aufgabenblätter.</p>';
    return;
  }
  $('sheets').innerHTML = sheets.map((s) => {
    const status = !s.acceptsSubmissions
      ? '<span class="badge bad">geschlossen</span>'
      : s.deadline ? timerHtml(s.deadline).replace('class="timer', 'class="badge') : '<span class="badge">ohne Frist</span>';
    return `<button type="button" class="sheet-option ${current && current.id === s.id ? 'active' : ''} ${s.acceptsSubmissions ? '' : 'closed'}" data-id="${esc(s.id)}">
      <span>${esc(s.title)} <span class="muted small">· ${s.tasks.length} Aufgaben, ${requiredOf(s)} nötig</span></span>${status}
    </button>`;
  }).join('');
  $('sheets').querySelectorAll('.sheet-option').forEach((btn) => {
    btn.onclick = () => {
      current = sheets.find((s) => s.id === btn.dataset.id);
      store.set('sheet', current.id);
      $('message').innerHTML = '';
      $('comment').value = '';
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
  const prev = new Set(store.get(doneKey(current.id), []));
  const checked = new Set([...$('tasks').querySelectorAll('input:checked')].map((i) => i.value));
  $('tasks').innerHTML = current.tasks.map((t) => `
    <label class="task ${prev.has(t) ? 'prev' : ''}" title="${prev.has(t) ? 'schon abgegeben' : ''}">
      <input type="checkbox" value="${esc(t)}" ${prev.has(t) || checked.has(t) ? 'checked' : ''}>${esc(t)}
    </label>`).join('');
  $('prevInfo').textContent = prev.size
    ? `Gestrichelt = von dir schon abgegeben (${prev.size} von ${current.tasks.length}).`
    : '';
  $('tasks').onchange = renderGoal;
  renderGoal();
  renderHeader();
}

// Fortschritt Richtung 80 % (bzw. eingestelltem Prozentsatz)
function renderGoal() {
  if (!current) return;
  const n = current.tasks.length;
  const need = requiredOf(current);
  const have = $('tasks').querySelectorAll('input:checked').length;
  const p = Math.round((have / n) * 100);
  const reached = have >= need;
  $('goal').innerHTML = `
    <div class="progress big"><span class="${reached ? '' : 'warn'}" style="width:${Math.min(100, p)}%"></span><i style="left:${current.minPercent ?? 80}%"></i></div>
    <p class="small" style="margin: 6px 0 0">
      <b>${have} von ${n}</b> angekreuzt (${p} %) ·
      ${reached
        ? `<span style="color:var(--ok)"><b>✓ ${current.minPercent ?? 80} % erreicht</b></span>`
        : `noch <b>${need - have}</b> bis ${current.minPercent ?? 80} % (${need} Aufgaben nötig)`}
    </p>`;
}

$('allBtn').onclick = () => $('tasks').querySelectorAll('input').forEach((i) => { i.checked = true; });
$('noneBtn').onclick = () => $('tasks').querySelectorAll('input').forEach((i) => { i.checked = false; });

$('submitBtn').onclick = async () => {
  const name = $('name').value.trim();
  const klasse = $('klasse').value.trim();
  const tasks = [...$('tasks').querySelectorAll('input:checked')].map((i) => i.value);
  const comment = $('comment').value.trim();
  if (name.length < 2) {
    $('message').innerHTML = '<div class="msg err">Bitte gib oben deinen Namen ein.</div>';
    $('name').focus();
    return;
  }
  if (!tasks.length && !comment) {
    $('message').innerHTML = '<div class="msg err">Bitte kreuze mindestens eine Aufgabe an.</div>';
    return;
  }
  $('submitBtn').disabled = true;
  try {
    const r = await api(`api/sheets/${encodeURIComponent(current.id)}/submit`, { method: 'POST', body: { name, klasse, tasks, comment } });
    store.set(doneKey(current.id), r.doneTasks);
    $('comment').value = '';
    renderTasks();
    const reached = r.doneTasks.length >= r.required;
    $('message').innerHTML = `<div class="msg ${r.late ? 'warn' : 'ok'}">
      ✅ Abgegeben! ${r.late ? '(verspätet) ' : ''}Insgesamt erledigt: <b>${r.doneTasks.length} von ${current.tasks.length}</b> Aufgaben
      · ${r.submissionCount}. Abgabe zu diesem Blatt.<br>
      ${reached ? '<b>🎉 Blatt erfüllt!</b>' : `Dir fehlen noch <b>${r.required - r.doneTasks.length}</b> Aufgaben bis ${current.minPercent ?? 80} %. Du kannst später nochmal abgeben.`}</div>`;
  } catch (e) {
    $('message').innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
    loadSheets();
  } finally {
    renderHeader();
  }
};

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
loadSheets();
