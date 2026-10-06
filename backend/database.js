const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const databasePath = process.env.DB_PATH || path.join(__dirname, "data", "leetmatric.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new sqlite3.Database(databasePath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

const ready = run(`
  CREATE TABLE IF NOT EXISTS snapshots (
    username TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    total_solved INTEGER NOT NULL,
    easy_solved INTEGER NOT NULL,
    medium_solved INTEGER NOT NULL,
    hard_solved INTEGER NOT NULL,
    contest_rating REAL,
    PRIMARY KEY (username, snapshot_date)
  )
`);
const engagementReady = ready
  .then(() => run(`
  CREATE TABLE IF NOT EXISTS goals (
    username TEXT PRIMARY KEY,
    daily_target INTEGER NOT NULL,
    reminders_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_channel TEXT,
    updated_at TEXT NOT NULL
  )`))
  .then(() => run(`
  CREATE TABLE IF NOT EXISTS group_members (
    group_code TEXT NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (group_code, username)
  )`));

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function saveSnapshot(username, profileResponse) {
  await ready;
  const user = profileResponse.matchedUser;
  const difficulty = profileResponse.analytics?.difficulty || [];
  const solved = (index) => Number(difficulty[index]?.solved) || 0;
  return run(`
    INSERT OR REPLACE INTO snapshots
      (username, snapshot_date, total_solved, easy_solved, medium_solved, hard_solved, contest_rating)
    VALUES (?, ?, ?, ?, ?, ?, ?)
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
  return all(`
    SELECT snapshot_date AS date, total_solved AS totalSolved,
      easy_solved AS easySolved, medium_solved AS mediumSolved,
      hard_solved AS hardSolved, contest_rating AS contestRating
    FROM snapshots
    WHERE username = ? AND snapshot_date >= date('now', ?)
    ORDER BY snapshot_date ASC
  `, [username.toLowerCase(), `-${boundedDays - 1} days`]);
}

async function saveGoal(username, goal) {
  await engagementReady;
  return run(`
    INSERT OR REPLACE INTO goals (username, daily_target, reminders_enabled, reminder_channel, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `, [username.toLowerCase(), goal.dailyTarget, goal.remindersEnabled ? 1 : 0, goal.reminderChannel || null]);
}

async function getGoal(username) {
  await engagementReady;
  const rows = await all("SELECT username, daily_target AS dailyTarget, reminders_enabled AS remindersEnabled, reminder_channel AS reminderChannel, updated_at AS updatedAt FROM goals WHERE username = ?", [username.toLowerCase()]);
  return rows[0] || null;
}

async function addGroupMember(groupCode, username) {
  await engagementReady;
  return run("INSERT OR IGNORE INTO group_members (group_code, username) VALUES (?, ?)", [groupCode.toLowerCase(), username.toLowerCase()]);
}

async function getGroupMembers(groupCode) {
  await engagementReady;
  return all("SELECT username FROM group_members WHERE group_code = ? ORDER BY username", [groupCode.toLowerCase()]);
}

function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((error) => error ? reject(error) : resolve());
  });
}

module.exports = { addGroupMember, closeDatabase, getGoal, getGroupMembers, getProgressHistory, saveGoal, saveSnapshot };
