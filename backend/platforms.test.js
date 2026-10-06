const assert = require("node:assert/strict");
const { combinedScore } = require("./platforms");

const score = combinedScore({
  analytics: { difficulty: [{ solved: 10 }, { solved: 20 }, { solved: 5 }] },
}, {
  codeforces: { rating: 1200 },
  codechef: { rating: null },
  github: { repositories: 10, followers: 20 },
});
assert.equal(score, 193);
console.log("platform tests passed");
