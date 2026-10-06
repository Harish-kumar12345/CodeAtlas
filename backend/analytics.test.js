const assert = require("node:assert/strict");
const {
  buildHeatmap,
  calcStreaks,
  contestSummary,
  difficultySummary,
  findWeakTopics,
  getTopicStats,
} = require("./analytics");

const now = new Date();
now.setHours(0, 0, 0, 0);
const day = (offset) => Math.floor(Date.UTC(
  now.getFullYear(),
  now.getMonth(),
  now.getDate() + offset,
) / 1000);
const calendar = JSON.stringify({ [day(-2)]: 2, [day(-1)]: 4, [day(0)]: 1, [day(-4)]: 10 });

assert.equal(buildHeatmap(calendar, 5).filter((entry) => entry.count > 0).length, 4);
assert.deepEqual(calcStreaks(calendar), { current: 3, longest: 3, totalActiveDays: 4 });
assert.deepEqual(findWeakTopics(getTopicStats("demo", {
  fundamental: [{ tagName: "Arrays", problemsSolved: 20 }],
  advanced: [{ tagName: "Graphs", problemsSolved: 2 }],
})), ["Graphs", "Arrays"]);
assert.equal(difficultySummary(
  [{ count: 100 }, { count: 10 }, { count: 20 }, { count: 5 }],
  [{ count: 0 }, { count: 2 }, { count: 3 }, { count: 1 }],
  [{ submissions: 0 }, { submissions: 4 }, { submissions: 6 }, { submissions: 2 }],
  [{ submissions: 0 }, { submissions: 8 }, { submissions: 12 }, { submissions: 4 }],
)[0].acceptanceRate, 50);
assert.deepEqual(contestSummary([
  { attended: true, rating: 1200, ranking: 20, contest: { title: "One", startTime: 1 } },
  { attended: true, rating: 1300, ranking: 10, contest: { title: "Two", startTime: 2 } },
]), {
  contestsAttended: 2,
  bestRank: 10,
  biggestRatingGain: 100,
  biggestRatingDrop: 0,
  history: [
    { title: "One", rating: 1200, rank: 20, attendedAt: 1, ratingChange: 0 },
    { title: "Two", rating: 1300, rank: 10, attendedAt: 2, ratingChange: 100 },
  ],
});

console.log("analytics tests passed");
