// Truth Lens verification engine.
// Sources (all free):
//   1. Google Fact Check Tools API  - published fact-checks (free API key, optional)
//   2. Wikipedia search API         - reference evidence (no key)
//   3. GDELT DOC 2.0 API            - news coverage (no key, optional toggle)
// Honest by design: we only call something "true" or "false" when professional fact-checkers did.

const UA = `TruthLens/1.0 (${process.env.CONTACT_URL || 'https://example.com/truth-lens'}; claim-checking project)`;
const LANGS = { en: 'English', hi: 'Hindi', mr: 'Marathi' };

const STOP = new Set(('a an the and or but if then than that this these those is are was were be been being am do does did have has had ' +
  'of in on at to for from by with about as into over under it its he she they them his her their we you i not no ' +
  'can could will would should may might must just also very more most much many some any all only so such there here ' +
  'who whom whose which what when where why how says said say claim claims according').split(' '));

function keywordsOf(text) {
  const seen = new Set();
  const words = String(text).toLowerCase().normalize('NFKC')
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));
  for (const w of words) seen.add(w);
  return [...seen].slice(0, 10);
}
const stem = (w) => w.slice(0, Math.max(4, Math.min(6, w.length - 1)));

function relevance(keys, title, extract) {
  if (!keys.length) return 0;
  const hay = `${title} ${extract}`.toLowerCase();
  const titleHay = String(title).toLowerCase();
  let hit = 0, titleHit = 0;
  for (const k of keys) {
    const s = stem(k);
    if (hay.includes(s)) hit++;
    if (titleHay.includes(s)) titleHit++;
  }
  return Math.min(1, hit / keys.length + Math.min(0.2, titleHit * 0.1));
}

// ---- rating text -> category ----
function categorize(rating = '') {
  const r = String(rating).toLowerCase();
  if (/half|partly|partial|mixture|mixed|some truth/.test(r)) return 'mixed';
  if (/pants on fire|false|fake|incorrect|hoax|fabricat|not true|untrue|baseless|wrong|debunk|scam|fiction|myth|no evidence|satire|\bnot\b.*\baccurate/.test(r)) return 'false';
  if (/misleading|missing context|needs context|lacks context|unproven|unverified|exaggerat|outdated|cherry|disputed|unsupported|context/.test(r)) return 'mixed';
  if (/true|correct|accurate|legit|genuine|verified|confirmed|\bright\b/.test(r)) return 'true';
  return 'unknown';
}

async function getJson(fetchFn, url, { timeout = 7000, headers = {} } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetchFn(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error('Non-JSON response'); }
  } finally { clearTimeout(timer); }
}

// ---- source 1: Google Fact Check Tools ----
async function googleFactChecks(claim, lang, fetchFn, key) {
  const u = new URL('https://factchecktools.googleapis.com/v1alpha1/claims:search');
  u.search = new URLSearchParams({ query: claim.slice(0, 250), languageCode: lang, pageSize: '8', key }).toString();
  const data = await getJson(fetchFn, u.toString());
  const out = [];
  for (const c of data.claims || []) {
    for (const r of c.claimReview || []) {
      out.push({
        claimText: c.text || '',
        claimant: c.claimant || '',
        publisher: r.publisher?.name || r.publisher?.site || 'Unknown publisher',
        title: r.title || c.text || 'Fact-check',
        url: r.url,
        rating: r.textualRating || 'Unrated',
        category: categorize(r.textualRating),
        date: r.reviewDate || c.claimDate || null
      });
    }
  }
  // de-duplicate by URL, keep the first 8
  const seen = new Set();
  return out.filter((x) => x.url && !seen.has(x.url) && seen.add(x.url)).slice(0, 8);
}

// ---- source 2: Wikipedia ----
async function wikipediaEvidence(keys, lang, fetchFn) {
  const host = LANGS[lang] ? lang : 'en';
  const u = new URL(`https://${host}.wikipedia.org/w/api.php`);
  u.search = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search',
    gsrsearch: keys.slice(0, 8).join(' '), gsrlimit: '6', gsrnamespace: '0',
    prop: 'extracts|pageimages|info', inprop: 'url', exintro: '1', explaintext: '1',
    exsentences: '3', exlimit: 'max', piprop: 'thumbnail', pithumbsize: '160', redirects: '1'
  }).toString();
  const data = await getJson(fetchFn, u.toString());
  const pages = (data.query?.pages || []).slice().sort((a, b) => (a.index || 99) - (b.index || 99));
  return pages.filter((p) => p.extract).map((p) => ({
    title: p.title,
    url: p.fullurl || `https://${host}.wikipedia.org/?curid=${p.pageid}`,
    extract: p.extract.slice(0, 600),
    thumbnail: p.thumbnail?.source || null,
    score: Number(relevance(keys, p.title, p.extract).toFixed(2))
  })).sort((a, b) => b.score - a.score);
}

// ---- source 3: GDELT news ----
async function gdeltNews(keys, fetchFn) {
  const u = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  u.search = new URLSearchParams({
    query: keys.slice(0, 6).join(' '), mode: 'artlist', maxrecords: '6', format: 'json', sort: 'hybridrel'
  }).toString();
  const data = await getJson(fetchFn, u.toString(), { timeout: 6000 });
  return (data.articles || []).map((a) => ({
    title: a.title, url: a.url, domain: a.domain,
    date: a.seendate ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}` : null
  })).filter((a) => a.title && /^https?:/.test(a.url)).slice(0, 5);
}

// ---- verdict logic ----
function decide(factChecks, refs) {
  const counts = { true: 0, false: 0, mixed: 0 };
  for (const f of factChecks) if (counts[f.category] !== undefined) counts[f.category]++;
  const rated = counts.true + counts.false + counts.mixed;
  const relevant = refs.filter((r) => r.score >= 0.6);

  if (rated > 0) {
    const share = (n) => n / rated;
    let verdict = 'mixed';
    if (share(counts.false) >= 0.6) verdict = 'false';
    else if (share(counts.true) >= 0.6) verdict = 'true';
    const agreement = Math.max(share(counts.false), share(counts.true), share(counts.mixed));
    const publishers = new Set(factChecks.map((f) => f.publisher)).size;
    const confidence = rated >= 3 && agreement >= 0.8 && publishers >= 2 ? 'high' : rated >= 2 || publishers >= 2 ? 'medium' : 'low';
    const labels = {
      false: 'Fact-checkers rate this false',
      true: 'Fact-checkers rate this true',
      mixed: 'Mixed, or missing context'
    };
    return {
      verdict, label: labels[verdict], confidence,
      summary: `${rated} published fact-check${rated > 1 ? 's' : ''} from ${publishers} publisher${publishers > 1 ? 's' : ''} matched this claim: ` +
        `${counts.false} false, ${counts.true} true, ${counts.mixed} mixed or lacking context.`
    };
  }
  if (factChecks.length) {
    return { verdict: 'related', label: 'Fact-checks found, rating unclear', confidence: 'low',
      summary: 'Fact-checkers have covered something similar, but their rating could not be read automatically. Open the links to see their conclusion.' };
  }
  if (relevant.length) {
    return { verdict: 'related', label: 'Related sources found', confidence: relevant.length >= 2 && relevant[0].score >= 0.8 ? 'medium' : 'low',
      summary: 'No professional fact-check matched this claim. These reference articles cover the same topic, so read them and judge for yourself. Truth Lens does not decide true or false from encyclopedia text.' };
  }
  return { verdict: 'none', label: 'No matching sources', confidence: 'low',
    summary: 'Nothing we searched matched this claim. That does not make it true or false. Try rewording it, or check a primary source.' };
}

// ---- tiny cache so repeat checks don't burn API quota ----
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function verifyClaim(claimRaw, opts = {}, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const key = deps.googleKey !== undefined ? deps.googleKey : process.env.GOOGLE_FACTCHECK_API_KEY;
  const claim = String(claimRaw || '').replace(/\s+/g, ' ').trim();
  if (claim.length < 8) throw Object.assign(new Error('Write a claim of at least 8 characters.'), { status: 400 });
  if (claim.length > 500) throw Object.assign(new Error('Claims can be up to 500 characters.'), { status: 400 });

  const lang = LANGS[opts.lang] ? opts.lang : 'en';
  const news = opts.news !== false;
  const ck = `${lang}|${news}|${claim.toLowerCase()}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < CACHE_MS && !deps.noCache) return { ...hit.v, cached: true };

  const keys = keywordsOf(claim);
  if (!keys.length) throw Object.assign(new Error('That claim has no searchable words. Add more detail.'), { status: 400 });

  const sources = { googleFactCheck: key ? 'pending' : 'off', wikipedia: 'pending', gdelt: news ? 'pending' : 'off' };
  const run = async (name, fn, fallback) => {
    try { const v = await fn(); sources[name] = 'ok'; return v; }
    catch (e) { sources[name] = 'error'; return fallback; }
  };
  const [factChecks, refs, newsItems] = await Promise.all([
    key ? run('googleFactCheck', () => googleFactChecks(claim, lang, fetchFn, key), []) : [],
    run('wikipedia', () => wikipediaEvidence(keys, lang, fetchFn), []),
    news ? run('gdelt', () => gdeltNews(keys, fetchFn), []) : []
  ]);

  const failed = Object.values(sources).filter((s) => s === 'error').length;
  const active = Object.values(sources).filter((s) => s !== 'off').length;
  if (failed === active) {
    throw Object.assign(new Error('Could not reach any source right now. Check your internet connection and try again.'), { status: 503 });
  }

  const decision = decide(factChecks, refs);
  const result = {
    claim, lang, keywords: keys, ...decision,
    factChecks, references: refs.slice(0, 5), news: newsItems, sources,
    checkedAt: new Date().toISOString()
  };
  if (!deps.noCache) {
    cache.set(ck, { t: Date.now(), v: result });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  return result;
}

module.exports = { verifyClaim, categorize, keywordsOf, relevance, decide, LANGS };
