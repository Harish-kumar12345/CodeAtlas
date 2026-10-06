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

function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((error) => error ? reject(error) : resolve());
  });
}

module.exports = { closeDatabase, getProgressHistory, saveSnapshot };
