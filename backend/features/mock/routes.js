// backend/features/mock/routes.js
const express = require("express");
const service = require("./service");
const router = express.Router();

function getActiveUserId(req) {
  if (req.authUser) return String(req.authUser.id);
  if (req.user) return String(req.user.id);
  return null;
}

// POST /api/mock/sessions - start new mock session
router.post("/sessions", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to start a mock interview session." });
  }
  const { durationMinutes, targetDifficulty, targetTopics } = req.body || {};
  try {
    const session = await service.startSession(userId, {
      durationMinutes,
      targetDifficulty,
      targetTopics,
    });
    res.status(201).json({ session });
  } catch (err) {
    console.error("Mock start error:", err);
    res.status(500).json({ error: "Failed to initialize mock interview" });
  }
});

// GET /api/mock/sessions/:id - retrieve live session state
router.get("/sessions/:id", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to view this session." });
  }
  try {
    const session = await service.getSession(userId, req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: "Failed to load session" });
  }
});

// PATCH /api/mock/sessions/:id/problems/:problemSlug - update problem status
router.patch("/sessions/:id/problems/:problemSlug", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to update problem status." });
  }
  const { status, timeSpentSeconds } = req.body || {};
  try {
    const updated = await service.updateProblemStatus(userId, req.params.id, req.params.problemSlug, {
      status,
      timeSpentSeconds,
    });
    if (!updated) return res.status(404).json({ error: "Session or problem not found" });
    res.json({ session: updated });
  } catch (err) {
    res.status(500).json({ error: "Failed to update problem" });
  }
});

// POST /api/mock/sessions/:id/finish - finish session and get report
router.post("/sessions/:id/finish", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to finish session." });
  }
  try {
    const session = await service.finishSession(userId, req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: "Failed to finish session" });
  }
});

// GET /api/mock/history - session history
router.get("/history", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) return res.json({ history: [] });
  try {
    const history = await service.getSessionHistory(userId);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: "Failed to load history" });
  }
});

module.exports = router;
