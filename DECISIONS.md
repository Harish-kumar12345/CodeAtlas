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
