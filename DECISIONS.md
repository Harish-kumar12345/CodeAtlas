# Authentication Architectural Decisions

## Baseline & Scope

- **Additive-Only Guarantee**: Existing public routes (`/`, `/health`, `/robots.txt`, `/sitemap.xml`, `/api/user/:username`, `/card/:username.svg`, etc.) remain 100% untouched and functional for anonymous users.
- **Feature Flag**: `AUTH_ENABLED=false` by default. When false, the application mounts zero auth routes and presents the legacy interface. When true, the new secure authentication service layer activates.
- **Branch**: All changes developed and verified on `feat/auth`.

## Data Model & Schema Isolation

- **Tables**:
  - `auth_users`: Central user identity with UUID primary keys, Argon2id password hash, role (`user`, `admin`), email verification status, and public visibility toggle.
  - `oauth_accounts`: Third-party OAuth provider links (`google`, `github`) with unique constraint on `(provider, provider_user_id)`.
  - `sessions`: Server-side persistent session records with idle (2 hr) and absolute (7 day / 30 day remember-me) timeouts.
  - `email_tokens`: Expiring, single-use SHA-256 hashed tokens for email verification (24h) and password reset (1h).
  - `audit_log`: Security audit trail tracking auth lifecycle events (`user_registered`, `user_login`, `password_changed`, `oauth_linked`, etc.) with IP, user-agent, and metadata.
  - `auth_user_links`: Join table linking `auth_users` to external coding platform usernames (`leetcode`, `codeforces`, `codechef`, `github`).
  - `auth_user_goals`: Per-user target problem count and reminder preferences.
- **Trade-off**: Kept in distinct tables from legacy `users` and `goals` to avoid any breaking changes or schema mutation on existing live Render data.
- **Reversibility**: Full reversible migration with `up()` and `down()` support for both SQLite and PostgreSQL.

## Cryptography & Security Choices

- **Password Hashing**: `Argon2id` via the maintained `argon2` npm package with recommended OWASP memory (64MB), time cost (3), and parallelism (4) parameters.
- **Enumeration Resistance**: Identical 401 error response code and message (`INVALID_CREDENTIALS`) for non-existent email vs incorrect password. Password reset requests return a generic message regardless of whether the email exists.
- **Session Lifecycle & Fixed Cookies**:
  - Session IDs are 256-bit cryptographically secure random tokens stored in an HttpOnly, SameSite=Lax, Secure (in production/HTTPS) cookie (`leetmatric_session`).
  - Session ID rotated on login to prevent session fixation attacks.
  - Inactivity idle timeout (2 hours) and absolute lifetime (7 days default, 30 days if remember-me checked).
  - Single-session logout and global multi-device logout (`POST /auth/logout-all`).
- **CSRF Protection**: Synchronizer token via `X-CSRF-Token` header on state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`).
- **Abuse Prevention & Rate Limiting**:
  - 5 failed login attempts per 15 minutes triggers an IP/email lockout with `429 ACCOUNT_LOCKED`.
  - Signup capped at 10 requests/hour per IP.
  - Password reset and verification resend capped at 3 requests/hour.
- **OAuth 2.0 PKCE**:
  - Authorization code flow with PKCE (S256 code challenge) and random state token validation.
  - Requires verified provider email (`email_verified` on Google, verified email check on GitHub).
  - Explicit linking/unlinking rules: users cannot unlink their last remaining authentication method.
- **Authorization & Access Control**:
  - Central permission layer (`requireAuth`). All private resources filter exclusively by `req.authUser.id` obtained from the validated server session. Client-submitted user IDs are strictly ignored to eliminate IDOR vulnerabilities.
  - Full data export (`GET /auth/export`) and full account deletion (`DELETE /auth/account`).

---

# Daily Prep Companion Architectural Decisions

## Baseline & Isolation Rules
- **Purely Additive Philosophy**: All new capabilities are implemented in modular subdirectories under `backend/features/` and isolated behind independent feature flags (`FEATURE_REVISION`, `FEATURE_CONTESTS`, `FEATURE_BADGES`, `FEATURE_MOCK`, `FEATURE_HINTS`, `FEATURE_DIGEST`, `FEATURE_NOTES`).
- **Default Inactive**: All companion flags default to `false`. When disabled, zero routes, jobs, or frontend widgets are mounted, preserving exact byte-for-byte baseline behavior.
- **Branching**: Developed exclusively on branch `feat/daily-companion`. Never pushed directly to `main`.
- **Database Non-Interference**: Existing tables (`users`, `linked_accounts`, `snapshots`, `user_goals`, `auth_users`, etc.) remain completely untouched. All companion models use discrete, dedicated tables with idempotent migrations (`002_create_companion_tables.js`) supporting SQLite and PostgreSQL.

## Feature Architectures & Trade-offs

### 1. Spaced Repetition (`FEATURE_REVISION`)
- **Algorithm Choice**: Modified SuperMemo SM-2/Anki progression with fixed stepping [1, 3, 7, 14, 30 days] adapted for algorithmic problem solving.
- **State Transition**: Pure function `next_review(state, recallRating, today)`.
  - `hard`: Resets interval to 1 day; decrements ease factor (minimum 1.3).
  - `medium`: Advances along the progression; preserves ease factor.
  - `easy`: Multiplies current interval by ease factor (or jumps to next tier); boosts ease factor.
- **Data Boundary**: Automatically populates from user's accepted submissions and allows manual entry for problems solved outside the platform.

### 2. Contests Calendar (`FEATURE_CONTESTS`)
- **Platform Adapters**:
  - Codeforces: Official REST API (`https://codeforces.com/api/contest.list`).
  - LeetCode: GraphQL public contest query.
  - CodeChef: Public contest feed with graceful error boundary.
- **Resilience**: Independent in-memory caching (45 minutes). Failure of one provider (e.g. CodeChef upstream downtime) does not break other platforms.
- **Export & Reminders**: Generates compliant RFC 5545 iCalendar (`.ics`) format and one-click Google Calendar web intent URLs.

### 3. Badges, XP & Levels (`FEATURE_BADGES`)
- **Deterministic Math**: XP curve: `Level(XP) = floor(1 + sqrt(XP / 100))`. Inverse: `XP(Level) = 100 * (Level - 1)^2`.
- **Idempotency & Recomputability**: XP events are tied to `(user_id, source_type, source_id)` unique keys. Badge awards are evaluated against snapshot and platform metrics without double-crediting.
- **Stats Card Integration**: Appends optional badges/level banner to SVG card only when `FEATURE_BADGES=true` and `?badges=1` query parameter is explicitly requested.

### 4. Mock Interview Mode (`FEATURE_MOCK`)
- **Session Lifecycle**: States: `active`, `completed`, `abandoned`.
- **Timer Persistence**: Session start timestamp stored in database. Elapsed duration computed server-side from `(now - started_at)` so page reload or browser closure does not reset the timer.
- **Integrity**: Self-reported completion with explicit disclaimer, tracking time spent per problem and weak-topic coverage.

### 5. AI Hint Mode (`FEATURE_HINTS`)
- **Progressive Disclosure**: Three strict tiers: (1) Nudge, (2) Approach, (3) Pseudo-code outline.
- **Safety**: Prompt injection defense sanitizes problem input and instructs LLM to NEVER output compilable code. Output scanner verifies response before delivering to user.
- **Cost Caps**: Tiered in-memory daily quota per user (max 10 hints/day) and global daily cap to protect server resources. Graceful rule-based fallback when LLM is unavailable.

### 6. Weekly Digest Email (`FEATURE_DIGEST`)
- **Idempotent Dispatch**: Records `digest_history` with unique `(user_id, week_identifier)` preventing duplicate sends.
- **Opt-in Compliance**: Strictly opt-in via user preferences. One-click HMAC-signed unsubscribe token in email footer.
- **Cron Architecture**: Includes standalone scheduler script (`backend/features/digest/worker.js`) callable locally or via external cron webhooks for Render free-tier compatibility.

### 7. Problem Notes & Bookmarks (`FEATURE_NOTES`)
- **Privacy & Ownership**: All notes are private to the creator with strict UUID ownership assertions.
- **Sanitization**: Markdown sanitized using strict HTML entity escaping and size constraints (max 10KB per note).

---

# Phase 1: Observability, Health & Reliability

## 1. Error Monitoring & Exception Scrubbing (Sentry)
- **Zero-Dependency Fallback**: Optional integration via `backend/infrastructure/sentry.js`. Activated exclusively when `SENTRY_DSN` is set. If missing or if `@sentry/node` is uninstalled, it degrades to a harmless no-op without crashing the application.
- **Strict PII & Credential Scrubbing**: In `beforeSend`, all request headers (`cookie`, `authorization`, `x-csrf-token`), request body keys containing `password`, `token`, `secret`, and user email addresses are stripped or replaced with `[REDACTED]`.
- **Sample Rates & Releases**: Release tagged with `package.json` version; trace sample rate capped at 10% in production to remain within free tier quotas.

## 2. Structured JSON Logging & Correlation IDs
- **Format**: All logs output single-line structured JSON to stdout for log aggregators (Render, Datadog, CloudWatch).
- **Correlation**: `X-Request-ID` is extracted from incoming proxy headers or minted via `crypto.randomUUID()`. Propagated to response headers and attached to every log line and downstream error.
- **Security Scrubber**: Deep recursive scrubber in `logger.js` automatically redacts credentials, passwords, tokens, API keys, and cookie headers.
- **Log Levels**: Dynamic filtering via `LOG_LEVEL` (`debug`, `info`, `warn`, `error`, default `info`).

## 3. Tiered Health Probes & Operational Endpoints
- **Liveness (`GET /healthz`)**: Fast, lightweight check verifying node process health and uptime. Zero database or network calls; ideal for orchestrator liveness checks.
- **Readiness (`GET /readyz`)**: Deep check validating database connectivity, cache state, and upstream circuit health. Returns HTTP 200 when ready or 503 when degraded.
- **Public Status (`GET /status`)**: Public-facing status monitor. Serves JSON to API monitors and an accessible branded HTML status page when requested by web browsers.
- **Legacy Compatibility**: Existing `/health` endpoint left completely untouched, ensuring 100% backward compatibility with existing tests and Render configuration.
- **Rate Limit Bypass**: All health endpoints are mounted before the 30 req/min rate limiter to prevent uptime monitors from being blocked with HTTP 429.

## 4. Upstream Circuit Breaking & Graceful Degradation
- **Centralized Engine (`backend/infrastructure/resilience.js`)**: State machine (`CLOSED`, `OPEN`, `HALF_OPEN`) tracking consecutive failures (threshold: 3) and cooldown periods (30s).
- **Exponential Backoff with Full Jitter**: Upstream retries apply jittered backoff `Math.floor(min(maxDelay, baseDelay * 2^attempt) * (0.5 + Math.random() * 0.5))` to avoid thundering herds.
- **Timeouts**: Every external call (LeetCode, Codeforces, CodeChef, GitHub, Gemini, Resend/Brevo) is wrapped with an `AbortController` timeout (8-12 seconds).
- **Graceful Degradation Guarantee**: If any third-party provider fails or trips its circuit, the service immediately returns a cached or degraded object (`{ available: false }` or rule-based fallback). One platform's outage NEVER breaks a user's profile view or application flow.

## 5. Maintenance Mode & Branded Error Pages
- **Maintenance Interceptor**: Controlled by `MAINTENANCE_MODE="true"` env var (default: disabled). Returns HTTP 503 with maintenance messaging or renders `maintenance.html`.
- **Monitor Whitelist**: Even during maintenance, `/healthz`, `/readyz`, and `/status` remain accessible so external pingers (UptimeRobot, BetterStack) do not trigger false downtime alarms.
- **Branded Pages**: Added `404.html`, `500.html`, and `maintenance.html` styled using the application's existing CSS tokens (`--surface`, `--border`, `--accent2`, `--font-display`, `--danger`).

