// backend/features/db.js - Database access layer for companion features
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");
const migration = require("./migrations/002_create_companion_tables");

const isPostgres = Boolean(process.env.DATABASE_URL || process.env.DB_DRIVER === "postgres");

let sqliteDb = null;
let pgPool = null;
let initPromise = null;

function generateId() {
  return crypto.randomUUID();
}

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

async function execSqlite(sql) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function query(sql, params = []) {
  await ensureInitialized();
  if (isPostgres) {
    const pool = getDb();
    let pgSql = sql;
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
    const res = await pool.query(pgSql, params);
    return res.rows;
  }
  return allSqlite(sql, params);
}

async function execute(sql, params = []) {
  await ensureInitialized();
  if (isPostgres) {
    const pool = getDb();
    let pgSql = sql;
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
    const res = await pool.query(pgSql, params);
    return { changes: res.rowCount };
  }
  return runSqlite(sql, params);
}

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      if (isPostgres) {
        const pool = getDb();
        await pool.query(migration.POSTGRES_UP);
      } else {
        await execSqlite(migration.SQLITE_UP);
      }
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

module.exports = {
  getDb,
  query,
  execute,
  generateId,
  ensureInitialized,
  isPostgres,
};
