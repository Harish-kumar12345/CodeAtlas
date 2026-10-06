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

## Features

- **Profile card** — avatar, real name, global ranking
- **SVG progress rings** — animated easy / medium / hard rings
- **Submission stats** — totals + acceptance rate per difficulty
- **Activity heatmap** — 6-month submission calendar
- **Streak counter** — current day streak + total active days
- **Recent submissions** — last 8 attempts with status, language, time
- **Skeleton loaders** — smooth loading states
- **Rate limiting** — 30 req/min per IP to protect the proxy
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

### Optional AI study plans

Set `AI_API_KEY` to enable study plans. The optional provider configuration is
`AI_API_URL` (defaults to the OpenAI-compatible chat completions endpoint) and
`AI_MODEL` (defaults to `gpt-4o-mini`). Never commit these values; configure
them only as Render environment variables. Without a key, the endpoint returns
a friendly disabled response.

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
