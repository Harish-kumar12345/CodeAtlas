// backend/features/badges/badges.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateLevel, xpForLevel, levelProgress, computeProfileDerivedXP } = require("./xp");
const { evaluateBadges } = require("./rules");
const service = require("./service");
const db = require("../db");

test("badges: level curve maps XP deterministically", () => {
  assert.equal(calculateLevel(0), 1);
  assert.equal(calculateLevel(50), 1);
  assert.equal(calculateLevel(99), 1);
  assert.equal(calculateLevel(100), 2);
  assert.equal(calculateLevel(399), 2);
  assert.equal(calculateLevel(400), 3);
  assert.equal(calculateLevel(900), 4);
  assert.equal(calculateLevel(1600), 5);
});

test("badges: xpForLevel is the mathematical inverse of level boundaries", () => {
  for (let lvl = 1; lvl <= 10; lvl++) {
    const requiredXP = xpForLevel(lvl);
    assert.equal(calculateLevel(requiredXP), lvl);
  }
});

test("badges: levelProgress calculates accurate percentages", () => {
  // At level 2 (100 to 400 XP, range is 300)
  // At 250 XP, inLevel is 150 -> 50%
  const prog = levelProgress(250);
  assert.equal(prog.level, 2);
  assert.equal(prog.percentage, 50);
  assert.equal(prog.xpNeededForNextLevel, 150);
});

test("badges: rule evaluations accurately reflect profile milestones", () => {
  const profileLow = {
    submitStats: {
      acSubmissionNum: [{ count: 10 }, { count: 10 }, { count: 0 }, { count: 0 }],
    },
    analytics: { streaks: { current: 3 }, contests: { contestsAttended: 0 } },
  };

  const badgesLow = evaluateBadges(profileLow);
  const earnedLow = badgesLow.filter((b) => b.earned).map((b) => b.id);
  assert.deepEqual(earnedLow, []); // none earned yet

  const profileHigh = {
    submitStats: {
      acSubmissionNum: [{ count: 65 }, { count: 40 }, { count: 24 }, { count: 1 }],
    },
    analytics: { streaks: { current: 8 }, contests: { contestsAttended: 2 } },
  };

  const badgesHigh = evaluateBadges(profileHigh, { revisionReviews: 6 });
  const earnedHigh = badgesHigh.filter((b) => b.earned).map((b) => b.id);

  assert.ok(earnedHigh.includes("streak_7"));
  assert.ok(earnedHigh.includes("solved_50"));
  assert.ok(earnedHigh.includes("first_hard"));
  assert.ok(earnedHigh.includes("contest_rookie"));
  assert.ok(earnedHigh.includes("revision_starter"));
  assert.ok(!earnedHigh.includes("streak_30")); // not yet 30
});

test("badges: database awards and XP sync are idempotent", async () => {
  await db.ensureInitialized();
  const testUserId = `badge-user-${Date.now()}`;
  const profile = {
    submitStats: {
      acSubmissionNum: [{ count: 55 }, { count: 50 }, { count: 4 }, { count: 1 }],
    },
    analytics: { streaks: { current: 10 } },
  };

  // First sync
  const res1 = await service.syncUserBadgesAndXP(testUserId, profile);
  assert.ok(res1.earnedBadges.length > 0);

  // Second sync (incremental identical profile)
  const res2 = await service.syncUserBadgesAndXP(testUserId, profile);
  assert.equal(res1.earnedBadges.length, res2.earnedBadges.length);
  assert.equal(res1.xp.totalXP, res2.xp.totalXP);
});
