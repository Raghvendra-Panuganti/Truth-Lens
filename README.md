# Truth Lens

A 3D claim-checking website. Paste a claim; Truth Lens searches free APIs for published fact-checks,
reference articles and news coverage, shows the evidence, and (if you log in) saves every check to your history.

## Run it

```bash
npm install
cp .env.example .env      # then add your free Google key (see below)
npm start                 # http://localhost:3000
npm test                  # backend tests (mocked APIs)
```
Needs Node 20+. The database (`data/truthlens.db`) is created automatically.

## The free APIs

| Source | Gives you | Key? |
|---|---|---|
| **Google Fact Check Tools** | Real ratings from fact-checkers (Snopes, AFP, Reuters...) | Free key |
| **Wikipedia API** | Reference articles + the matching passage | No |
| **GDELT DOC 2.0** | How news outlets covered the topic | No |

**Get the Google key (2 minutes, free):** console.cloud.google.com -> create a project -> APIs & Services ->
enable **Fact Check Tools API** -> Credentials -> Create API key -> paste into `.env` as `GOOGLE_FACTCHECK_API_KEY`.
Without it the site still works using Wikipedia + news, but it will never say "true/false" (only fact-checkers can).

## What the verdicts mean
`true` / `false` / `mixed` come only from published fact-check ratings. With no fact-check, the best result is
"Related sources found": the site shows articles and says so, rather than guessing.

## Database (SQLite)
- `users` - name, email, scrypt-hashed password, saved settings
- `sessions` - hashed session tokens (30 days, HttpOnly cookie)
- `searches` - each user's checks, with the full result so reopening costs no API call

## API
`POST /api/auth/register|login|logout`, `GET /api/auth/me`, `PUT /api/settings`, `POST /api/verify`,
`GET/POST/DELETE /api/history`, `GET /api/history/:id`, `GET /api/export`, `DELETE /api/account`, `GET /api/status`

## Project layout
```
server.js (routes) · auth.js · db.js · verify.js (API engine) · test.js
index.html (desktop) · m.html (mobile) · styles.css · mobile.css · app.js · mobile.js · scene.js · themes.js
```

## Deploying
Set `NODE_ENV=production` (Secure cookies, needs HTTPS) and `TRUST_PROXY=true` behind a proxy. Host on any
Node host (Render, Railway, Fly.io). Keep `data/` on a persistent disk.

## Tuning the 3D
`public/js/scene.js`: `QUALITY` (particle counts), shape functions (`ribbon`, `sheet`, `burst`, `lensShape`),
and the shaders at the top. Colours live in `public/js/themes.js`.
