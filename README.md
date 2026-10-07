# LeetMatric 🧠

A full-stack LeetCode stats tracker. No CORS hacks — the Node backend proxies all LeetCode API calls cleanly.

## Project Structure

```
leetmatric/
├── backend/
│   ├── server.js        ← Express API server
│   └── package.json
└── frontend/
    └── public/
        ├── index.html   ← Main page
        ├── style.css    ← All styles
        └── app.js       ← Frontend logic
```

## Setup & Run

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Start the server
```bash
# Production
node server.js

# Development (auto-restart on changes)
npx nodemon server.js
```

### 3. Open in browser
```
http://localhost:3000
```

The backend serves the frontend from `frontend/public/` automatically.

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/user/:username` | Profile, solved counts, submission stats |
| GET | `/api/user/:username/recent` | Last 8 submissions |
| GET | `/api/user/:username/calendar` | Streak, active days, heatmap data |
| GET | `/health` | Service and LeetCode circuit health |

## Features

- **Profile card** — avatar, real name, global ranking
- **SVG progress rings** — animated easy / medium / hard rings
- **Submission stats** — totals + acceptance rate per difficulty
- **Activity heatmap** — 6-month submission calendar
- **Streak counter** — current day streak + total active days
- **Recent submissions** — last 8 attempts with status, language, time
- **Skeleton loaders** — smooth loading states
- **Rate limiting** — 30 req/min per IP to protect the proxy
- **Upstream resilience** — bounded LeetCode retries, circuit breaking, and retry-aware errors
- **Daily snapshots** — SQLite-backed progress history and growth chart
- **User comparison** — compare solved counts, streaks, and contest ratings
- **Shareable cards** — `/card/<username>.svg?theme=dark` or `theme=light`
- **Problem recommendations** — weak-topic and difficulty-aware candidates
- **Optional AI study plan** — `POST /api/user/:username/study-plan`
- **Goals** — daily target and optional reminder preference storage
- **Group leaderboard** — private group-code membership and ranking endpoints
- **Multi-platform profile** — Codeforces, CodeChef, and GitHub adapters
- **PDF export** — `/api/user/<username>/report.pdf`
- **Input validation** — both client & server side
- **Enter key support** + debounced error clearing

## Deploy

Works on any Node host: **Railway**, **Render**, **Fly.io**, **VPS**.

Set `PORT` environment variable if needed (defaults to `3000`).
Set `FRONTEND_ORIGIN` to the deployed frontend origin when cross-origin API
access is required. Same-origin local development works without it.

### GitHub sign-in

GitHub OAuth is optional and disabled until these server environment variables
are configured: `SESSION_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, and `GITHUB_CALLBACK_URL`. The callback URL must also
be registered in the GitHub OAuth application. Sessions use signed,
HttpOnly cookies; no passwords are stored. Use `/auth/github` to start login,
`/auth/logout` to sign out, and `DELETE /api/me` to delete the signed-in
account and its owned data. Goal reads/writes and AI study-plan generation
require an authenticated session; public profile search remains available
without login. Goals are stored by authenticated user ID rather than trusting
the username in the URL. Group membership and leaderboard access also require
authentication; a signed-in user must join a group before its leaderboard can
be read. Signed-in users can manage linked public accounts through
`GET/POST /api/accounts` and `DELETE /api/accounts/:platform/:username`.

### Placement readiness

LeetCode profiles include a transparent 0–100 readiness score. It is the sum
of topic coverage (35 points), medium/hard difficulty mix (30), consistency
measured by active days (20), and contest rating (15). The score is guidance,
not a hiring prediction. Company preparation coverage is similarly
approximate and currently includes Google, Amazon, Microsoft, and Meta topic
sets. The API accepts a company with
`GET /api/user/:username/company-prep?company=Google`.

## Testing and deployment

Run the complete backend test suite:

```bash
cd backend
npm test
```

From the repository root, `npm test` runs the same backend suite and
`npm run audit` checks high-and-critical dependency advisories. GitHub Actions
runs tests, the dependency audit, and a Docker build on pushes and pull
requests.

The current audit reports advisories in the native `sqlite3` build toolchain
and development watcher transitive dependencies. The non-breaking
`npm audit fix` pass was applied; clearing the remaining findings requires
major upgrades (`sqlite3` 6 or an alternative driver, and a nodemon downgrade)
and is intentionally deferred until compatibility is tested. The CI audit is
non-blocking so these findings remain visible without masking test failures.

Build and run the production container:

```bash
docker build -t leetmatric .
docker run --rm -p 3000:3000 --env-file .env leetmatric
```

For local production parity with PostgreSQL:

```bash
docker compose up --build
```

Then verify `http://localhost:3000/health`. Stop the stack with
`docker compose down`; add `-v` only when you intentionally want to remove
the local PostgreSQL volume. The image includes the same health check used by
the Compose service and Render can use `/health` as its service health path.

The app now supports a persistent dark/light theme toggle, keyboard-visible
focus states, responsive comparison controls, and accessible labels on the
primary form controls.

For Render, use `npm start` from the repository root or deploy the Dockerfile.
Configure `PORT`, `DB_PATH`, and optional provider keys through Render
environment variables. SQLite on the free tier is ephemeral.

For durable production snapshots, set `DATABASE_URL` to a Neon or Supabase
PostgreSQL connection string. When `DATABASE_URL` is present, the app uses the
PostgreSQL adapter automatically; otherwise local development continues to use
SQLite. `DATABASE_SSL=true` is the default for hosted PostgreSQL.

### Custom domain

In Render, open **Settings → Custom Domains**, add your domain, and follow the
DNS instructions shown for the service. Wait for DNS propagation, then verify
HTTPS and redirect behavior.

### Screenshots

Capture screenshots from the deployed app after searching a public username.
Recommended views are the profile overview, analytics dashboard, and light
theme. Store real screenshots under `docs/screenshots/`; this repository does
not include synthetic images.

### Optional AI study plans

Set `AI_API_KEY` to enable AI-generated study plans. Without a key, the endpoint
returns a deterministic rule-based seven-day plan. Provider failures and
invalid responses also fall back safely. Responses are validated to contain
exactly seven days, cached for 15 minutes per signed-in user/profile, and
limited to three generations per user per day. The optional provider configuration is
`AI_API_URL` (defaults to the OpenAI-compatible chat completions endpoint) and
`AI_MODEL` (defaults to `gpt-4o-mini`). Never commit these values; configure
them only as Render environment variables.

Recommendations use a curated interview-practice catalog, normalize common
topic-name variants, prefer the least-solved difficulty, and remove problems
present in the user's recent **accepted** submissions. Because LeetCode's public recent-submission feed is limited, so this is a best-effort
unsolved filter rather than a complete history guarantee.

Public sharing uses `/u/:username` and `/api/public/:platform/:username`.
Linked accounts default to public for sharing, but signed-in users can change
visibility with `PATCH /api/accounts/:platform/:username` and
`{"isPublic":false}`. Private or unlinked profiles return `PROFILE_PRIVATE`.
The service also exposes `/robots.txt` and `/sitemap.xml`.
Public profile HTML includes username-specific title, description, canonical,
and Open Graph URL metadata for social previews.

The shareable SVG endpoint remains available at
`/card/<username>.svg?theme=dark|light`; usernames are XML-escaped before
rendering.

### Multi-platform and PDF export

`GET /api/user/<username>/platforms` queries public Codeforces, CodeChef, and
GitHub profiles using the same username. Provider failures are reported per
platform rather than failing the complete LeetCode report. `GITHUB_TOKEN` is
optional and can improve GitHub API rate limits; configure it only as a server
environment variable. The combined score is a transparent heuristic based on
LeetCode solved count, the first available contest rating, and GitHub public
repositories/followers. It is not an official cross-platform ranking.

### Snapshot storage on Render

Snapshots use SQLite by default at `backend/data/leetmatric.sqlite`. Render's free-tier
filesystem is ephemeral, so local snapshots can be lost during redeploys or service
restarts. Set `DB_PATH` to a persistent mounted path where available, or migrate the
repository module in `backend/database.js` to PostgreSQL for durable production history.

## Authentication & Authorization (Purely Additive)

LeetMatric includes a comprehensive, security-first authentication system controlled by the `AUTH_ENABLED` feature flag.

- **Feature Flag**: Set `AUTH_ENABLED=true` in environment to enable email+password, Google OAuth, GitHub OAuth, personal dashboard, and session management.
- **Detailed Documentation**: See [AUTH.md](file:///c:/Users/HP/Downloads/leetmatric/leetmatric/AUTH.md) for full architecture, sequence diagrams, environment variable reference, threat model, and Render deployment callback URLs.

