// Gemeinsame Hilfsfunktionen für Schüler- und Lehrerseite.

let serverOffset = 0; // Differenz Serverzeit - lokale Zeit (ms)

function syncServerTime(serverTime) {
  if (serverTime) serverOffset = new Date(serverTime).getTime() - Date.now();
}
function now() {
  return Date.now() + serverOffset;
}

let csrfToken = '';

// Ruft die API auf. path z. B. "sheets", "admin/data", "sheets/<id>/submit".
async function api(path, options = {}) {
  const method = options.method || 'GET';
  // In der GitHub-Pages-Demo gibt es keinen Server: Anfragen gehen an die Demo im Browser.
  if (window.AbgabeDemo) {
    const r = window.AbgabeDemo.request(method, path, options.body);
    if (r.status >= 400) {
      const err = new Error(r.data.error);
      err.status = r.status;
      throw err;
    }
    if (r.data && r.data.csrf) csrfToken = r.data.csrf;
    return r.data;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
    headers['X-HTTP-Method'] = method; // PUT/DELETE als POST schicken – funktioniert auf jedem Webhosting
  }
  const res = await fetch('api.php?r=' + encodeURIComponent(path), {
    method: method === 'GET' ? 'GET' : 'POST',
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Fehler ${res.status} – läuft PHP auf dem Server?`);
    err.status = res.status;
    throw err;
  }
  if (data && data.csrf) csrfToken = data.csrf;
  return data;
}

// Wer ist angemeldet? Liefert { user, setupNeeded, ... }
async function loadMe() {
  const me = await api('me');
  syncServerTime(me.serverTime);
  return me;
}

async function logout() {
  try { await api('logout', { method: 'POST' }); } catch { /* egal */ }
  location.reload();
}

// Vorschlag für den Benutzernamen: "Lena Müller" -> "lena.mueller"
function suggestUsername(name) {
  return String(name || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '').slice(0, 30);
}

// Dialog "Passwort ändern"
function openPasswordDialog() {
  let dlg = document.getElementById('pwDialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'pwDialog';
    dlg.innerHTML = `<form method="dialog" id="pwDialogForm">
      <h2>Passwort ändern</h2>
      <div class="field"><label for="pwOld">Altes Passwort</label><input id="pwOld" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="pwNew">Neues Passwort</label><input id="pwNew" type="password" autocomplete="new-password" minlength="6" required></div>
      <div class="field"><label for="pwNew2">Neues Passwort wiederholen</label><input id="pwNew2" type="password" autocomplete="new-password" minlength="6" required></div>
      <div id="pwDialogMsg"></div>
      <div class="actions"><button type="submit">Speichern</button><button type="button" class="ghost" id="pwCancel">Abbrechen</button></div>
    </form>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#pwCancel').onclick = () => dlg.close();
    dlg.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const msg = dlg.querySelector('#pwDialogMsg');
      if (dlg.querySelector('#pwNew').value !== dlg.querySelector('#pwNew2').value) {
        msg.innerHTML = '<div class="msg err">Die neuen Passwörter stimmen nicht überein.</div>';
        return;
      }
      try {
        await api('password', { method: 'POST', body: { oldPassword: dlg.querySelector('#pwOld').value, newPassword: dlg.querySelector('#pwNew').value } });
        msg.innerHTML = '<div class="msg ok">Passwort geändert.</div>';
        setTimeout(() => dlg.close(), 1200);
      } catch (err) {
        msg.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
      }
    };
  }
  dlg.querySelector('form').reset();
  dlg.querySelector('#pwDialogMsg').innerHTML = '';
  dlg.showModal();
}

// Wie viele Beispiele für "erfüllt" nötig sind (Standard 80 %).
function requiredOf(sheet) {
  return window.AbgabeCore.requiredCount(sheet);
}

// Teilaufgaben eines Beispiels, z. B. 2.16 -> ["a","b","c"]
function partsOf(sheet, t) {
  return (sheet.taskParts && sheet.taskParts[t]) || [];
}
// "2.16abc" – kompakte Schreibweise für CSV und Bearbeiten
function taskText(sheet, t) {
  return t + partsOf(sheet, t).join('');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Restzeit als Text, z. B. "2 T 03:15:20" oder "00:04:59"
function fmtRemaining(ms) {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  const t = `${d ? d + ' T ' : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  return neg ? '-' + t : t;
}

function timerHtml(deadline) {
  if (!deadline) return '<span class="timer">Kein Zeitlimit</span>';
  const left = new Date(deadline).getTime() - now();
  if (left <= 0) return `<span class="timer over">Frist abgelaufen</span>`;
  const cls = left < 10 * 60 * 1000 ? 'timer soon' : 'timer';
  return `<span class="${cls}">⏱ noch ${fmtRemaining(left)}</span>`;
}
