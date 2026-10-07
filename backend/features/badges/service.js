// backend/features/badges/service.js
const { evaluateBadges } = require("./rules");
const { computeProfileDerivedXP } = require("./xp");
const db = require("../db");

async function syncUserBadgesAndXP(userId, profile = {}) {
  if (!userId) return null;
  await db.ensureInitialized();

  // Get revision review count
  const revRows = await db.query(
    "SELECT COUNT(*) AS cnt FROM revision_events WHERE user_id = ?",
    [userId]
  );
  const revisionReviews = Number(revRows[0]?.cnt) || 0;

  // Get mock sessions count
  const mockRows = await db.query(
    "SELECT COUNT(*) AS cnt FROM mock_sessions WHERE user_id = ? AND status = 'completed'",
    [userId]
  );
  const mockSessions = Number(mockRows[0]?.cnt) || 0;

  const extraStats = { revisionReviews, mockSessions };

  // Evaluate badges
  const evaluated = evaluateBadges(profile, extraStats);
  const xpData = computeProfileDerivedXP(profile, extraStats);

  // Sync badges into badge_awards idempotently
  const now = new Date().toISOString();
  for (const badge of evaluated) {
    if (badge.earned) {
      const id = db.generateId();
      await db.execute(
        `INSERT OR IGNORE INTO badge_awards (id, user_id, badge_id, badge_tier, metadata, awarded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          badge.id,
          badge.tier,
          JSON.stringify({ name: badge.name, description: badge.description }),
          now,
        ]
      );
    }
  }

  // Sync XP event
  const xpEventId = `derived_total_${userId}`;
  await db.execute(
    `INSERT OR IGNORE INTO xp_events (id, user_id, source_type, source_id, xp_amount, description, created_at)
     VALUES (?, ?, 'profile_derived', ?, ?, 'Calculated total profile XP', ?)`,
    [
      db.generateId(),
      userId,
      xpEventId,
      xpData.totalXP,
      now,
    ]
  );

  return {
    userId,
    xp: xpData,
    badges: evaluated,
    earnedBadges: evaluated.filter((b) => b.earned),
    unearnedBadges: evaluated.filter((b) => !b.earned),
  };
}

async function getUserBadgesAndXP(userId, profile = {}) {
  return syncUserBadgesAndXP(userId, profile);
}

module.exports = {
  syncUserBadgesAndXP,
  getUserBadgesAndXP,
};
