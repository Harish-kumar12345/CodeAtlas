// backend/features/badges/xp.js
// XP formula and Level curve calculations

const XP_VALUES = {
  EASY_PROBLEM: 10,
  MEDIUM_PROBLEM: 25,
  HARD_PROBLEM: 50,
  STREAK_DAY: 15,
  CONTEST_ATTENDED: 100,
  REVISION_COMPLETED: 10,
  MOCK_SESSION_FINISHED: 75,
};

/**
 * Calculates current level from total XP.
 * Curve: Level = floor(1 + sqrt(XP / 100))
 * Level 1: 0 XP
 * Level 2: 100 XP
 * Level 3: 400 XP
 * Level 4: 900 XP
 * Level 5: 1600 XP
 * Level 10: 8100 XP
 */
function calculateLevel(totalXP) {
  const xp = Math.max(0, Number(totalXP) || 0);
  return Math.floor(1 + Math.sqrt(xp / 100));
}

/**
 * Calculates the minimum XP required to reach a specific level.
 */
function xpForLevel(level) {
  const lvl = Math.max(1, Number(level) || 1);
  return 100 * Math.pow(lvl - 1, 2);
}

/**
 * Detailed level progress breakdown.
 */
function levelProgress(totalXP) {
  const xp = Math.max(0, Number(totalXP) || 0);
  const level = calculateLevel(xp);
  const currentBase = xpForLevel(level);
  const nextTarget = xpForLevel(level + 1);
  const range = nextTarget - currentBase;
  const inLevel = xp - currentBase;
  const percentage = range > 0 ? Math.min(100, Math.floor((inLevel / range) * 100)) : 100;

  return {
    level,
    totalXP: xp,
    currentLevelBaseXP: currentBase,
    nextLevelTargetXP: nextTarget,
    xpIntoLevel: inLevel,
    xpNeededForNextLevel: nextTarget - xp,
    percentage,
  };
}

/**
 * Deterministically computes XP from profile metrics.
 */
function computeProfileDerivedXP(profile = {}, extraStats = {}) {
  const submitStats = profile.submitStats || profile.matchedUser?.submitStats || {};
  const ac = submitStats.acSubmissionNum || [];
  const easy = Number(ac[1]?.count) || 0;
  const medium = Number(ac[2]?.count) || 0;
  const hard = Number(ac[3]?.count) || 0;

  const currentStreak = Number(profile.analytics?.streaks?.current) || 0;
  const contestsAttended = Number(profile.analytics?.contests?.contestsAttended) || 0;
  const revisionCount = Number(extraStats.revisionReviews) || 0;
  const mockCount = Number(extraStats.mockSessions) || 0;

  let totalXP = 0;
  totalXP += easy * XP_VALUES.EASY_PROBLEM;
  totalXP += medium * XP_VALUES.MEDIUM_PROBLEM;
  totalXP += hard * XP_VALUES.HARD_PROBLEM;
  totalXP += currentStreak * XP_VALUES.STREAK_DAY;
  totalXP += contestsAttended * XP_VALUES.CONTEST_ATTENDED;
  totalXP += revisionCount * XP_VALUES.REVISION_COMPLETED;
  totalXP += mockCount * XP_VALUES.MOCK_SESSION_FINISHED;

  return {
    totalXP,
    breakdown: {
      easyXP: easy * XP_VALUES.EASY_PROBLEM,
      mediumXP: medium * XP_VALUES.MEDIUM_PROBLEM,
      hardXP: hard * XP_VALUES.HARD_PROBLEM,
      streakXP: currentStreak * XP_VALUES.STREAK_DAY,
      contestXP: contestsAttended * XP_VALUES.CONTEST_ATTENDED,
      revisionXP: revisionCount * XP_VALUES.REVISION_COMPLETED,
      mockXP: mockCount * XP_VALUES.MOCK_SESSION_FINISHED,
    },
    ...levelProgress(totalXP),
  };
}

module.exports = {
  XP_VALUES,
  calculateLevel,
  xpForLevel,
  levelProgress,
  computeProfileDerivedXP,
};
