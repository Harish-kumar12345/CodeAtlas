// backend/features/notes/routes.js
const express = require("express");
const service = require("./service");
const router = express.Router();

function getActiveUserId(req) {
  if (req.authUser) return String(req.authUser.id);
  if (req.user) return String(req.user.id);
  return null;
}

// GET /api/notes
router.get("/", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to view your notes." });
  }
  try {
    const notes = await service.getNotes(userId, {
      tag: req.query.tag,
      favouriteOnly: req.query.favouriteOnly === "true",
      query: req.query.query,
    });
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: "Failed to load notes" });
  }
});

// GET /api/notes/:platform/:problemSlug
router.get("/:platform/:problemSlug", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to view note." });
  }
  try {
    const note = await service.getNote(userId, req.params.platform, req.params.problemSlug);
    res.json({ note });
  } catch (err) {
    res.status(500).json({ error: "Failed to load note" });
  }
});

// POST /api/notes - save or update note
router.post("/", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to save notes." });
  }
  const { platform, problemSlug, problemTitle, noteMarkdown, tags, isFavourite, addToRevision } = req.body || {};
  if (!problemSlug) {
    return res.status(400).json({ error: "problemSlug is required" });
  }
  try {
    const note = await service.saveNote(userId, {
      platform,
      problemSlug,
      problemTitle,
      noteMarkdown,
      tags,
      isFavourite,
      addToRevision,
    });
    res.status(200).json({ note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/notes/:id
router.delete("/:id", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to delete note." });
  }
  try {
    const deleted = await service.deleteNote(userId, req.params.id);
    if (!deleted) return res.status(404).json({ error: "Note not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete note" });
  }
});

module.exports = router;
