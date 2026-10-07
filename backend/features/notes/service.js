// backend/features/notes/service.js
const db = require("../db");
const revisionService = require("../revision/service");

const MAX_NOTE_LENGTH = 10000;

function sanitizeText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeTags(tags) {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(",");
  return list
    .map((t) => String(t || "").trim().toLowerCase().slice(0, 30))
    .filter(Boolean)
    .slice(0, 10);
}

async function saveNote(userId, {
  platform = "leetcode",
  problemSlug,
  problemTitle = "",
  noteMarkdown = "",
  tags = [],
  isFavourite = false,
  addToRevision = false,
}) {
  if (!userId || !problemSlug) {
    throw new Error("userId and problemSlug are required");
  }
  if (noteMarkdown.length > MAX_NOTE_LENGTH) {
    throw new Error(`Note exceeds maximum length of ${MAX_NOTE_LENGTH} characters`);
  }

  await db.ensureInitialized();
  const id = db.generateId();
  const now = new Date().toISOString();
  const cleanMarkdown = sanitizeText(noteMarkdown);
  const cleanTitle = sanitizeText(problemTitle || problemSlug).slice(0, 255);
  const cleanTags = normalizeTags(tags);
  const favInt = isFavourite ? 1 : 0;
  const pPlatform = String(platform || "leetcode").toLowerCase();
  const pSlug = String(problemSlug).toLowerCase();

  await db.execute(
    `INSERT INTO problem_notes (
      id, user_id, platform, problem_slug, problem_title, note_markdown, tags, is_favourite, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, platform, problem_slug) DO UPDATE SET
      problem_title = ?, note_markdown = ?, tags = ?, is_favourite = ?, updated_at = ?`,
    [
      id, userId, pPlatform, pSlug, cleanTitle, cleanMarkdown, JSON.stringify(cleanTags), favInt, now, now,
      cleanTitle, cleanMarkdown, JSON.stringify(cleanTags), favInt, now,
    ]
  );

  // If user requested add to revision list
  if (addToRevision) {
    await revisionService.addItem(userId, {
      problemTitle: cleanTitle,
      problemSlug: pSlug,
      platform: pPlatform,
    });
  }

  const rows = await db.query(
    "SELECT * FROM problem_notes WHERE user_id = ? AND platform = ? AND problem_slug = ?",
    [userId, pPlatform, pSlug]
  );

  return rows[0];
}

async function getNotes(userId, filters = {}) {
  if (!userId) return [];
  await db.ensureInitialized();

  let sql = "SELECT * FROM problem_notes WHERE user_id = ?";
  const params = [userId];

  if (filters.favouriteOnly) {
    sql += " AND is_favourite = 1";
  }

  sql += " ORDER BY updated_at DESC";
  const rows = await db.query(sql, params);

  let result = rows.map((r) => ({
    ...r,
    tags: JSON.parse(r.tags || "[]"),
    is_favourite: Boolean(r.is_favourite),
  }));

  if (filters.tag) {
    const targetTag = String(filters.tag).toLowerCase().trim();
    result = result.filter((r) => r.tags.includes(targetTag));
  }

  if (filters.query) {
    const q = String(filters.query).toLowerCase().trim();
    result = result.filter((r) => r.problem_title.toLowerCase().includes(q) || r.note_markdown.toLowerCase().includes(q));
  }

  return result;
}

async function getNote(userId, platform, problemSlug) {
  if (!userId || !problemSlug) return null;
  await db.ensureInitialized();
  const rows = await db.query(
    "SELECT * FROM problem_notes WHERE user_id = ? AND platform = ? AND problem_slug = ?",
    [userId, String(platform || "leetcode").toLowerCase(), String(problemSlug).toLowerCase()]
  );
  if (!rows || rows.length === 0) return null;
  return {
    ...rows[0],
    tags: JSON.parse(rows[0].tags || "[]"),
    is_favourite: Boolean(rows[0].is_favourite),
  };
}

async function deleteNote(userId, noteId) {
  if (!userId || !noteId) return false;
  await db.ensureInitialized();
  const res = await db.execute("DELETE FROM problem_notes WHERE id = ? AND user_id = ?", [noteId, userId]);
  return res.changes > 0;
}

module.exports = {
  saveNote,
  getNotes,
  getNote,
  deleteNote,
  sanitizeText,
  MAX_NOTE_LENGTH,
};
