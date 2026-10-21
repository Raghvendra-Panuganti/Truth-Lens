import { createScene } from './scene.js';
import { THEMES, applyTheme } from './themes.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? esc(u) : '#');
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// true when a click landed on the dimmed backdrop, not inside the dialog box
const outside = (e, dlg) => { const r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- API
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

// ---------------------------------------------------------------- state & settings
const DEFAULTS = {
  theme: 'auto', fontSize: 'm', lang: 'en', lensOn: true, lensReveal: true, lensSize: 1, lensFollow: 0.4,
  quality: 'auto', reduceMotion: prefersReduced, news: true, saveHistory: true
};
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('tl_settings') || '{}') }; } catch {}
let user = null;
let currentResult = null, currentSavedId = null;
let scene = null;

let syncTimer;
function persistSettings() {
  try { localStorage.setItem('tl_settings', JSON.stringify(settings)); } catch {}
  if (user) { clearTimeout(syncTimer); syncTimer = setTimeout(() => api('PUT', '/settings', settings).catch(() => {}), 600); }
}

function applySettings(which) {
  const all = !which;
  if (all || which === 'theme') { const t = applyTheme(settings.theme); scene?.setTheme(t.scene, t.light); renderThemePicker(); }
  if (all || which === 'fontSize') root.dataset.fs = settings.fontSize;
  if (all || ['lensOn', 'lensSize', 'lensFollow'].includes(which)) scene?.setLens({ on: settings.lensOn, size: +settings.lensSize, follow: +settings.lensFollow });
  if (all || which === 'quality') scene?.setQuality(settings.quality);
  if (all || which === 'reduceMotion') { root.classList.toggle('reduce-motion', settings.reduceMotion); scene?.setReduceMotion(settings.reduceMotion); }
  root.classList.toggle('no-reveal', !(settings.lensOn && settings.lensReveal));
  syncSettingsUI();
}
function setSetting(key, value) { settings[key] = value; applySettings(key); persistSettings(); }

// ---------------------------------------------------------------- settings UI
function renderThemePicker() {
  const box = $('#themePicker');
  const opts = [['auto', { name: 'Auto', swatch: ['#07060d', '#e8e8ec', '#8b5cff'] }], ...Object.entries(THEMES)];
  box.innerHTML = opts.map(([id, t]) =>
    `<button type="button" class="theme" role="radio" data-value="${id}" aria-checked="${settings.theme === id}">
       <span class="sw">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${esc(t.name)}</button>`).join('');
}
function syncSettingsUI() {
  $$('[data-setting]').forEach((el) => {
    const k = el.dataset.setting;
    if (el.matches('input[type=checkbox]')) el.checked = !!settings[k];
    else if (el.matches('input[type=range]')) el.value = settings[k];
    else $$('[data-value]', el).forEach((b) => b.setAttribute('aria-checked', String(String(settings[k]) === b.dataset.value)));
  });
}
function bindSettings() {
  const dlg = $('#settingsDialog');
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]'); const grp = b?.closest('[data-setting]');
    if (grp) setSetting(grp.dataset.setting, b.dataset.value);
    if (outside(e, dlg)) dlg.close();
  });
  dlg.addEventListener('input', (e) => {
    const el = e.target.closest('input[data-setting]'); if (!el) return;
    setSetting(el.dataset.setting, el.type === 'checkbox' ? el.checked : parseFloat(el.value));
  });
  $('#resetBtn').addEventListener('click', () => { settings = { ...DEFAULTS }; applySettings(); persistSettings(); toast('Settings reset'); });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => settings.theme === 'auto' && applySettings('theme'));
}
async function loadSourceStatus() {
  try {
    const { sources } = await api('GET', '/status');
    const rows = [['Google Fact Check Tools', sources.googleFactCheck, 'needs a free API key in .env'], ['Wikipedia', sources.wikipedia], ['GDELT news', sources.gdelt]];
    $('#sourceStatus').innerHTML = rows.map(([n, on, hint]) => `<li class="${on ? 'on' : ''}"><b></b>${esc(n)}: ${on ? 'connected' : 'off, ' + esc(hint)}</li>`).join('');
  } catch { $('#sourceStatus').innerHTML = '<li>Could not load source status.</li>'; }
}

// account box inside settings
function renderAccountBox() {
  const box = $('#accountBox');
  if (!user) {
    box.innerHTML = `<h3>Account</h3><p class="note">Log in to keep your history and settings on every device.</p>
      <div class="acct-actions"><button class="btn solid" type="button" id="acctLogin">Log in or sign up</button></div>`;
    $('#acctLogin').onclick = () => { $('#settingsDialog').close(); openAuth('login'); };
    return;
  }
  box.innerHTML = `<h3>Account</h3><p class="note">${esc(user.name)}<br>${esc(user.email)}</p>
    <div class="acct-actions">
      <a class="btn" id="exportBtn" href="/api/export" download>Download my data</a>
      <button class="btn" type="button" id="clearHist">Clear history</button>
      <button class="btn danger" type="button" id="delAcct">Delete account</button>
    </div>
    <form class="acct-confirm" id="delForm" hidden>
      <p class="note">This permanently deletes your account and every saved check. Enter your password to confirm.</p>
      <input class="field" style="padding:.7rem .9rem;border-radius:12px;background:var(--card);border:1px solid var(--line);color:var(--ink)" type="password" name="pw" autocomplete="current-password" placeholder="Password" required>
      <p class="form-error" id="delErr" role="alert"></p>
      <button class="btn danger" type="submit">Delete forever</button>
    </form>`;
  $('#clearHist').onclick = async () => {
    if (!confirm('Delete all saved checks? This cannot be undone.')) return;
    await api('DELETE', '/history').catch((e) => toast(e.message)); loadHistory(); toast('History cleared');
  };
  $('#delAcct').onclick = () => { $('#delForm').hidden = false; $('#delForm input').focus(); };
  $('#delForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('DELETE', '/account', { password: e.target.pw.value }); user = null; $('#settingsDialog').close(); onAuthChange(); toast('Account deleted'); }
    catch (err) { $('#delErr').textContent = err.message; }
  };
}

// ---------------------------------------------------------------- auth UI
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode; const reg = mode === 'register';
  $('#authTitle').textContent = reg ? 'Create account' : 'Log in';
  $('#authSubmit').textContent = reg ? 'Create account' : 'Log in';
  $('#nameField').hidden = !reg; $('#pwNote').hidden = !reg;
  $('#authForm').password.autocomplete = reg ? 'new-password' : 'current-password';
  $('#tabLogin').setAttribute('aria-selected', String(!reg)); $('#tabRegister').setAttribute('aria-selected', String(reg));
  $('#authError').textContent = '';
}
function openAuth(mode = 'login') { setAuthMode(mode); $('#authDialog').showModal(); $('#authForm').email.focus(); }
function bindAuth() {
  $('#tabLogin').onclick = () => setAuthMode('login');
  $('#tabRegister').onclick = () => setAuthMode('register');
  $('#authDialog').addEventListener('click', (e) => { if (outside(e, e.currentTarget) || e.target.closest('[data-close]')) e.currentTarget.close(); });
  $('#settingsDialog').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) $('#settingsDialog').close(); });
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('#authSubmit'); $('#authError').textContent = ''; btn.disabled = true;
    try {
      const body = { email: f.email.value, password: f.password.value };
      if (authMode === 'register') { body.name = f.name.value; body.settings = settings; }
      const data = await api('POST', authMode === 'register' ? '/auth/register' : '/auth/login', body);
      user = data.user; mergeServerSettings(data.settings);
      f.reset(); $('#authDialog').close(); onAuthChange(); toast(`Welcome, ${user.name.split(' ')[0]}`);
    } catch (err) { $('#authError').textContent = err.message; }
    finally { btn.disabled = false; }
  });
  $('#loginBtn').onclick = (e) => {
    if (!user) return openAuth('login');
    const m = $('#userMenu'); m.hidden = !m.hidden; e.stopPropagation();
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.actions')) $('#userMenu').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#userMenu').hidden = true; });
  $('#logoutBtn').onclick = async () => { await api('POST', '/auth/logout').catch(() => {}); user = null; $('#userMenu').hidden = true; onAuthChange(); toast('Logged out'); };
}
function mergeServerSettings(s) {
  if (s && Object.keys(s).length) { settings = { ...settings, ...s }; applySettings(); try { localStorage.setItem('tl_settings', JSON.stringify(settings)); } catch {} }
  else if (user) api('PUT', '/settings', settings).catch(() => {});
}
function onAuthChange() {
  const b = $('#loginBtn');
  b.textContent = user ? user.name.split(' ')[0] : 'Log in';
  b.setAttribute('aria-haspopup', user ? 'menu' : 'dialog');
  renderAccountBox(); loadHistory();
  if (currentResult) renderResult(currentResult, currentSavedId);
}

// ---------------------------------------------------------------- verdict rendering
const ICONS = {
  true: '<path d="M5 12.5l4.5 4.5L19 7.5" />', false: '<path d="M6 6l12 12M18 6L6 18" />',
  mixed: '<path d="M4 9c2.5-3 5.5 3 8 0s5.500 3 8 0M4 15c2.500-3 5.500 3 8 0s5.500 3 8 0" />',
  related: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" />',
  none: '<path d="M9.500 9a2.500 2.500 0 1 1 3.500 2.300c-.7.400-1 .9-1 1.700M12 17h.01" />'
};
const icon = (v) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[v] || ICONS.none}</svg>`;
const verdictColor = (v) => getComputedStyle(root).getPropertyValue('--v-' + (v === 'related' ? 'related' : v)).trim() || '#b57bff';
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

function highlight(text, keys) {
  let out = esc(text);
  for (const k of keys || []) {
    const stem = k.slice(0, Math.max(4, Math.min(6, k.length - 1))).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])(${stem}[\\p{L}\\p{N}]*)`, 'giu'), '<mark>$1</mark>');
  }
  return out;
}

function renderResult(r, savedId) {
  currentResult = r; currentSavedId = savedId ?? null;
  const pips = { high: 3, medium: 2, low: 1 }[r.confidence] || 1;
  const factHtml = r.factChecks.length
    ? `<ul class="src">${r.factChecks.map((f) => `<li><span class="rating ${esc(f.category)}">${esc(f.rating)}</span>
        <a href="${safeUrl(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.title)}</a>
        <span class="meta">${esc(f.publisher)}${f.date ? ' · ' + esc(fmtDate(f.date)) : ''}</span></li>`).join('')}</ul>`
    : `<p class="note">${r.sources.googleFactCheck === 'off' ? 'Fact-check search is switched off. Add a free Google API key to the server to enable it.' : r.sources.googleFactCheck === 'error' ? 'Fact-check search could not be reached this time.' : 'No published fact-check matched this claim.'}</p>`;
  const refHtml = r.references.length
    ? `<ul class="src">${r.references.map((a) => `<li><a href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
        <span class="meta">Wikipedia · matches ${Math.round(a.score * 100)}% of key terms</span><p class="ex">${highlight(a.extract, r.keywords)}</p></li>`).join('')}</ul>`
    : `<p class="note">${r.sources.wikipedia === 'error' ? 'Wikipedia could not be reached this time.' : 'No reference articles found.'}</p>`;
  const newsHtml = r.sources.gdelt === 'off' ? '<p class="note">News coverage is switched off in Settings.</p>'
    : r.news.length ? `<ul class="src">${r.news.map((n) => `<li><a href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
        <span class="meta">${esc(n.domain)}${n.date ? ' · ' + esc(fmtDate(n.date)) : ''}</span></li>`).join('')}</ul>`
    : `<p class="note">${r.sources.gdelt === 'error' ? 'News search could not be reached this time.' : 'No recent news coverage found.'}</p>`;

  const saveBtn = savedId ? '<span class="note">Saved to your history</span>'
    : user ? '<button class="btn" type="button" id="saveBtn">Save to history</button>'
    : '<button class="btn" type="button" id="loginToSave">Log in to save this</button>';

  $('#resultsBody').innerHTML = `
    <article class="verdict v-${esc(r.verdict)}" aria-labelledby="vlabel">
      <div class="vhead">
        <div class="vmark">${icon(r.verdict)}</div>
        <div><h3 class="vlabel" id="vlabel">${esc(r.label)}</h3><p class="vclaim">“${esc(r.claim)}”</p></div>
        <div class="conf">Confidence <span class="pips" aria-label="${esc(r.confidence)}">${[1, 2, 3].map((i) => `<i class="${i <= pips ? 'on' : ''}"></i>`).join('')}</span><br>${esc(r.confidence)}</div>
      </div>
      <p class="vsummary">${esc(r.summary)}</p>
      <div class="cols">
        <section aria-label="Fact-checks"><h3>Published fact-checks</h3>${factHtml}</section>
        <section aria-label="Reference articles"><h3>Reference articles</h3>${refHtml}</section>
        <section aria-label="News"><h3>In the news</h3>${newsHtml}</section>
      </div>
      <div class="vfoot">
        <button class="btn" type="button" id="copyBtn">Copy summary</button>${saveBtn}
        <span class="stamp">Checked ${esc(fmtDate(r.checkedAt))}</span>
      </div>
    </article>`;
  $('#copyBtn').onclick = async () => {
    const text = `Truth Lens: “${r.claim}”\n${r.label}. ${r.summary}\n` + r.factChecks.slice(0, 3).map((f) => `- ${f.publisher}: ${f.rating} ${f.url}`).join('\n');
    try { await navigator.clipboard.writeText(text); toast('Summary copied'); } catch { toast('Copy is blocked by your browser'); }
  };
  $('#saveBtn')?.addEventListener('click', async () => {
    try { const { id } = await api('POST', '/history', { result: r }); renderResult(r, id); loadHistory(); toast('Saved to history'); } catch (e) { toast(e.message); }
  });
  $('#loginToSave')?.addEventListener('click', () => openAuth('register'));
}

// ---------------------------------------------------------------- checking a claim
let checking = false;
async function checkClaim(text) {
  if (checking) return;
  const claim = text.trim();
  const body = $('#resultsBody');
  if (claim.length < 8) { toast('Write a claim of at least 8 characters'); $('#claim').focus(); return; }
  checking = true; $('#checkBtn').disabled = true; scene?.setBusy(true);
  body.innerHTML = `<div class="loading"><p>Searching fact-checkers, Wikipedia and news for “${esc(claim.slice(0, 120))}”…</p><div class="bar"></div></div>`;
  $('#results').scrollIntoView({ behavior: settings.reduceMotion ? 'auto' : 'smooth' });
  try {
    const { result, savedId } = await api('POST', '/verify', { claim, lang: settings.lang, news: settings.news, save: settings.saveHistory });
    renderResult(result, savedId);
    scene?.flash(verdictColor(result.verdict));
    if (savedId) { loadHistory(); toast('Saved to your history'); }
  } catch (e) {
    body.innerHTML = `<div class="errbox" role="alert"><strong>${e.status === 429 ? 'Slow down a little' : 'Could not check that claim'}</strong><p class="note">${esc(e.message)}</p></div>`;
  } finally { checking = false; $('#checkBtn').disabled = false; scene?.setBusy(false); }
}
function bindClaimForm() {
  const ta = $('#claim');
  $('#claimForm').addEventListener('submit', (e) => { e.preventDefault(); checkClaim(ta.value); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); checkClaim(ta.value); } });
  $$('.chip').forEach((c) => c.addEventListener('click', () => { ta.value = c.dataset.sample; ta.focus(); }));
}

// ---------------------------------------------------------------- history
let historyItems = [];
async function loadHistory() {
  const box = $('#historyBody');
  if (!user) {
    historyItems = [];
    box.innerHTML = `<p class="empty">Log in and every claim you check is saved here, ready to reopen on any device.</p>
      <div class="vfoot"><button class="btn solid big" type="button" id="histLogin">Log in or create an account</button></div>`;
    $('#histLogin').onclick = () => openAuth('register'); return;
  }
  try { ({ items: historyItems } = await api('GET', '/history')); } catch { historyItems = []; }
  renderHistory('');
}
function renderHistory(filter) {
  const box = $('#historyBody');
  const shown = historyItems.filter((i) => i.claim.toLowerCase().includes(filter.toLowerCase()));
  box.innerHTML = historyItems.length ? `
    <div class="hist-tools"><label class="sr" for="histFilter">Search your history</label><input id="histFilter" type="search" placeholder="Search your checks" value="${esc(filter)}"></div>
    ${shown.length ? `<ul class="hist">${shown.map((i) => `<li>
      <button class="open v-${esc(i.verdict)}" type="button" data-id="${i.id}"><span class="dot"></span><span class="t">${esc(i.claim)}</span><span class="s">${esc(i.label)} · ${esc(fmtDate(i.createdAt))}</span></button>
      <button class="del" type="button" data-del="${i.id}" aria-label="Delete this check">Delete</button></li>`).join('')}</ul>` : '<p class="empty">No checks match that search.</p>'}`
    : '<p class="empty">No saved checks yet. Check a claim and it will show up here.</p>';
  const f = $('#histFilter');
  if (f) { f.oninput = () => { const pos = f.selectionStart; renderHistory(f.value); const n = $('#histFilter'); n.focus(); n.setSelectionRange(pos, pos); }; }
}
function bindHistory() {
  $('#historyBody').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-id]'), del = e.target.closest('[data-del]');
    try {
      if (open) { const { result, id } = await api('GET', '/history/' + open.dataset.id); renderResult(result, id); $('#results').scrollIntoView({ behavior: settings.reduceMotion ? 'auto' : 'smooth' }); }
      if (del) { await api('DELETE', '/history/' + del.dataset.del); historyItems = historyItems.filter((i) => String(i.id) !== del.dataset.del); renderHistory($('#histFilter')?.value || ''); toast('Deleted'); }
    } catch (err) { toast(err.message); }
  });
}

// ---------------------------------------------------------------- lens-reveal text + scroll stage
function wrapLensText() {
  $$('[data-lens]').forEach((el) => {
    const text = el.textContent;
    el.innerHTML = `<span class="lt-fog" aria-hidden="true">${esc(text)}</span><span class="lt-clear">${esc(text)}</span>`;
  });
}
let revealEls = [];
function onLens(x, y, r) {
  for (const { box, clear } of revealEls) {
    const b = box.getBoundingClientRect();
    if (b.bottom < -r || b.top > innerHeight + r) continue;
    clear.style.setProperty('--x', (x - b.left).toFixed(1) + 'px');
    clear.style.setProperty('--y', (y - b.top).toFixed(1) + 'px');
    clear.style.setProperty('--r', (r * 1.12).toFixed(1) + 'px');
  }
}
function updateStage() {
  if (!scene) return;
  const vh = innerHeight; let stage = 0;
  $$('main > section').slice(1).forEach((s) => {
    const top = s.getBoundingClientRect().top + scrollY;
    stage += Math.min(1, Math.max(0, (scrollY - (top - vh)) / (vh * 0.8)));
  });
  scene.setStage(stage);
}

// ---------------------------------------------------------------- boot
async function boot() {
  wrapLensText();
  revealEls = $$('[data-lens]').map((box) => ({ box, clear: $('.lt-clear', box) }));

  const canvas = $('#scene');
  try { scene = createScene(canvas, { onLens }); } catch (e) { console.warn('WebGL scene failed', e); scene = null; }
  if (!scene) root.classList.add('no-webgl', 'no-reveal');

  bindSettings(); bindAuth(); bindClaimForm(); bindHistory();
  $('#settingsBtn').onclick = () => { loadSourceStatus(); $('#settingsDialog').showModal(); };
  applySettings(); renderAccountBox();

  addEventListener('scroll', updateStage, { passive: true });
  addEventListener('resize', updateStage);
  updateStage();

  try {
    const me = await api('GET', '/auth/me');
    if (me.user) { user = me.user; mergeServerSettings(me.settings); }
  } catch {}
  onAuthChange();
}
boot();
