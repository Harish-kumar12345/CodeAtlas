// backend/features/badges/rules.js
// Deterministic badge evaluation rules

const BADGE_DEFINITIONS = [
  {
    id: "streak_7",
    name: "7-Day Momentum",
    description: "Maintained an active coding streak for 7 consecutive days.",
    tier: "bronze",
    icon: "🔥",
    check: (stats) => ({ earned: stats.streak >= 7, progress: Math.min(stats.streak, 7), target: 7 }),
  },
  {
    id: "streak_30",
    name: "Monthly Dedication",
    description: "Maintained an active coding streak for 30 consecutive days.",
    tier: "silver",
    icon: "⚡",
    check: (stats) => ({ earned: stats.streak >= 30, progress: Math.min(stats.streak, 30), target: 30 }),
  },
  {
    id: "streak_100",
    name: "Centurion Streak",
    description: "Reached an incredible 100-day active coding streak.",
    tier: "gold",
    icon: "👑",
    check: (stats) => ({ earned: stats.streak >= 100, progress: Math.min(stats.streak, 100), target: 100 }),
  },
  {
    id: "solved_50",
    name: "Problem Solver 50",
    description: "Solved at least 50 algorithmic problems.",
    tier: "bronze",
    icon: "🎯",
    check: (stats) => ({ earned: stats.totalSolved >= 50, progress: Math.min(stats.totalSolved, 50), target: 50 }),
  },
  {
    id: "solved_100",
    name: "Century Solver",
    description: "Solved at least 100 algorithmic problems.",
    tier: "silver",
    icon: "🚀",
    check: (stats) => ({ earned: stats.totalSolved >= 100, progress: Math.min(stats.totalSolved, 100), target: 100 }),
  },
  {
    id: "solved_250",
    name: "Quarter Master",
    description: "Solved at least 250 algorithmic problems.",
    tier: "gold",
    icon: "🏆",
    check: (stats) => ({ earned: stats.totalSolved >= 250, progress: Math.min(stats.totalSolved, 250), target: 250 }),
  },
  {
    id: "solved_500",
    name: "Grandmaster 500",
    description: "Solved at least 500 algorithmic problems.",
    tier: "platinum",
    icon: "💎",
    check: (stats) => ({ earned: stats.totalSolved >= 500, progress: Math.min(stats.totalSolved, 500), target: 500 }),
  },
  {
    id: "first_hard",
    name: "Peak Conqueror",
    description: "Successfully solved your first Hard difficulty problem.",
    tier: "gold",
    icon: "🏔️",
    check: (stats) => ({ earned: stats.hardSolved >= 1, progress: Math.min(stats.hardSolved, 1), target: 1 }),
  },
  {
    id: "contest_rookie",
    name: "Contest Challenger",
    description: "Participated in at least 1 competitive coding contest.",
    tier: "bronze",
    icon: "⚔️",
    check: (stats) => ({ earned: stats.contestsAttended >= 1, progress: Math.min(stats.contestsAttended, 1), target: 1 }),
  },
  {
    id: "contest_veteran",
    name: "Arena Veteran",
    description: "Competed in 5 or more rated contests.",
    tier: "silver",
    icon: "🛡️",
    check: (stats) => ({ earned: stats.contestsAttended >= 5, progress: Math.min(stats.contestsAttended, 5), target: 5 }),
  },
  {
    id: "revision_starter",
    name: "Active Recall",
    description: "Completed at least 5 spaced repetition reviews.",
    tier: "bronze",
    icon: "🧠",
    check: (stats) => ({ earned: stats.revisionReviews >= 5, progress: Math.min(stats.revisionReviews, 5), target: 5 }),
  },
  {
    id: "revision_master",
    name: "Memory Master",
    description: "Completed 25 or more spaced repetition reviews.",
    tier: "silver",
    icon: "🌟",
    check: (stats) => ({ earned: stats.revisionReviews >= 25, progress: Math.min(stats.revisionReviews, 25), target: 25 }),
  },
];

function extractProfileStats(profile = {}, extraStats = {}) {
  const submitStats = profile.submitStats || profile.matchedUser?.submitStats || {};
  const ac = submitStats.acSubmissionNum || [];
  const easySolved = Number(ac[1]?.count) || 0;
  const mediumSolved = Number(ac[2]?.count) || 0;
  const hardSolved = Number(ac[3]?.count) || 0;
  const totalSolved = Number(ac[0]?.count) || (easySolved + mediumSolved + hardSolved);

  const streak = Number(profile.analytics?.streaks?.current) || 0;
  const contestsAttended = Number(profile.analytics?.contests?.contestsAttended) || 0;
  const revisionReviews = Number(extraStats.revisionReviews) || 0;

  return {
    totalSolved,
    easySolved,
    mediumSolved,
    hardSolved,
    streak,
    contestsAttended,
    revisionReviews,
  };
}

function evaluateBadges(profile = {}, extraStats = {}) {
  const stats = extractProfileStats(profile, extraStats);
  return BADGE_DEFINITIONS.map((def) => {
    const outcome = def.check(stats);
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      tier: def.tier,
      icon: def.icon,
      earned: Boolean(outcome.earned),
      progress: outcome.progress,
      target: outcome.target,
    };
  });
}

module.exports = {
  BADGE_DEFINITIONS,
  extractProfileStats,
  evaluateBadges,
};
