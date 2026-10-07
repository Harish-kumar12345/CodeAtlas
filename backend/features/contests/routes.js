// backend/features/contests/routes.js
const express = require("express");
const service = require("./service");
const router = express.Router();

function getActiveUser(req) {
  if (req.authUser) return req.authUser;
  if (req.user) return req.user;
  return null;
}

// GET /api/contests - aggregate upcoming contests
router.get("/", async (req, res) => {
  try {
    const force = req.query.refresh === "true";
    const data = await service.getUpcomingContests(force);
    res.json(data);
  } catch (err) {
    console.error("Contests fetch error:", err);
    res.status(500).json({ error: "Failed to load upcoming contests", contests: [], notices: [err.message] });
  }
});

// GET /api/contests/:id/ics - download iCalendar event
router.get("/:id/ics", async (req, res) => {
  try {
    const data = await service.getUpcomingContests(false);
    const contest = data.contests.find((c) => c.id === req.params.id);
    if (!contest) {
      return res.status(404).json({ error: "Contest not found" });
    }
    const icsContent = service.generateIcs(contest);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${contest.id}.ics"`);
    res.send(icsContent);
  } catch (err) {
    res.status(500).json({ error: "Failed to generate .ics file" });
  }
});

// POST /api/contests/reminders - opt-in reminder
router.post("/reminders", async (req, res) => {
  const user = getActiveUser(req);
  if (!user) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to set contest reminders." });
  }
  const { contest } = req.body || {};
  if (!contest || !contest.id || !contest.name || !contest.startTime) {
    return res.status(400).json({ error: "Contest details are required" });
  }
  try {
    const result = await service.addContestReminder(user.id, user.email, contest);
    res.status(201).json(result);
  } catch (err) {
    console.error("Contest reminder error:", err);
    res.status(500).json({ error: "Failed to save contest reminder" });
  }
});

// DELETE /api/contests/reminders/:contestId
router.delete("/reminders/:contestId", async (req, res) => {
  const user = getActiveUser(req);
  if (!user) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to manage reminders." });
  }
  try {
    const deleted = await service.removeContestReminder(user.id, req.params.contestId);
    if (!deleted) return res.status(404).json({ error: "Reminder not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete reminder" });
  }
});

// GET /api/contests/reminders
router.get("/reminders", async (req, res) => {
  const user = getActiveUser(req);
  if (!user) return res.json({ reminders: [] });
  try {
    const reminders = await service.getUserReminders(user.id);
    res.json({ reminders });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reminders" });
  }
});

module.exports = router;
