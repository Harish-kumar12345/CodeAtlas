/**
 * Reversible migration: 001_create_auth_tables
 * Supports both SQLite and PostgreSQL
 */

const sqliteUp = `
  CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    display_name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    is_email_verified INTEGER NOT NULL DEFAULT 0,
    is_public INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users (email);

  CREATE TABLE IF NOT EXISTS oauth_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_email TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (provider, provider_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts (user_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    user_agent TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

  CREATE TABLE IF NOT EXISTS email_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    type TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_email_tokens_hash ON email_tokens (token_hash);
  CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens (user_id);

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    event TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (user_id);

  CREATE TABLE IF NOT EXISTS auth_user_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, platform, username)
  );

  CREATE INDEX IF NOT EXISTS idx_auth_user_links_user ON auth_user_links (user_id);

  CREATE TABLE IF NOT EXISTS auth_user_goals (
    user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    daily_target INTEGER NOT NULL DEFAULT 3,
    reminders_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_channel TEXT,
    updated_at TEXT NOT NULL
  );
`;

const sqliteDown = `
  DROP TABLE IF EXISTS auth_user_goals;
  DROP TABLE IF EXISTS auth_user_links;
  DROP TABLE IF EXISTS audit_log;
  DROP TABLE IF EXISTS email_tokens;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS oauth_accounts;
  DROP TABLE IF EXISTS auth_users;
`;

const pgUp = `
  CREATE TABLE IF NOT EXISTS auth_users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    display_name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users (email);

  CREATE TABLE IF NOT EXISTS oauth_accounts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts (user_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    user_agent TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

  CREATE TABLE IF NOT EXISTS email_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    type TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_email_tokens_hash ON email_tokens (token_hash);
  CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens (user_id);

  CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY,
    user_id UUID,
    event TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    metadata TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (user_id);

  CREATE TABLE IF NOT EXISTS auth_user_links (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, platform, username)
  );

  CREATE INDEX IF NOT EXISTS idx_auth_user_links_user ON auth_user_links (user_id);

  CREATE TABLE IF NOT EXISTS auth_user_goals (
    user_id UUID PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    daily_target INTEGER NOT NULL DEFAULT 3,
    reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_channel TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const pgDown = `
  DROP TABLE IF EXISTS auth_user_goals;
  DROP TABLE IF EXISTS auth_user_links;
  DROP TABLE IF EXISTS audit_log;
  DROP TABLE IF EXISTS email_tokens;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS oauth_accounts;
  DROP TABLE IF EXISTS auth_users;
`;

async function up(runner, isPostgres = false) {
  const sql = isPostgres ? pgUp : sqliteUp;
  if (isPostgres) {
    await runner(sql);
  } else {
    // Split for SQLite runner if needed or run in sequence
    const statements = sql.split(";").map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await runner(stmt);
    }
  }
}

async function down(runner, isPostgres = false) {
  const sql = isPostgres ? pgDown : sqliteDown;
  if (isPostgres) {
    await runner(sql);
  } else {
    const statements = sql.split(";").map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await runner(stmt);
    }
  }
}

module.exports = { up, down, sqliteUp, sqliteDown, pgUp, pgDown };
