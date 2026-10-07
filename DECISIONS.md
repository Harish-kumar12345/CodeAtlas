# Authentication decisions

## Baseline and scope

- Existing public routes remain unchanged and are covered by the characterization
  test in `backend/characterization.test.js`.
- Authentication is disabled by default with `AUTH_ENABLED=false`; this preserves
  the current anonymous behavior until production configuration is intentional.
- The existing GitHub session code is treated as legacy behavior during the
  baseline. Phase 1 will gate it behind the feature flag before adding new flows.

## Phase 1 choices

- Session storage: server-side SQLite-backed sessions, with a PostgreSQL adapter
  added in a later phase if production uses `DATABASE_URL`. This keeps local
  development dependency-light and avoids changing existing tables.
- Password hashing: Argon2id through the maintained `argon2` package.
- Authentication library: `express-session` for session lifecycle and
  `connect-sqlite3` for durable local session storage. OAuth providers will use
  authorization code + PKCE through a dedicated module rather than exposing
  provider tokens to the browser.
- User identifiers: UUIDs in new auth tables, independent of existing integer
  user IDs.
- CSRF: synchronizer tokens stored in the server session for new state-changing
  routes; SameSite=Lax remains compatible with same-origin public pages.
- Email delivery: an adapter interface with console output in development and
  an environment-configured provider in production. No provider key is committed.
- Public data: existing public APIs stay public. New private APIs will resolve
  the user only from the server session and never from a client user ID.

## Trade-offs

- A new auth schema is intentionally separate from the existing `users`,
  `linked_accounts`, and `user_goals` tables because those tables have existing
  provider-specific semantics and changing them would violate the additive
  requirement.
- The first implementation does not auto-link accounts by email. Explicit
  linking is safer because provider email verification and ownership cannot be
  assumed.
