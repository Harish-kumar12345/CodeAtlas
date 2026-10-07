// 002_create_companion_tables.js - Reversible schema migration for Daily Prep Companion features

const SQLITE_UP = `
CREATE TABLE IF NOT EXISTS revision_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  problem_title TEXT NOT NULL,
  problem_slug TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'leetcode',
  difficulty TEXT DEFAULT 'Medium',
  topic TEXT,
  next_review_date TEXT NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 1,
  repetitions INTEGER NOT NULL DEFAULT 0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, platform, problem_slug)
);

CREATE TABLE IF NOT EXISTS revision_events (
  id TEXT PRIMARY KEY,
  revision_item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  recall_rating TEXT NOT NULL,
  interval_before INTEGER NOT NULL,
  interval_after INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contest_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  contest_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  contest_name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  reminded_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, contest_id)
);

CREATE TABLE IF NOT EXISTS badge_awards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  badge_tier TEXT NOT NULL DEFAULT 'bronze',
  metadata TEXT,
  awarded_at TEXT NOT NULL,
  UNIQUE(user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS xp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  xp_amount INTEGER NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS mock_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 45,
  target_difficulty TEXT,
  target_topics TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  score INTEGER DEFAULT 0,
  ai_feedback TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_session_problems (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  problem_title TEXT NOT NULL,
  problem_slug TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'leetcode',
  difficulty TEXT NOT NULL DEFAULT 'Medium',
  topic TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unsolved',
  time_spent_seconds INTEGER DEFAULT 0,
  solved_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_hint_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  hint_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS digest_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  week_identifier TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  UNIQUE(user_id, week_identifier)
);

CREATE TABLE IF NOT EXISTS user_companion_prefs (
  user_id TEXT PRIMARY KEY,
  timezone TEXT DEFAULT 'UTC',
  digest_opt_in INTEGER NOT NULL DEFAULT 0,
  contest_reminders_opt_in INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS problem_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'leetcode',
  problem_slug TEXT NOT NULL,
  problem_title TEXT NOT NULL,
  note_markdown TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  is_favourite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, platform, problem_slug)
);
`;

const POSTGRES_UP = `
CREATE TABLE IF NOT EXISTS revision_items (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  problem_title VARCHAR(255) NOT NULL,
  problem_slug VARCHAR(255) NOT NULL,
  platform VARCHAR(64) NOT NULL DEFAULT 'leetcode',
  difficulty VARCHAR(32) DEFAULT 'Medium',
  topic VARCHAR(128),
  next_review_date VARCHAR(32) NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 1,
  repetitions INTEGER NOT NULL DEFAULT 0,
  ease_factor NUMERIC(4,2) NOT NULL DEFAULT 2.50,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, platform, problem_slug)
);

CREATE TABLE IF NOT EXISTS revision_events (
  id VARCHAR(64) PRIMARY KEY,
  revision_item_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  recall_rating VARCHAR(32) NOT NULL,
  interval_before INTEGER NOT NULL,
  interval_after INTEGER NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contest_reminders (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  contest_id VARCHAR(128) NOT NULL,
  platform VARCHAR(64) NOT NULL,
  contest_name VARCHAR(255) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, contest_id)
);

CREATE TABLE IF NOT EXISTS badge_awards (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  badge_id VARCHAR(64) NOT NULL,
  badge_tier VARCHAR(32) NOT NULL DEFAULT 'bronze',
  metadata JSONB,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS xp_events (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(128) NOT NULL,
  xp_amount INTEGER NOT NULL,
  description VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS mock_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 45,
  target_difficulty VARCHAR(32),
  target_topics TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  score INTEGER DEFAULT 0,
  ai_feedback TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mock_session_problems (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  problem_title VARCHAR(255) NOT NULL,
  problem_slug VARCHAR(255) NOT NULL,
  platform VARCHAR(64) NOT NULL DEFAULT 'leetcode',
  difficulty VARCHAR(32) NOT NULL DEFAULT 'Medium',
  topic VARCHAR(128),
  order_index INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'unsolved',
  time_spent_seconds INTEGER DEFAULT 0,
  solved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_hint_usage (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  date VARCHAR(32) NOT NULL,
  hint_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS digest_history (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  week_identifier VARCHAR(32) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(32) NOT NULL DEFAULT 'sent',
  UNIQUE(user_id, week_identifier)
);

CREATE TABLE IF NOT EXISTS user_companion_prefs (
  user_id VARCHAR(64) PRIMARY KEY,
  timezone VARCHAR(64) DEFAULT 'UTC',
  digest_opt_in INTEGER NOT NULL DEFAULT 0,
  contest_reminders_opt_in INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS problem_notes (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  platform VARCHAR(64) NOT NULL DEFAULT 'leetcode',
  problem_slug VARCHAR(255) NOT NULL,
  problem_title VARCHAR(255) NOT NULL,
  note_markdown TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  is_favourite INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, platform, problem_slug)
);
`;

const DOWN = `
DROP TABLE IF EXISTS problem_notes;
DROP TABLE IF EXISTS user_companion_prefs;
DROP TABLE IF EXISTS digest_history;
DROP TABLE IF EXISTS ai_hint_usage;
DROP TABLE IF EXISTS mock_session_problems;
DROP TABLE IF EXISTS mock_sessions;
DROP TABLE IF EXISTS xp_events;
DROP TABLE IF EXISTS badge_awards;
DROP TABLE IF EXISTS contest_reminders;
DROP TABLE IF EXISTS revision_events;
DROP TABLE IF EXISTS revision_items;
`;

module.exports = {
  SQLITE_UP,
  POSTGRES_UP,
  DOWN,
};
