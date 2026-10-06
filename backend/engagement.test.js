const assert = require("node:assert/strict");
const { buildRuleBasedPlan, recommendProblems, validateStudyPlan } = require("./engagement");

const results = recommendProblems(["Graph"], [{ difficulty: "Easy", solved: 1 }, { difficulty: "Medium", solved: 3 }], [{ titleSlug: "number-of-islands", statusDisplay: "Accepted" }]);
assert.ok(results.length > 0);
assert.equal(results.some((problem) => problem.slug === "number-of-islands"), false);
assert.equal(results[0].url.startsWith("https://leetcode.com/problems/"), true);
const filtered = recommendProblems(["Arrays"], [{ difficulty: "Easy", solved: 1 }], [
  { titleSlug: "contains-duplicate", statusDisplay: "Accepted" },
  { titleSlug: "two-sum", statusDisplay: "Wrong Answer" },
]);
assert.equal(filtered.some((problem) => problem.slug === "contains-duplicate"), false);
assert.equal(filtered.some((problem) => problem.slug === "two-sum"), true);
const fallback = buildRuleBasedPlan({ analytics: { weakTopics: ["Graph"] } }, results);
assert.equal(fallback.days.length, 7);
assert.equal(validateStudyPlan(fallback).days.length, 7);
assert.equal(validateStudyPlan({ days: [] }), null);
console.log("engagement tests passed");
