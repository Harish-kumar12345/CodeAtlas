const assert = require("node:assert/strict");
const { buildPdfReport } = require("./report");

(async () => {
  const pdf = await buildPdfReport("demo", {
    matchedUser: { profile: { ranking: 42 } },
    analytics: {
      difficulty: [
        { difficulty: "Easy", solved: 10, acceptanceRate: 50 },
        { difficulty: "Medium", solved: 5, acceptanceRate: 25 },
        { difficulty: "Hard", solved: 1, acceptanceRate: 10 },
      ],
      streaks: { current: 2, longest: 4 },
    },
  }, {
    github: { provider: "GitHub", available: true, repositories: 2, followers: 3 },
  }, []);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  console.log("report tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
