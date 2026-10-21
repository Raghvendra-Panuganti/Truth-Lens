// Run with: npm test   (uses a temporary database and mocked external APIs)
const os = require('os'), path = require('path'), assert = require('assert');
process.env.DB_PATH = path.join(os.tmpdir(), `tl-test-${Date.now()}.db`);
process.env.GOOGLE_FACTCHECK_API_KEY = 'test-key';

// ---- mock the three external APIs (local requests still use the real fetch) ----
const realFetch = globalThis.fetch;
let offline = false;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (offline) throw new Error('offline');
  const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
  if (u.includes('factchecktools')) return json({ claims: [
    { text: 'Great Wall visible from space', claimReview: [
      { publisher: { name: 'Snopes' }, url: 'https://snopes.example/1', title: 'Is the Great Wall visible from space?', textualRating: 'False', reviewDate: '2020-01-01' },
      { publisher: { name: 'AFP Fact Check' }, url: 'https://afp.example/2', title: 'Great Wall myth', textualRating: 'Mostly False' }] }] });
  if (u.includes('wikipedia.org')) return json({ query: { pages: [
    { pageid: 1, index: 1, title: 'Great Wall of China', fullurl: 'https://en.wikipedia.org/wiki/Great_Wall_of_China', extract: 'The Great Wall of China is a series of fortifications. Myths say it is visible from space.' }] } });
  if (u.includes('gdeltproject')) return json({ articles: [{ title: 'Space myths', url: 'https://news.example/a', domain: 'news.example', seendate: '20260101T000000Z' }] });
  throw new Error('unexpected url ' + u);
};

const app = require('./server');
const { categorize, decide } = require('./verify');

(async () => {
  // pure logic
  assert.strictEqual(categorize('Pants on Fire'), 'false');
  assert.strictEqual(categorize('Mostly True'), 'true');
  assert.strictEqual(categorize('Half True'), 'mixed');
  assert.strictEqual(decide([], []).verdict, 'none');

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: body && JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  let r = await call('GET', '/api/auth/me'); assert.strictEqual(r.body.user, null);
  r = await call('GET', '/api/history'); assert.strictEqual(r.status, 401);

  // anonymous verify works, saves nothing
  r = await call('POST', '/api/verify', { claim: 'The Great Wall of China is visible from space' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.result.verdict, 'false'); assert.strictEqual(r.body.savedId, null);
  assert.strictEqual(r.body.result.references[0].title, 'Great Wall of China');
  const anon = r.body.result;

  r = await call('POST', '/api/verify', { claim: 'short' }); assert.strictEqual(r.status, 400);

  // register -> validation + success
  r = await call('POST', '/api/auth/register', { name: 'Asha', email: 'bad', password: 'password1' }); assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/auth/register', { name: 'Asha', email: 'asha@example.com', password: 'short' }); assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/auth/register', { name: 'Asha', email: 'Asha@Example.com', password: 'correct horse', settings: { theme: 'lagoon', evil: 1 } });
  assert.strictEqual(r.status, 201); assert.deepStrictEqual(r.body.settings, { theme: 'lagoon' });
  r = await call('POST', '/api/auth/register', { name: 'Dup', email: 'asha@example.com', password: 'correct horse' }); assert.strictEqual(r.status, 409);

  r = await call('GET', '/api/auth/me'); assert.strictEqual(r.body.user.email, 'asha@example.com');

  // verify while logged in saves to history; anon result can be saved too
  r = await call('POST', '/api/verify', { claim: 'The Great Wall of China is visible from space' }); assert.ok(r.body.savedId);
  r = await call('POST', '/api/history', { result: anon }); assert.strictEqual(r.status, 201);
  r = await call('POST', '/api/history', { result: { claim: 'x', verdict: 'bogus', label: 'y' } }); assert.strictEqual(r.status, 400);
  r = await call('GET', '/api/history'); assert.strictEqual(r.body.items.length, 2);
  const id = r.body.items[0].id;
  r = await call('GET', `/api/history/${id}`); assert.strictEqual(r.body.result.verdict, 'false');

  // settings persist
  r = await call('PUT', '/api/settings', { theme: 'ember', lensSize: 99, hack: true }); assert.deepStrictEqual(r.body.settings, { theme: 'ember', lensSize: 1.6 });
  r = await call('GET', '/api/auth/me'); assert.strictEqual(r.body.settings.theme, 'ember');

  // logout / login / wrong password
  r = await call('POST', '/api/auth/logout'); cookie = '';
  r = await call('GET', '/api/history'); assert.strictEqual(r.status, 401);
  r = await call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'wrong wrong' }); assert.strictEqual(r.status, 401);
  r = await call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'correct horse' }); assert.strictEqual(r.status, 200);
  r = await call('GET', '/api/history'); assert.strictEqual(r.body.items.length, 2);

  // delete one, clear all, delete account
  r = await call('DELETE', `/api/history/${id}`); r = await call('GET', '/api/history'); assert.strictEqual(r.body.items.length, 1);
  r = await call('GET', '/api/export'); assert.strictEqual(r.body.searches.length, 1);
  r = await call('DELETE', '/api/history'); r = await call('GET', '/api/history'); assert.strictEqual(r.body.items.length, 0);
  r = await call('DELETE', '/api/account', { password: 'nope nope' }); assert.strictEqual(r.status, 401);
  r = await call('DELETE', '/api/account', { password: 'correct horse' }); assert.strictEqual(r.status, 200);
  r = await call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'correct horse' }); assert.strictEqual(r.status, 401);

  // when every source is down, we say so instead of faking a verdict
  offline = true;
  r = await call('POST', '/api/verify', { claim: 'A claim nobody cached before today' }); assert.strictEqual(r.status, 503);

  console.log('All backend tests passed.');
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
