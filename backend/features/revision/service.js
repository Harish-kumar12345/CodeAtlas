// backend/features/revision/service.js
const db = require("../db");
const { next_review } = require("./algorithm");

async function addItem(userId, { problemTitle, problemSlug, platform = "leetcode", difficulty = "Medium", topic = "General" }) {
  if (!userId || !problemSlug) throw new Error("userId and problemSlug are required");
  const id = db.generateId();
  const now = new Date().toISOString();
  const todayStr = now.slice(0, 10);

  // Check if exists
  const existing = await db.query(
    "SELECT id FROM revision_items WHERE user_id = ? AND platform = ? AND problem_slug = ?",
    [userId, platform.toLowerCase(), problemSlug.toLowerCase()]
  );

  if (existing && existing.length > 0) {
    return existing[0];
  }

  // Next review scheduled for today if new
  await db.execute(
    `INSERT INTO revision_items (
      id, user_id, problem_title, problem_slug, platform, difficulty, topic,
      next_review_date, interval_days, repetitions, ease_factor, last_reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 2.5, NULL, ?, ?)`,
    [
      id,
      userId,
      problemTitle || problemSlug,
      problemSlug.toLowerCase(),
      platform.toLowerCase(),
      difficulty || "Medium",
      topic || "General",
      todayStr,
      now,
      now,
    ]
  );

  const rows = await db.query("SELECT * FROM revision_items WHERE id = ?", [id]);
  return rows[0];
}

async function getTodayItems(userId, refDateStr = new Date().toISOString().slice(0, 10)) {
  if (!userId) return [];
  return db.query(
    "SELECT * FROM revision_items WHERE user_id = ? AND next_review_date <= ? ORDER BY next_review_date ASC, updated_at DESC",
    [userId, refDateStr]
  );
}

async function getAllItems(userId) {
  if (!userId) return [];
  return db.query(
    "SELECT * FROM revision_items WHERE user_id = ? ORDER BY next_review_date ASC",
    [userId]
  );
}

async function recordReview(userId, itemId, recallRating, today = new Date()) {
  const rows = await db.query("SELECT * FROM revision_items WHERE id = ? AND user_id = ?", [itemId, userId]);
  if (!rows || rows.length === 0) return null;
  const item = rows[0];

  const nextState = next_review(item, recallRating, today);
  const now = new Date().toISOString();
  const eventId = db.generateId();

  // Log event
  await db.execute(
    `INSERT INTO revision_events (id, revision_item_id, user_id, recall_rating, interval_before, interval_after, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      item.id,
      userId,
      recallRating,
      item.interval_days,
      nextState.interval_days,
      now,
    ]
  );

  // Update item
  await db.execute(
    `UPDATE revision_items
     SET next_review_date = ?, interval_days = ?, repetitions = ?, ease_factor = ?, last_reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      nextState.next_review_date,
      nextState.interval_days,
      nextState.repetitions,
      nextState.ease_factor,
      now,
      now,
      item.id,
    ]
  );

  const updatedRows = await db.query("SELECT * FROM revision_items WHERE id = ?", [itemId]);
  return updatedRows[0];
}

async function deleteItem(userId, itemId) {
  const res = await db.execute("DELETE FROM revision_items WHERE id = ? AND user_id = ?", [itemId, userId]);
  return res.changes > 0;
}

async function syncAcceptedSubmissions(userId, recentSubmissions = []) {
  if (!userId || !Array.isArray(recentSubmissions)) return 0;
  let addedCount = 0;
  for (const sub of recentSubmissions) {
    if (String(sub.statusDisplay || "").toLowerCase() === "accepted" && sub.titleSlug) {
      const added = await addItem(userId, {
        problemTitle: sub.title || sub.titleSlug,
        problemSlug: sub.titleSlug,
        platform: "leetcode",
        difficulty: sub.difficulty || "Medium",
        topic: sub.topic || "General",
      });
      if (added) addedCount++;
    }
  }
  return addedCount;
}

module.exports = {
  addItem,
  getTodayItems,
  getAllItems,
  recordReview,
  deleteItem,
  syncAcceptedSubmissions,
};
