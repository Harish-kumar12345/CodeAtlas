# Production Readiness Audit — LeetMatric

**Audit Date:** October 2026  
**Audited By:** Principal Software Engineer, SRE & Security Reviewer  
**Target Environment:** Render Free Tier (`https://leetlytics.onrender.com`) + Local Development  
**Branch:** `chore/production-readiness`

---

## Executive Summary

LeetMatric is a comprehensive coding analytics platform and daily preparation companion built with Node.js, Express, SQLite/PostgreSQL, and Vanilla JS. It features multi-platform analytics, spaced repetition revision, contest tracking, badges/XP, mock interviews, AI study plans, PDF exports, and session-based authentication.

This audit evaluates the system across 7 core production readiness dimensions before applying non-breaking infrastructure, security, observability, and reliability upgrades.

| Dimension | Baseline Score | Target Score | Key Finding |
|---|:---:|:---:|---|
| **1. Reliability** | **6.5 / 10** | **9.5 / 10** | Partial circuit breaker (LeetCode only); missing `/healthz`, `/readyz`, exponential backoff, maintenance mode, and Render keep-alive ping docs. |
| **2. Security** | **7.5 / 10** | **9.5 / 10** | Strong password & session crypto; lacks Helmet HTTP security headers, CSP, Sentry PII sanitization, and strict request body size guards. |
| **3. Performance** | **7.0 / 10** | **9.0 / 10** | Functional in-memory TTL cache; lacks HTTP compression (`gzip`/`brotli`), static asset caching headers, and DB query index optimization. |
| **4. DevOps & CI/CD** | **6.0 / 10** | **9.0 / 10** | Basic GitHub Action exists; lacks Infrastructure-as-Code (`render.yaml`), container healthcheck alignment, and automated audit checks. |
| **5. Observability** | **5.5 / 10** | **9.0 / 10** | Basic JSON request logs; missing correlation IDs (`x-request-id`), Sentry error tracking, configurable `LOG_LEVEL`, and `/status` page. |
| **6. Data Safety** | **6.5 / 10** | **9.0 / 10** | Reversible migrations in place; ephemeral disk hazard on Render free tier requires clear Postgres transition guidance and backup tools. |
| **7. Documentation** | **8.0 / 10** | **9.5 / 10** | Excellent feature docs; missing SRE incident runbook, monitoring setup guide, and cold-start workarounds. |

**Overall Baseline Readiness Score:** **6.7 / 10**

---

## 1. Reliability (Score: 6.5 / 10)

### Current Architecture
- `backend/server.js` implements a naive 3-strike circuit breaker (`CIRCUIT_COOLDOWN_MS = 60000`) solely for the LeetCode GraphQL query.
- Upstream adapters for Codeforces, CodeChef, GitHub (`backend/platforms.js`), and LLM study plans (`backend/engagement.js`) do not participate in circuit breaking.
- Process crashes or upstream timeouts (e.g., Codeforces downtime) can trigger unhandled 502/504 errors.
- Render free tier instances sleep after 15 minutes of inbound inactivity, leading to 50-60 second cold starts on subsequent requests.

### Critical Gaps
1. **Liveness & Readiness Endpoints:** Missing industry-standard `/healthz` (shallow process alive check) and `/readyz` (deep dependency check: DB connection, cache health, scheduler state).
2. **Resilience Across All Upstreams:** Circuit breaker and exponential backoff with random jitter must wrap *every* third-party network call (LeetCode, Codeforces, CodeChef, GitHub, Gemini, Resend/SMTP).
3. **Graceful Maintenance Mode:** No `MAINTENANCE_MODE` toggle to cleanly intercept traffic during database migrations or provider maintenance.
4. **Custom Error Pages:** When 404 or 500 errors occur on browser routes, users see raw JSON or default browser pages instead of branded recovery pages.

---

## 2. Security (Score: 7.5 / 10)

### Current Architecture
- Passwords hashed using Argon2id with strict OWASP parameters.
- Session tokens signed with HMAC-SHA256 and stored in `HttpOnly`, `SameSite=Lax` cookies.
- CSRF protection via double-submit / custom headers on mutating endpoints.
- Rate limiter (`express-rate-limit`) applied to `/api/` (30 requests/minute per IP).

### Critical Gaps
1. **HTTP Security Headers:** Missing Helmet configuration (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Referrer-Policy: strict-origin-when-cross-origin`).
2. **Sentry Error Tracking with PII Scrubbing:** Unhandled exceptions are not aggregated in a central Sentry project. When Sentry is enabled, sensitive fields (passwords, tokens, cookies, emails) must be rigorously scrubbed before transmission.
3. **Payload Size Guardrails:** Express body parser should explicitly enforce `limit: '100kb'` to thwart memory exhaustion denial-of-service attempts.

---

## 3. Performance (Score: 7.0 / 10)

### Current Architecture
- `backend/cache.js` provides an in-memory TTL map (`endpointCache`, `profileCache`, `studyPlanCache`).
- Dynamic SVG stats cards cached for 15 minutes (`Cache-Control: public, max-age=900`).

### Critical Gaps
1. **HTTP Response Compression:** Text, JSON, and SVG payloads are sent uncompressed. Adding gzip/brotli compression (`compression` middleware) typically reduces API payload size by 65–80%.
2. **Static Asset Caching:** Assets in `frontend/public/` are served with default HTTP headers rather than explicit cache lifetimes (`max-age=86400` with ETags).
3. **Database Indexing:** SQLite/Postgres tables for snapshots (`user_snapshots`) and mock interview sessions require explicit compound indexes on `(username, snapshot_date)` and `(user_id, status)` to ensure sub-millisecond query execution.

---

## 4. DevOps & CI/CD (Score: 6.0 / 10)

### Current Architecture
- GitHub Actions workflow `.github/workflows/ci.yml` runs `npm test` and `docker build`.
- Multi-stage Dockerfile based on `node:22-bookworm-slim`.

### Critical Gaps
1. **Render Infrastructure as Code (`render.yaml`):** The repository lacks a declarative blueprint for Render Web Services and PostgreSQL provisioning.
2. **Healthcheck Alignment:** The Dockerfile CMD healthcheck pings `/health`; expanding this to `/healthz` provides a clean container orchestration contract.

---

## 5. Observability (Score: 5.5 / 10)

### Current Architecture
- Custom JSON logging middleware logs `{ event: "request", requestId, method, path, status, durationMs }`.

### Critical Gaps
1. **Request Correlation (`x-request-id`):** Incoming `x-request-id` headers from reverse proxies (Render, Cloudflare) are not parsed; request IDs are generated locally and not reflected back in response headers.
2. **Configurable Log Levels:** All logs are output without log-level filtering (`debug`, `info`, `warn`, `error`) controllable via a `LOG_LEVEL` env var.
3. **Public Status Page (`/status`):** No unauthenticated status view allows users or uptime pingers to observe subsystem availability.

---

## 6. Data Safety & Free Tier Constraints (Score: 6.5 / 10)

### Render Free Tier Specifics:
1. **Ephemeral Disk:** Render free instances do not persist local disk writes across redeploys or restarts. If SQLite is used without an external database, data resets whenever Render restarts the container.
   - *Remediation:* Provide seamless `DATABASE_URL` PostgreSQL fallback with automatic schema initialization.
2. **Free Database Limits:** Free managed Postgres instances on Render expire after 90 days or limit rows. Documentation must explain connection pooling and backup procedures.

---

## 7. Action Plan

- [ ] **Phase 1: Observability and Reliability**
  - Implement Sentry integration (backend & frontend) with strict PII scrubbing.
  - Implement structured JSON logging with `LOG_LEVEL` and `x-request-id` propagation.
  - Add `/healthz` (liveness) and `/readyz` (readiness) endpoints.
  - Add `/status` page with uptime monitor documentation.
  - Wrap all upstreams in circuit breakers with exponential backoff & jitter.
  - Add `MAINTENANCE_MODE` flag and branded error/maintenance pages.
- [ ] **Phase 2: Security Hardening**
  - Integrate Helmet security headers & CSP.
  - Payload limits & security audit remediation.
- [ ] **Phase 3: Performance & Optimization**
  - Add response compression & static asset cache headers.
  - Add database indexing migration.
- [ ] **Phase 4: Production DevOps & Documentation**
  - Declarative `render.yaml` and SRE runbook in `docs/SRE_RUNBOOK.md`.
