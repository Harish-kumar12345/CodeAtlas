// backend/features/hints/routes.js
const express = require("express");
const service = require("./service");
const router = express.Router();

function getActiveUserId(req) {
  if (req.authUser) return String(req.authUser.id);
  if (req.user) return String(req.user.id);
  return null;
}

// POST /api/hints - request progressive hint
router.post("/", async (req, res) => {
  const userId = getActiveUserId(req);
  const { problemSlug, problemTitle, level } = req.body || {};

  if (!problemSlug) {
    return res.status(400).json({ error: "problemSlug is required" });
  }

  try {
    const result = await service.getHint(userId, {
      problemSlug,
      problemTitle,
      level,
    });

    if (result.error === "DAILY_LIMIT_REACHED") {
      return res.status(429).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error("Hint route error:", err);
    res.status(500).json({ error: "Failed to generate hint" });
  }
});

module.exports = router;
