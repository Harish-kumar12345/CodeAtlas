const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");
const migration = require("./migrations/001_create_auth_tables");
const { generateUuid } = require("./crypto");

const isPostgres = Boolean(process.env.DATABASE_URL || process.env.DB_DRIVER === "postgres");

let sqliteDb = null;
let pgPool = null;
let initPromise = null;

function getDb() {
  if (isPostgres) {
    if (!pgPool) {
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
        max: Number(process.env.DATABASE_POOL_SIZE) || 5,
      });
    }
    return pgPool;
  }

  if (!sqliteDb) {
    const databasePath = process.env.DB_PATH || path.join(__dirname, "../data", "leetmatric.sqlite");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    sqliteDb = new sqlite3.Database(databasePath);
  }
  return sqliteDb;
}

function runSqlite(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function allSqlite(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows || []);
    });
  });
}

async function query(sql, params = []) {
  await ensureReady();
  if (isPostgres) {
    const pool = getDb();
    // In PostgreSQL, convert ? to $1, $2, etc.
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    const result = await pool.query(pgSql, params);
    return result.rows;
  }
  return allSqlite(sql, params);
}

async function execute(sql, params = []) {
  await ensureReady();
  if (isPostgres) {
    const pool = getDb();
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    const result = await pool.query(pgSql, params);
    return { rowCount: result.rowCount };
  }
  return runSqlite(sql, params);
}

async function ensureReady() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    getDb();
    if (isPostgres) {
      const runner = async (sql) => {
        const pool = getDb();
        await pool.query(sql);
      };
      await migration.up(runner, true);
    } else {
      const runner = async (sql) => {
        await runSqlite(sql);
      };
      await migration.up(runner, false);
    }
  })();
  return initPromise;
}

// ── Auth Users ───────────────────────────────────────────────────────────────

async function createUser({ email, passwordHash = null, displayName = null, avatarUrl = null, role = "user", isEmailVerified = false, isPublic = true }) {
  const id = generateUuid();
  const now = new Date().toISOString();
  await execute(`
    INSERT INTO auth_users (id, email, password_hash, display_name, avatar_url, role, is_email_verified, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    email.toLowerCase().trim(),
    passwordHash,
    displayName || null,
    avatarUrl || null,
    role,
    isEmailVerified ? (isPostgres ? true : 1) : (isPostgres ? false : 0),
    isPublic ? (isPostgres ? true : 1) : (isPostgres ? false : 0),
    now,
    now,
  ]);
  return getUserById(id);
}

async function getUserByEmail(email) {
  if (!email) return null;
  const rows = await query(`
    SELECT id, email, password_hash, display_name, avatar_url, role,
           is_email_verified, is_public, created_at, updated_at
    FROM auth_users
    WHERE email = ?
  `, [email.toLowerCase().trim()]);
  return normalizeUser(rows[0]);
}

async function getUserById(id) {
  if (!id) return null;
  const rows = await query(`
    SELECT id, email, password_hash, display_name, avatar_url, role,
           is_email_verified, is_public, created_at, updated_at
    FROM auth_users
    WHERE id = ?
  `, [id]);
  return normalizeUser(rows[0]);
}

function normalizeUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role || "user",
    isEmailVerified: Boolean(row.is_email_verified),
    isPublic: Boolean(row.is_public),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function updateUser(id, fields) {
  const updates = [];
  const params = [];
  const now = new Date().toISOString();

  if ("displayName" in fields) {
    updates.push("display_name = ?");
    params.push(fields.displayName);
  }
  if ("avatarUrl" in fields) {
    updates.push("avatar_url = ?");
    params.push(fields.avatarUrl);
  }
  if ("passwordHash" in fields) {
    updates.push("password_hash = ?");
    params.push(fields.passwordHash);
  }
  if ("isEmailVerified" in fields) {
    updates.push("is_email_verified = ?");
    params.push(fields.isEmailVerified ? (isPostgres ? true : 1) : (isPostgres ? false : 0));
  }
  if ("isPublic" in fields) {
    updates.push("is_public = ?");
    params.push(fields.isPublic ? (isPostgres ? true : 1) : (isPostgres ? false : 0));
  }
  if ("email" in fields) {
    updates.push("email = ?");
    params.push(fields.email.toLowerCase().trim());
  }

  if (updates.length === 0) return getUserById(id);

  updates.push("updated_at = ?");
  params.push(now);
  params.push(id);

  await execute(`UPDATE auth_users SET ${updates.join(", ")} WHERE id = ?`, params);
  return getUserById(id);
}

async function deleteUser(id) {
  await execute("DELETE FROM auth_users WHERE id = ?", [id]);
}

// ── OAuth Accounts ───────────────────────────────────────────────────────────

async function createOAuthAccount({ userId, provider, providerUserId, providerEmail = null }) {
  const id = generateUuid();
  const now = new Date().toISOString();
  await execute(`
    INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, userId, provider.toLowerCase(), String(providerUserId), providerEmail || null, now]);
  return { id, userId, provider, providerUserId, providerEmail, createdAt: now };
}

async function getOAuthAccount(provider, providerUserId) {
  const rows = await query(`
    SELECT id, user_id, provider, provider_user_id, provider_email, created_at
    FROM oauth_accounts
    WHERE provider = ? AND provider_user_id = ?
  `, [provider.toLowerCase(), String(providerUserId)]);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    userId: rows[0].user_id,
    provider: rows[0].provider,
    providerUserId: rows[0].provider_user_id,
    providerEmail: rows[0].provider_email,
    createdAt: rows[0].created_at,
  };
}

async function getOAuthAccountsForUser(userId) {
  const rows = await query(`
    SELECT id, user_id, provider, provider_user_id, provider_email, created_at
    FROM oauth_accounts
    WHERE user_id = ?
    ORDER BY created_at ASC
  `, [userId]);
  return rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    providerUserId: r.provider_user_id,
    providerEmail: r.provider_email,
    createdAt: r.created_at,
  }));
}

async function deleteOAuthAccount(userId, provider) {
  await execute("DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?", [userId, provider.toLowerCase()]);
}

// ── Sessions ─────────────────────────────────────────────────────────────────

async function createSession({ id, userId, userAgent = null, ipAddress = null, expiresAt }) {
  const now = new Date().toISOString();
  await execute(`
    INSERT INTO sessions (id, user_id, user_agent, ip_address, created_at, last_active_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [id, userId, userAgent, ipAddress, now, now, expiresAt]);
  return getSession(id);
}

async function getSession(id) {
  if (!id) return null;
  const rows = await query(`
    SELECT s.id, s.user_id, s.user_agent, s.ip_address, s.created_at, s.last_active_at, s.expires_at,
           u.email, u.display_name, u.avatar_url, u.role, u.is_email_verified, u.is_public
    FROM sessions s
    JOIN auth_users u ON s.user_id = u.id
    WHERE s.id = ?
  `, [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    userAgent: r.user_agent,
    ipAddress: r.ip_address,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
    expiresAt: r.expires_at,
    user: {
      id: r.user_id,
      email: r.email,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      role: r.role,
      isEmailVerified: Boolean(r.is_email_verified),
      isPublic: Boolean(r.is_public),
    },
  };
}

async function touchSession(id) {
  const now = new Date().toISOString();
  await execute("UPDATE sessions SET last_active_at = ? WHERE id = ?", [now, id]);
}

async function deleteSession(id) {
  await execute("DELETE FROM sessions WHERE id = ?", [id]);
}

async function deleteSessionsForUser(userId, exceptSessionId = null) {
  if (exceptSessionId) {
    await execute("DELETE FROM sessions WHERE user_id = ? AND id != ?", [userId, exceptSessionId]);
  } else {
    await execute("DELETE FROM sessions WHERE user_id = ?", [userId]);
  }
}

async function getActiveSessionsForUser(userId) {
  const rows = await query(`
    SELECT id, user_id, user_agent, ip_address, created_at, last_active_at, expires_at
    FROM sessions
    WHERE user_id = ?
    ORDER BY last_active_at DESC
  `, [userId]);
  return rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    userAgent: r.user_agent,
    ipAddress: r.ip_address,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
    expiresAt: r.expires_at,
  }));
}

// ── Email Tokens ─────────────────────────────────────────────────────────────

async function createEmailToken({ userId, tokenHash, type, expiresAt }) {
  const id = generateUuid();
  const now = new Date().toISOString();
  // Invalidate any prior unused tokens of the same type for this user
  await execute("DELETE FROM email_tokens WHERE user_id = ? AND type = ? AND used_at IS NULL", [userId, type]);
  await execute(`
    INSERT INTO email_tokens (id, user_id, token_hash, type, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, userId, tokenHash, type, expiresAt, now]);
  return { id, userId, tokenHash, type, expiresAt, createdAt: now };
}

async function getEmailToken(tokenHash, type) {
  const rows = await query(`
    SELECT id, user_id, token_hash, type, expires_at, used_at, created_at
    FROM email_tokens
    WHERE token_hash = ? AND type = ? AND used_at IS NULL
  `, [tokenHash, type]);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    userId: rows[0].user_id,
    tokenHash: rows[0].token_hash,
    type: rows[0].type,
    expiresAt: rows[0].expires_at,
    usedAt: rows[0].used_at,
    createdAt: rows[0].created_at,
  };
}

async function markEmailTokenUsed(id) {
  const now = new Date().toISOString();
  await execute("UPDATE email_tokens SET used_at = ? WHERE id = ?", [now, id]);
}

// ── Audit Log ────────────────────────────────────────────────────────────────

async function addAuditLog({ userId = null, event, ipAddress = null, userAgent = null, metadata = null }) {
  const id = generateUuid();
  const now = new Date().toISOString();
  const metaStr = typeof metadata === "object" && metadata !== null ? JSON.stringify(metadata) : (metadata || null);
  await execute(`
    INSERT INTO audit_log (id, user_id, event, ip_address, user_agent, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [id, userId, event, ipAddress, userAgent, metaStr, now]);
}

async function getAuditLogsForUser(userId, limit = 20) {
  const rows = await query(`
    SELECT id, user_id, event, ip_address, user_agent, metadata, created_at
    FROM audit_log
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
  return rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    event: r.event,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: r.created_at,
  }));
}

// ── User Links and Goals ─────────────────────────────────────────────────────

async function getUserLinks(userId) {
  const rows = await query(`
    SELECT id, platform, username, is_primary, created_at
    FROM auth_user_links
    WHERE user_id = ?
    ORDER BY is_primary DESC, created_at ASC
  `, [userId]);
  return rows.map(r => ({
    id: r.id,
    platform: r.platform,
    username: r.username,
    isPrimary: Boolean(r.is_primary),
    createdAt: r.created_at,
  }));
}

async function upsertUserLink(userId, platform, username, isPrimary = false) {
  const id = generateUuid();
  const now = new Date().toISOString();
  const normalizedPlatform = platform.toLowerCase();
  const normalizedUsername = username.trim();

  if (isPrimary) {
    await execute("UPDATE auth_user_links SET is_primary = 0 WHERE user_id = ?", [userId]);
  }

  // SQLite or Postgres upsert
  if (isPostgres) {
    await execute(`
      INSERT INTO auth_user_links (id, user_id, platform, username, is_primary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, platform, username) DO UPDATE SET is_primary = excluded.is_primary
    `, [id, userId, normalizedPlatform, normalizedUsername, isPrimary, now]);
  } else {
    await execute(`
      INSERT OR REPLACE INTO auth_user_links (id, user_id, platform, username, is_primary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, userId, normalizedPlatform, normalizedUsername, isPrimary ? 1 : 0, now]);
  }
  return getUserLinks(userId);
}

async function deleteUserLink(userId, platform, username) {
  await execute("DELETE FROM auth_user_links WHERE user_id = ? AND platform = ? AND username = ?", [
    userId, platform.toLowerCase(), username.trim(),
  ]);
  return getUserLinks(userId);
}

async function getUserGoal(userId) {
  const rows = await query(`
    SELECT user_id, daily_target, reminders_enabled, reminder_channel, updated_at
    FROM auth_user_goals
    WHERE user_id = ?
  `, [userId]);
  if (!rows[0]) return null;
  return {
    userId: rows[0].user_id,
    dailyTarget: Number(rows[0].daily_target),
    remindersEnabled: Boolean(rows[0].reminders_enabled),
    reminderChannel: rows[0].reminder_channel,
    updatedAt: rows[0].updated_at,
  };
}

async function saveUserGoal(userId, goal) {
  const now = new Date().toISOString();
  const target = Number(goal.dailyTarget) || 3;
  const reminders = Boolean(goal.remindersEnabled);
  const channel = goal.reminderChannel || null;

  if (isPostgres) {
    await execute(`
      INSERT INTO auth_user_goals (user_id, daily_target, reminders_enabled, reminder_channel, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        daily_target = excluded.daily_target,
        reminders_enabled = excluded.reminders_enabled,
        reminder_channel = excluded.reminder_channel,
        updated_at = excluded.updated_at
    `, [userId, target, reminders, channel, now]);
  } else {
    await execute(`
      INSERT OR REPLACE INTO auth_user_goals (user_id, daily_target, reminders_enabled, reminder_channel, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `, [userId, target, reminders ? 1 : 0, channel, now]);
  }
  return getUserGoal(userId);
}

async function closeAuthDatabase() {
  if (sqliteDb) {
    await new Promise((resolve) => sqliteDb.close(() => resolve()));
    sqliteDb = null;
  }
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  initPromise = null;
}

module.exports = {
  ensureReady,
  createUser,
  getUserByEmail,
  getUserById,
  updateUser,
  deleteUser,
  createOAuthAccount,
  getOAuthAccount,
  getOAuthAccountsForUser,
  deleteOAuthAccount,
  createSession,
  getSession,
  touchSession,
  deleteSession,
  deleteSessionsForUser,
  getActiveSessionsForUser,
  createEmailToken,
  getEmailToken,
  markEmailTokenUsed,
  addAuditLog,
  getAuditLogsForUser,
  getUserLinks,
  upsertUserLink,
  deleteUserLink,
  getUserGoal,
  saveUserGoal,
  closeAuthDatabase,
};
