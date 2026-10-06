const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempPath = path.join(os.tmpdir(), `leetmatric-test-${Date.now()}.sqlite`);
process.env.DB_PATH = tempPath;
const { closeDatabase, getProgressHistory, saveSnapshot } = require("./database");

(async () => {
  const profile = {
    matchedUser: {},
    analytics: {
      difficulty: [{ solved: 3 }, { solved: 4 }, { solved: 5 }],
      contestRanking: { rating: 1200 },
    },
  };
  await saveSnapshot("Tester", profile);
  const history = await getProgressHistory("tester", 30);
  assert.equal(history.length, 1);
  assert.equal(history[0].totalSolved, 12);
  assert.equal(history[0].contestRating, 1200);
  await closeDatabase();
  fs.rmSync(tempPath, { force: true });
  console.log("database tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
