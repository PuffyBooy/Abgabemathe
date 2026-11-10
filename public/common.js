// Gemeinsame Hilfsfunktionen für Schüler- und Lehrerseite.

let serverOffset = 0; // Differenz Serverzeit - lokale Zeit (ms)

function syncServerTime(serverTime) {
  if (serverTime) serverOffset = new Date(serverTime).getTime() - Date.now();
}
function now() {
  return Date.now() + serverOffset;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
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
