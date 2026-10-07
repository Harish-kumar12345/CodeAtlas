// backend/features/digest/routes.js
const express = require("express");
const service = require("./service");
const db = require("../db");
const router = express.Router();

function getActiveUser(req) {
  if (req.authUser) return req.authUser;
  if (req.user) return req.user;
  return null;
}

// GET /api/digest/preferences
router.get("/preferences", async (req, res) => {
  const user = getActiveUser(req);
  if (!user) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to view preferences." });
  }
  try {
    const prefs = await service.getUserPreferences(user.id);
    res.json({ preferences: prefs });
  } catch (err) {
    res.status(500).json({ error: "Failed to load preferences" });
  }
});

// POST /api/digest/preferences
router.post("/preferences", async (req, res) => {
  const user = getActiveUser(req);
  if (!user) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in to update preferences." });
  }
  const { optIn, timezone } = req.body || {};
  try {
    const prefs = await service.updateDigestPreferences(user.id, optIn, timezone);
    res.json({ preferences: prefs });
  } catch (err) {
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

// GET /api/digest/unsubscribe - one-click unsubscribe
router.get("/unsubscribe", async (req, res) => {
  const { userId, token } = req.query;
  if (!userId || !token) {
    return res.status(400).send("Invalid unsubscribe request.");
  }
  const isValid = service.verifyUnsubscribeToken(userId, token);
  if (!isValid) {
    return res.status(403).send("Invalid or expired unsubscribe link.");
  }
  try {
    await service.updateDigestPreferences(userId, false);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unsubscribed — LeetMatric</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#080a12;color:#f3f6fb;">
        <h2>You have been unsubscribed</h2>
        <p style="color:#8d99b2;">You will no longer receive the weekly LeetMatric digest emails.</p>
        <p><a href="/" style="color:#7567f8;">Return to LeetMatric</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Unable to process unsubscribe request.");
  }
});

// POST /api/digest/cron - external cron webhook
router.post("/cron", async (req, res) => {
  const secretHeader = req.headers["x-cron-secret"];
  const expectedSecret = process.env.DIGEST_CRON_SECRET;
  if (expectedSecret && secretHeader !== expectedSecret) {
    return res.status(403).json({ error: "Invalid cron secret" });
  }

  try {
    await db.ensureInitialized();
    const optedInRows = await db.query(
      "SELECT user_id FROM user_companion_prefs WHERE digest_opt_in = 1"
    );

    const results = [];
    for (const row of optedInRows) {
      const user = { id: row.user_id, email: `user-${row.user_id}@example.com` };
      const outcome = await service.sendDigestForUser(user);
      results.push(outcome);
    }

    res.json({ processed: results.length, details: results });
  } catch (err) {
    res.status(500).json({ error: "Digest cron execution failed", details: err.message });
  }
});

module.exports = router;
