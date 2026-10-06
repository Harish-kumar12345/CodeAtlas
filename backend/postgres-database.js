const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: Number(process.env.DATABASE_POOL_SIZE) || 5,
});

const ready = pool.query(`
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (provider, provider_subject)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
    ON users (email) WHERE email IS NOT NULL;
  CREATE TABLE IF NOT EXISTS linked_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    normalized_username TEXT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, normalized_username),
    UNIQUE (user_id, platform, normalized_username)
  );
  CREATE INDEX IF NOT EXISTS linked_accounts_user_idx ON linked_accounts (user_id);
  CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    weekly_reset_day SMALLINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS group_memberships (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS group_memberships_user_idx ON group_memberships (user_id);
  CREATE TABLE IF NOT EXISTS snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES linked_accounts(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    snapshot_date DATE NOT NULL,
    total_solved INTEGER NOT NULL,
    easy_solved INTEGER NOT NULL,
    medium_solved INTEGER NOT NULL,
    hard_solved INTEGER NOT NULL,
    contest_rating DOUBLE PRECISION,
    acceptance_rate DOUBLE PRECISION,
    global_rank INTEGER,
    current_streak INTEGER NOT NULL DEFAULT 0,
    active_days INTEGER NOT NULL DEFAULT 0,
    topic_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (username, snapshot_date)
  );
  CREATE TABLE IF NOT EXISTS goals (
    username TEXT PRIMARY KEY,
    daily_target INTEGER NOT NULL,
    reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_channel TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS user_goals (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    daily_target INTEGER NOT NULL,
    reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_channel TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS group_members (
    group_code TEXT NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (group_code, username)
  );
  CREATE TABLE IF NOT EXISTS study_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES linked_accounts(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    week_start DATE NOT NULL,
    input_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE (user_id, account_id, week_start, input_hash)
  );
  CREATE TABLE IF NOT EXISTS plan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_plan_id UUID NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
    day_number SMALLINT NOT NULL,
    position SMALLINT NOT NULL,
    platform TEXT NOT NULL,
    problem_slug TEXT NOT NULL,
    problem_title TEXT NOT NULL,
    topic TEXT,
    difficulty TEXT,
    reason TEXT,
    completed_at TIMESTAMPTZ,
    UNIQUE (study_plan_id, day_number, position)
  );
  CREATE INDEX IF NOT EXISTS snapshots_username_date_idx
    ON snapshots (username, snapshot_date DESC);
  CREATE INDEX IF NOT EXISTS group_members_code_idx
    ON group_members (group_code);
`);

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function saveSnapshot(username, profileResponse) {
  await ready;
  const difficulty = profileResponse.analytics?.difficulty || [];
  const solved = (index) => Number(difficulty[index]?.solved) || 0;
  return pool.query(`
    INSERT INTO snapshots
      (username, snapshot_date, total_solved, easy_solved, medium_solved, hard_solved, contest_rating)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (username, snapshot_date) DO UPDATE SET
      total_solved = EXCLUDED.total_solved,
      easy_solved = EXCLUDED.easy_solved,
      medium_solved = EXCLUDED.medium_solved,
      hard_solved = EXCLUDED.hard_solved,
      contest_rating = EXCLUDED.contest_rating
  `, [
    username.toLowerCase(),
    today(),
    solved(0) + solved(1) + solved(2),
    solved(0),
    solved(1),
    solved(2),
    profileResponse.analytics?.contestRanking?.rating ?? null,
  ]);
}

async function getProgressHistory(username, days = 30) {
  await ready;
  const boundedDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const result = await pool.query(`
    SELECT snapshot_date AS date, total_solved AS "totalSolved",
      easy_solved AS "easySolved", medium_solved AS "mediumSolved",
      hard_solved AS "hardSolved", contest_rating AS "contestRating"
    FROM snapshots
    WHERE username = $1 AND snapshot_date >= CURRENT_DATE - ($2 * INTERVAL '1 day')
    ORDER BY snapshot_date ASC
  `, [username.toLowerCase(), boundedDays - 1]);
  return result.rows;
}

async function saveGoal(username, goal) {
  await ready;
  return pool.query(`
    INSERT INTO goals (username, daily_target, reminders_enabled, reminder_channel, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (username) DO UPDATE SET
      daily_target = EXCLUDED.daily_target,
      reminders_enabled = EXCLUDED.reminders_enabled,
      reminder_channel = EXCLUDED.reminder_channel,
      updated_at = NOW()
  `, [username.toLowerCase(), goal.dailyTarget, Boolean(goal.remindersEnabled), goal.reminderChannel || null]);
}

async function getGoal(username) {
  await ready;
  const result = await pool.query(`
    SELECT username, daily_target AS "dailyTarget",
      reminders_enabled AS "remindersEnabled",
      reminder_channel AS "reminderChannel", updated_at AS "updatedAt"
    FROM goals WHERE username = $1
  `, [username.toLowerCase()]);
  return result.rows[0] || null;
}

async function saveUserGoal(userId, username, goal) {
  await ready;
  return pool.query(`
    INSERT INTO user_goals (user_id, username, daily_target, reminders_enabled, reminder_channel, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      daily_target = EXCLUDED.daily_target,
      reminders_enabled = EXCLUDED.reminders_enabled,
      reminder_channel = EXCLUDED.reminder_channel,
      updated_at = NOW()
  `, [userId, username.toLowerCase(), goal.dailyTarget, Boolean(goal.remindersEnabled), goal.reminderChannel || null]);
}

async function getUserGoal(userId) {
  await ready;
  const result = await pool.query(`
    SELECT username, daily_target AS "dailyTarget",
      reminders_enabled AS "remindersEnabled",
      reminder_channel AS "reminderChannel", updated_at AS "updatedAt"
    FROM user_goals WHERE user_id = $1
  `, [userId]);
  return result.rows[0] || null;
}

async function addGroupMember(groupCode, username) {
  await ready;
  return pool.query(
    "INSERT INTO group_members (group_code, username) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [groupCode.toLowerCase(), username.toLowerCase()],
  );
}

async function getGroupMembers(groupCode) {
  await ready;
  const result = await pool.query(
    "SELECT username FROM group_members WHERE group_code = $1 ORDER BY username",
    [groupCode.toLowerCase()],
  );
  return result.rows;
}

async function upsertUser(user) {
  await ready;
  const result = await pool.query(`
    INSERT INTO users (provider, provider_subject, email, display_name, avatar_url)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (provider, provider_subject) DO UPDATE SET
      email = EXCLUDED.email, display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
    RETURNING id, provider, provider_subject AS "providerSubject", email,
      display_name AS "displayName", avatar_url AS "avatarUrl"
  `, [user.provider, String(user.providerSubject), user.email || null, user.displayName || null, user.avatarUrl || null]);
  return result.rows[0];
}

async function getUserById(id) {
  await ready;
  const result = await pool.query(`
    SELECT id, provider, provider_subject AS "providerSubject", email,
      display_name AS "displayName", avatar_url AS "avatarUrl"
    FROM users WHERE id = $1
  `, [id]);
  return result.rows[0] || null;
}

async function deleteUser(id) {
  await ready;
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
}

async function closeDatabase() {
  await pool.end();
}

module.exports = { addGroupMember, closeDatabase, deleteUser, getGoal, getGroupMembers, getProgressHistory, getUserById, getUserGoal, saveGoal, saveSnapshot, saveUserGoal, upsertUser };
