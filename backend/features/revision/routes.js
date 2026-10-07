// backend/features/revision/routes.js
const express = require("express");
const service = require("./service");
const router = express.Router();

function getActiveUserId(req) {
  if (req.authUser && req.authUser.id) return String(req.authUser.id);
  if (req.user && req.user.id) return String(req.user.id);
  return null;
}

// GET /api/revision - list due items and all items
router.get("/", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.json({ items: [], todayItems: [], todayCount: 0, guest: true });
  }
  try {
    const todayStr = (req.query.date || new Date().toISOString().slice(0, 10));
    const [todayItems, allItems] = await Promise.all([
      service.getTodayItems(userId, todayStr),
      service.getAllItems(userId),
    ]);
    res.json({
      items: allItems,
      todayItems,
      todayCount: todayItems.length,
      guest: false,
    });
  } catch (error) {
    console.error("Revision fetch error:", error);
    res.status(500).json({ error: "Unable to load revision list" });
  }
});

// POST /api/revision - add problem manually
router.post("/", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to track revision items." });
  }
  const { problemTitle, problemSlug, platform, difficulty, topic } = req.body || {};
  if (!problemSlug) {
    return res.status(400).json({ error: "problemSlug is required" });
  }
  try {
    const item = await service.addItem(userId, {
      problemTitle: problemTitle || problemSlug,
      problemSlug,
      platform: platform || "leetcode",
      difficulty: difficulty || "Medium",
      topic: topic || "General",
    });
    res.status(201).json({ item });
  } catch (error) {
    console.error("Revision add error:", error);
    res.status(500).json({ error: "Failed to add revision item" });
  }
});

// POST /api/revision/:id/review - mark reviewed with rating
router.post("/:id/review", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to review items." });
  }
  const { recallRating, today } = req.body || {};
  if (!["easy", "medium", "hard"].includes(String(recallRating).toLowerCase())) {
    return res.status(400).json({ error: "recallRating must be 'easy', 'medium', or 'hard'" });
  }
  try {
    const updated = await service.recordReview(userId, req.params.id, recallRating, today);
    if (!updated) {
      return res.status(404).json({ error: "Revision item not found" });
    }
    res.json({ item: updated });
  } catch (error) {
    console.error("Revision review error:", error);
    res.status(500).json({ error: "Failed to record review" });
  }
});

// DELETE /api/revision/:id
router.delete("/:id", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to manage items." });
  }
  try {
    const deleted = await service.deleteItem(userId, req.params.id);
    if (!deleted) return res.status(404).json({ error: "Item not found" });
    res.status(204).send();
  } catch (error) {
    console.error("Revision delete error:", error);
    res.status(500).json({ error: "Failed to delete item" });
  }
});

module.exports = router;
