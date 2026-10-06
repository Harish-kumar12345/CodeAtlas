const DIFFICULTIES = ["Easy", "Medium", "Hard"];

function getTopicStats(username, tagProblemCounts = {}) {
  return Object.values(tagProblemCounts)
    .flatMap((group) => Array.isArray(group) ? group : [])
    .filter((topic) => topic && topic.tagName)
    .map((topic) => ({
      topic: topic.tagName,
      solved: Number(topic.problemsSolved) || 0,
    }))
    .sort((a, b) => b.solved - a.solved || a.topic.localeCompare(b.topic))
    .map((topic) => ({ ...topic, username }));
}

function findWeakTopics(stats, limit = 5) {
  return stats
    .filter((topic) => topic.solved >= 0)
    .sort((a, b) => a.solved - b.solved || a.topic.localeCompare(b.topic))
    .slice(0, limit)
    .map((topic) => topic.topic);
}

function parseCalendar(calendar) {
  if (!calendar) return {};
  if (typeof calendar === "object") return calendar;
  try {
    return JSON.parse(calendar);
  } catch {
    return {};
  }
}

function buildHeatmap(calendar, days = 182) {
  const entries = parseCalendar(calendar);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - days + 1);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const timestamp = Math.floor(Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ) / 1000);
    const count = Number(entries[timestamp] || entries[String(timestamp)] || 0);
    return {
      date: date.toISOString().slice(0, 10),
      count,
      level: count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4,
    };
  });
}

function calcStreaks(calendar) {
  const days = buildHeatmap(calendar, 366);
  let current = 0;
  let longest = 0;
  let run = 0;
  for (const day of days) {
    if (day.count > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  for (let i = days.length - 1; i >= 0 && days[i].count > 0; i -= 1) current += 1;
  return { current, longest, totalActiveDays: days.filter((day) => day.count > 0).length };
}

function normalizeContestHistory(history = []) {
  return history
    .filter((entry) => entry && entry.attended && entry.contest)
    .map((entry) => ({
      title: entry.contest.title,
      rating: Number(entry.rating) || 0,
      rank: Number(entry.ranking) || null,
      attendedAt: Number(entry.contest.startTime) || null,
    }))
    .sort((a, b) => (a.attendedAt || 0) - (b.attendedAt || 0))
    .map((entry, index, all) => ({
      ...entry,
      ratingChange: index === 0 ? 0 : entry.rating - all[index - 1].rating,
    }));
}

function contestSummary(history) {
  const contests = normalizeContestHistory(history);
  return {
    contestsAttended: contests.length,
    bestRank: contests.reduce((best, contest) => (
      contest.rank && (!best || contest.rank < best) ? contest.rank : best
    ), null),
    biggestRatingGain: contests.reduce((best, contest) => Math.max(best, contest.ratingChange), 0),
    biggestRatingDrop: contests.reduce((drop, contest) => Math.min(drop, contest.ratingChange), 0),
    history: contests,
  };
}

function difficultySummary(allQuestionsCount = [], solvedCounts = [], acceptedSubmissions = [], submissions = []) {
  return DIFFICULTIES.map((difficulty, index) => {
    const total = Number(allQuestionsCount[index + 1]?.count) || 0;
    const solved = Number(solvedCounts[index + 1]?.count) || 0;
    const submissionCount = Number(submissions[index + 1]?.submissions) || 0;
    const acceptedCount = Number(acceptedSubmissions[index + 1]?.submissions) || 0;
    return {
      difficulty,
      total,
      solved,
      submissions: submissionCount,
      acceptanceRate: submissionCount ? Number(((acceptedCount / submissionCount) * 100).toFixed(1)) : 0,
    };
  });
}

module.exports = {
  buildHeatmap,
  calcStreaks,
  contestSummary,
  difficultySummary,
  findWeakTopics,
  getTopicStats,
  normalizeContestHistory,
};
