import { createScene } from './scene.js';
import { THEMES, applyTheme } from './themes.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? esc(u) : '#');
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
const buzz = (p) => { try { navigator.vibrate?.(p); } catch {} };
const TABS = ['check', 'results', 'history'];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const DEFAULTS = { theme: 'auto', fontSize: 'm', lang: 'en', lensOn: true, lensSize: 1.35, lensFollow: 0.4, quality: 'auto', reduceMotion: reduced, news: true, saveHistory: true };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('tl_settings') || '{}') }; } catch {}

let user = null, scene = null, tab = 'check', checking = false, historyItems = [];
let lastTouch = 0, tiltOn = false, authMode = 'login';

// ---------- helpers ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status });
  return data;
}
const vcolor = (v) => getComputedStyle(root).getPropertyValue('--v-' + v).trim() || '#b57bff';

const ICONS = {
  true: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', false: '<path d="M6 6l12 12M18 6L6 18"/>',
  mixed: '<path d="M4 9c2.5-3 5.5 3 8 0s5.5 3 8 0M4 15c2.5-3 5.5 3 8 0s5.5 3 8 0"/>',
  related: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  none: '<path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>'
};
const icon = (v) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[v] || ICONS.none}</svg>`;

function highlight(text, keys) {
  let out = esc(text);
  for (const k of keys || []) {
    const stem = k.slice(0, Math.max(4, Math.min(6, k.length - 1))).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])(${stem}[\\p{L}\\p{N}]*)`, 'giu'), '<mark>$1</mark>');
  }
  return out;
}

// ---------- settings ----------
function renderThemes() {
  const opts = [['auto', 'Auto', ['#07060d', '#e8e8ec', '#8b5cff']], ...Object.entries(THEMES).map(([k, t]) => [k, t.name, t.swatch])];
  $('#mThemes').innerHTML = opts.map(([k, n, sw]) =>
    `<button class="sw" type="button" role="radio" data-theme="${k}" aria-checked="${settings.theme === k}">
       <i>${sw.map((c) => `<b style="background:${c}"></b>`).join('')}</i>${esc(n)}</button>`).join('');
}
function syncSettings() {
  $$('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else if (el.type === 'range') el.value = settings[k];
    else $$('button', el).forEach((b) => b.setAttribute('aria-checked', String(String(settings[k]) === b.dataset.v)));
  });
  renderThemes();
}
function applySettings() {
  const t = applyTheme(settings.theme);
  scene?.setTheme(t.scene, t.light);
  root.dataset.fs = settings.fontSize;
  scene?.setLens({ on: settings.lensOn, size: +settings.lensSize, follow: +settings.lensFollow });
  scene?.setQuality(settings.quality);
  root.classList.toggle('reduce-motion', !!settings.reduceMotion);
  scene?.setReduceMotion(!!settings.reduceMotion);
  syncSettings();
}
function persist() {
  try { localStorage.setItem('tl_settings', JSON.stringify(settings)); } catch {}
  if (user) { clearTimeout(persist.t); persist.t = setTimeout(() => api('PUT', '/settings', settings).catch(() => {}), 600); }
}
function mergeServerSettings(s) {
  if (s && Object.keys(s).length) {
    settings = { ...settings, ...s };
    applySettings();
    try { localStorage.setItem('tl_settings', JSON.stringify(settings)); } catch {}
  } else if (user) api('PUT', '/settings', settings).catch(() => {});
}
async function loadSources() {
  try {
    const { sources } = await api('GET', '/status');
    const rows = [['Google Fact Check Tools', sources.googleFactCheck, 'needs a key'], ['Wikipedia', sources.wikipedia], ['GDELT news', sources.gdelt]];
    $('#mSources').innerHTML = rows.map(([n, on, hint]) => `<li class="${on ? 'on' : ''}">${esc(n)}: ${on ? 'connected' : 'off' + (hint ? ', ' + hint : '')}</li>`).join('');
  } catch { $('#mSources').innerHTML = '<li>Could not load source status.</li>'; }
}

// ---------- sheets & tabs ----------
function closeSheets(restore = true) {
  $$('.sheet.open').forEach((s) => s.classList.remove('open'));
  $('#scrim').classList.remove('show');
  $$('.tabbar [data-open]').forEach((b) => b.classList.remove('on'));
  if (restore) scene?.setStage(TABS.indexOf(tab));
}
function openSheet(id) {
  closeSheets(false);
  $('#' + id).classList.add('open');
  $('#scrim').classList.add('show');
  $$('.tabbar [data-open="' + id + '"]').forEach((b) => b.classList.add('on'));
  scene?.setStage(3); // the magnifier shape while a sheet is open
  if (id === 'settingsSheet') { loadSources(); renderAccount(); }
}
function go(name) {
  tab = name;
  document.body.dataset.tab = name;
  closeSheets(false);
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
  $$('.tabbar [data-go]').forEach((b) => (b.dataset.go === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  scene?.setStage(TABS.indexOf(name));
  if (name === 'history') loadHistory();
}

// ---------- auth ----------
function setAuthMode(m) {
  authMode = m; const reg = m === 'register';
  $('#authTitle').textContent = reg ? 'Create account' : 'Log in';
  $('#authSubmit').textContent = reg ? 'Create account' : 'Log in';
  $('#nameField').hidden = !reg;
  $('#tabLogin').setAttribute('aria-selected', String(!reg));
  $('#tabRegister').setAttribute('aria-selected', String(reg));
  $('#authErr').textContent = '';
}
function openAuth(m = 'login') { setAuthMode(m); openSheet('authSheet'); }
function updateAuthBtn() { $('#authBtn').textContent = user ? user.name.split(' ')[0] : 'Log in'; }

function renderAccount() {
  const box = $('#mAccount');
  if (!user) {
    box.innerHTML = `<h3>Account</h3><p class="note">Log in to keep your history and settings on every device.</p>
      <button class="btn solid wide" id="acctLogin" type="button">Log in or sign up</button>`;
    $('#acctLogin').onclick = () => openAuth('login');
    return;
  }
  box.innerHTML = `<h3>Account</h3><p class="note">${esc(user.name)} · ${esc(user.email)}</p>
    <div class="actions">
      <a class="btn" href="/api/export" download>Download data</a>
      <button class="btn" id="logoutBtn" type="button">Log out</button>
      <button class="btn danger wide" id="clearAll" type="button">Clear history</button>
      <button class="btn danger wide" id="delAcct" type="button">Delete account</button>
    </div>`;
  $('#logoutBtn').onclick = async () => {
    await api('POST', '/auth/logout').catch(() => {});
    user = null; historyItems = []; closeSheets(); updateAuthBtn(); renderAccount(); loadHistory(); toast('Logged out');
  };
  $('#clearAll').onclick = async () => {
    if (!confirm('Delete all saved checks?')) return;
    await api('DELETE', '/history').catch((e) => toast(e.message));
    loadHistory(); toast('History cleared');
  };
  $('#delAcct').onclick = async () => {
    const pw = prompt('Enter your password to delete your account');
    if (!pw) return;
    try { await api('DELETE', '/account', { password: pw }); user = null; closeSheets(); updateAuthBtn(); renderAccount(); loadHistory(); toast('Account deleted'); }
    catch (e) { toast(e.message); }
  };
}

// ---------- verdict rendering ----------
function renderResult(r, savedId) {
  const pips = { high: 3, medium: 2, low: 1 }[r.confidence] || 1;
  const fc = r.factChecks.length
    ? `<div class="hscroll">${r.factChecks.map((f) => `<div class="fc">
         <span class="r ${esc(f.category)}">${esc(f.rating)}</span>
         <a href="${safeUrl(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.title)}</a>
         <small>${esc(f.publisher)}${f.date ? ' · ' + esc(fmtDate(f.date)) : ''}</small></div>`).join('')}</div>`
    : `<p class="note">${r.sources.googleFactCheck === 'off' ? 'Fact-check search is off. Add a Google key on the server.' : r.sources.googleFactCheck === 'error' ? 'Fact-check search could not be reached.' : 'No published fact-check matched this claim.'}</p>`;
  const refs = r.references.length
    ? `<ul class="list">${r.references.map((a) => `<li><a href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
         <small>Wikipedia · ${Math.round(a.score * 100)}% key-term match</small><p>${highlight(a.extract, r.keywords)}</p></li>`).join('')}</ul>`
    : '<p class="note">No reference articles found.</p>';
  const news = r.sources.gdelt === 'off' ? '<p class="note">News is switched off in Settings.</p>'
    : r.news.length ? `<ul class="list">${r.news.map((n) => `<li><a href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
         <small>${esc(n.domain)}${n.date ? ' · ' + esc(fmtDate(n.date)) : ''}</small></li>`).join('')}</ul>`
    : '<p class="note">No recent news coverage found.</p>';
  const saveBtn = savedId ? '<span class="btn" style="opacity:.7">Saved ✓</span>'
    : user ? '<button class="btn solid" type="button" id="saveBtn">Save</button>'
    : '<button class="btn solid" type="button" id="loginSave">Log in to save</button>';

  $('#resultsBody').innerHTML = `
    <article class="verdict v-${esc(r.verdict)}">
      <div class="vmark">${icon(r.verdict)}</div>
      <h2 class="vlabel">${esc(r.label)}</h2>
      <p class="vclaim">“${esc(r.claim)}”</p>
      <p class="vsum">${esc(r.summary)}</p>
      <span class="conf">Confidence <span class="pips">${[1, 2, 3].map((i) => `<i class="${i <= pips ? 'on' : ''}"></i>`).join('')}</span> ${esc(r.confidence)}</span>
    </article>
    <h3 class="sec">Published fact-checks</h3>${fc}
    <h3 class="sec">Reference articles</h3>${refs}
    <h3 class="sec">In the news</h3>${news}
    <div class="actions">
      <button class="btn" type="button" id="shareBtn">Share</button>
      ${saveBtn}
      <button class="btn wide" type="button" id="newBtn">Check another claim</button>
    </div>
    <p class="note">Checked ${esc(fmtDate(r.checkedAt))}</p>`;

  $('#shareBtn').onclick = async () => {
    const text = `Truth Lens: “${r.claim}” — ${r.label}. ${r.summary}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Truth Lens', text });
      else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
    } catch {}
  };
  $('#saveBtn')?.addEventListener('click', async () => {
    try { const { id } = await api('POST', '/history', { result: r }); renderResult(r, id); loadHistory(); toast('Saved to history'); }
    catch (e) { toast(e.message); }
  });
  $('#loginSave')?.addEventListener('click', () => openAuth('register'));
  $('#newBtn').onclick = () => { go('check'); $('#claim').focus(); };
}

// ---------- checking a claim ----------
async function checkClaim(text) {
  const claim = String(text || '').trim();
  if (checking) return;
  if (claim.length < 8) { toast('Write at least 8 characters'); return; }
  checking = true; $('#sendBtn').disabled = true; scene?.setBusy(true);
  go('results');
  $('#resultsBody').innerHTML = `<div class="loading"><p class="note">Searching fact-checkers, Wikipedia and news for your claim…</p><div class="bar"></div></div>`;
  try {
    const { result, savedId } = await api('POST', '/verify', { claim, lang: settings.lang, news: settings.news, save: settings.saveHistory });
    renderResult(result, savedId);
    buzz(result.verdict === 'false' ? [30, 60, 30] : [18]);
    scene?.flash(vcolor(result.verdict));
    if (savedId) loadHistory();
  } catch (e) {
    $('#resultsBody').innerHTML = `<div class="errbox" role="alert"><strong>${e.status === 429 ? 'Slow down a little' : 'Could not check that claim'}</strong><p class="note">${esc(e.message)}</p></div>`;
  } finally {
    checking = false; $('#sendBtn').disabled = false; scene?.setBusy(false);
  }
}

// ---------- history ----------
async function loadHistory() {
  const box = $('#historyBody');
  if (!user) {
    historyItems = [];
    box.innerHTML = `<p class="empty">Log in and every claim you check is saved here, ready on any device.</p>
      <div class="actions"><button class="btn solid wide" id="histLogin" type="button">Log in or create account</button></div>`;
    $('#histLogin').onclick = () => openAuth('register');
    return;
  }
  try { ({ items: historyItems } = await api('GET', '/history')); } catch { historyItems = []; }
  renderHistory();
}
function renderHistory() {
  const box = $('#historyBody');
  if (!historyItems.length) { box.innerHTML = '<p class="empty">No saved checks yet. Check a claim and it will appear here.</p>'; return; }
  box.innerHTML = `<input id="hq" class="search" type="search" placeholder="Search your checks"><div id="hlist"></div>`;
  paintHistory('');
  $('#hq').oninput = (e) => paintHistory(e.target.value);
}
function paintHistory(q) {
  const shown = historyItems.filter((i) => i.claim.toLowerCase().includes(q.trim().toLowerCase()));
  $('#hlist').innerHTML = shown.length
    ? shown.map((i) => `<div class="hitem v-${esc(i.verdict)}">
        <button class="hopen" type="button" data-id="${i.id}"><span class="dot"></span><span><b>${esc(i.claim)}</b><small>${esc(i.label)} · ${esc(fmtDate(i.createdAt))}</small></span></button>
        <button class="x" type="button" data-del="${i.id}" aria-label="Delete this check">×</button></div>`).join('')
    : '<p class="empty">No matches.</p>';
}

// ---------- tilt (phone gyroscope) ----------
function onTilt(e) {
  if (performance.now() - lastTouch < 3000 || e.gamma == null) return; // finger has priority for 3 s
  const x = Math.max(-1, Math.min(1, e.gamma / 25));
  const y = Math.max(-1, Math.min(1, ((e.beta ?? 60) - 60) / 25));
  scene?.setPointerNDC(x * 0.8, -y * 0.8);
}

// ---------- boot ----------
async function boot() {
  scene = createScene($('#scene'), { mobile: true });
  if (!scene) root.classList.add('no-webgl');
  applySettings();

  // tabs and sheets
  $('.tabbar').addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'), o = e.target.closest('[data-open]');
    if (g) { buzz(8); go(g.dataset.go); }
    if (o) openSheet(o.dataset.open);
  });
  $('#scrim').onclick = () => closeSheets();
  $$('.x[data-close]').forEach((b) => (b.onclick = () => closeSheets()));
  $('#authBtn').onclick = () => (user ? openSheet('settingsSheet') : openAuth('login'));

  // swipe between Check, Results and History (ignored on horizontal carousels)
  let sx = 0, sy = 0;
  const screens = $('.screens');
  screens.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  screens.addEventListener('touchend', (e) => {
    if (e.target.closest('.snap,.hscroll,.samples')) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 40) {
      const n = TABS.indexOf(tab) + (dx < 0 ? 1 : -1);
      if (n >= 0 && n < TABS.length) { buzz(8); go(TABS[n]); }
    }
  }, { passive: true });

  // claim composer and examples
  $('#claimForm').addEventListener('submit', (e) => { e.preventDefault(); checkClaim($('#claim').value); });
  $('#claim').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); checkClaim(e.target.value); }
  });
  $('#claim').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 112) + 'px'; });
  $$('.chip[data-sample]').forEach((c) => (c.onclick = () => checkClaim(c.dataset.sample)));

  // tilt
  $('#tiltBtn').onclick = async () => {
    if (tiltOn) return;
    try {
      if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission(); // iOS asks, from a tap
        if (r !== 'granted') throw new Error('denied');
      } else if (!('DeviceOrientationEvent' in window)) throw new Error('none');
      addEventListener('deviceorientation', onTilt, { passive: true });
      tiltOn = true;
      $('#tiltBtn').textContent = 'Tilt control on';
      $('#tiltBtn').classList.add('on');
      toast('Tilt your phone to steer the lens');
    } catch { toast('Tilt is not available here'); }
  };
  addEventListener('pointerdown', () => { lastTouch = performance.now(); }, { passive: true });

  // settings controls
  const sheet = $('#settingsSheet');
  sheet.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme]');
    if (t) { settings.theme = t.dataset.theme; applySettings(); persist(); return; }
    const b = e.target.closest('.seg button');
    if (b) { settings[b.closest('.seg').dataset.k] = b.dataset.v; applySettings(); persist(); }
  });
  sheet.addEventListener('input', (e) => {
    const el = e.target.closest('[data-k]');
    if (!el || el.classList.contains('seg')) return;
    settings[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
    applySettings(); persist();
  });

  // history list
  $('#historyBody').addEventListener('click', async (e) => {
    const o = e.target.closest('[data-id]'), d = e.target.closest('[data-del]');
    try {
      if (o) { const { result, id } = await api('GET', '/history/' + o.dataset.id); go('results'); renderResult(result, id); }
      if (d) {
        await api('DELETE', '/history/' + d.dataset.del);
        historyItems = historyItems.filter((i) => String(i.id) !== d.dataset.del);
        renderHistory(); toast('Deleted');
      }
    } catch (err) { toast(err.message); }
  });

  // login sheet
  $('#tabLogin').onclick = () => setAuthMode('login');
  $('#tabRegister').onclick = () => setAuthMode('register');
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('#authSubmit');
    $('#authErr').textContent = ''; btn.disabled = true;
    try {
      const body = { email: f.email.value, password: f.password.value };
      if (authMode === 'register') { body.name = f.name.value; body.settings = settings; }
      const data = await api('POST', authMode === 'register' ? '/auth/register' : '/auth/login', body);
      user = data.user;
      mergeServerSettings(data.settings);
      f.reset(); closeSheets(); updateAuthBtn(); renderAccount(); loadHistory();
      toast(`Welcome, ${user.name.split(' ')[0]}`);
    } catch (err) { $('#authErr').textContent = err.message; }
    finally { btn.disabled = false; }
  });

  go('check');
  try {
    const me = await api('GET', '/auth/me');
    if (me.user) { user = me.user; mergeServerSettings(me.settings); }
  } catch {}
  updateAuthBtn();
  renderAccount();
}

// Taps on the 3D area move the lens, so the scene needs the pointer everywhere.
boot();
