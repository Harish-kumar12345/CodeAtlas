// backend/features/badges/routes.js
const express = require("express");
const { BADGE_DEFINITIONS, evaluateBadges } = require("./rules");
const { computeProfileDerivedXP } = require("./xp");
const service = require("./service");
const router = express.Router();

function getActiveUserId(req) {
  if (req.authUser) return String(req.authUser.id);
  if (req.user) return String(req.user.id);
  return null;
}

// GET /api/badges - definitions and current user badges
router.get("/", async (req, res) => {
  const userId = getActiveUserId(req);
  if (!userId) {
    return res.json({
      definitions: BADGE_DEFINITIONS.map(({ id, name, description, tier, icon }) => ({
        id, name, description, tier, icon,
      })),
      badges: [],
      xp: null,
      guest: true,
    });
  }
  try {
    const data = await service.getUserBadgesAndXP(userId, {});
    res.json({
      definitions: BADGE_DEFINITIONS.map(({ id, name, description, tier, icon }) => ({
        id, name, description, tier, icon,
      })),
      ...data,
      guest: false,
    });
  } catch (err) {
    console.error("Badges error:", err);
    res.status(500).json({ error: "Failed to load badges" });
  }
});

// GET /api/badges/user/:username - evaluate badges for a specific username
router.get("/user/:username", async (req, res) => {
  const { username } = req.params;
  try {
    // If backend profile loader is available, load real profile; else evaluate base stats
    let profile = {};
    if (req.app.locals.loadProfile) {
      try {
        profile = await req.app.locals.loadProfile(username);
      } catch {}
    }
    const badges = evaluateBadges(profile);
    const xp = computeProfileDerivedXP(profile);
    res.json({
      username,
      xp,
      badges,
      earnedCount: badges.filter((b) => b.earned).length,
      totalCount: badges.length,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to evaluate badges for user" });
  }
});

module.exports = router;
