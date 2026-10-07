// backend/features/mock/mock.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("./service");
const db = require("../db");

test("mock: selectMockProblems returns 2 appropriate problems", () => {
  const problems = service.selectMockProblems("Easy", ["Array"]);
  assert.equal(problems.length, 2);
  assert.equal(problems[0].difficulty, "Easy");
  assert.equal(problems[1].difficulty, "Easy");
});

test("mock: full session lifecycle and timer persistence", async () => {
  await db.ensureInitialized();
  const testUserId = `mock-user-${Date.now()}`;

  // Start session
  const session = await service.startSession(testUserId, {
    durationMinutes: 45,
    targetDifficulty: "Medium",
    targetTopics: ["Dynamic Programming"],
  });

  assert.ok(session.id);
  assert.equal(session.status, "active");
  assert.equal(session.problems.length, 2);
  assert.ok(session.timer.remainingSeconds <= 45 * 60);
  assert.ok(session.timer.remainingSeconds > 44 * 60);

  // Update first problem to solved
  const slug1 = session.problems[0].problem_slug;
  const updated = await service.updateProblemStatus(testUserId, session.id, slug1, {
    status: "solved",
    timeSpentSeconds: 1200,
  });

  const p1 = updated.problems.find((p) => p.problem_slug === slug1);
  assert.equal(p1.status, "solved");
  assert.equal(p1.time_spent_seconds, 1200);

  // Finish session
  const finished = await service.finishSession(testUserId, session.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.score, 50); // 1 out of 2 solved = 50%
  assert.ok(finished.ai_feedback);

  // Check history
  const history = await service.getSessionHistory(testUserId);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, session.id);
});
