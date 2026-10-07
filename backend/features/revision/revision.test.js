// backend/features/revision/revision.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { next_review, DEFAULT_EASE_FACTOR, MIN_EASE_FACTOR } = require("./algorithm");
const service = require("./service");
const db = require("../db");

test("revision: algorithm calculates initial step on fresh item", () => {
  const state = { interval_days: 1, repetitions: 0, ease_factor: 2.5 };
  const res = next_review(state, "medium", "2026-10-07");
  assert.equal(res.interval_days, 3);
  assert.equal(res.repetitions, 1);
  assert.equal(res.ease_factor, 2.5);
  assert.equal(res.next_review_date, "2026-10-10");
});

test("revision: hard rating resets interval to 1 day and decreases ease factor", () => {
  const state = { interval_days: 14, repetitions: 3, ease_factor: 2.5 };
  const res = next_review(state, "hard", "2026-10-07");
  assert.equal(res.interval_days, 1);
  assert.equal(res.repetitions, 0);
  assert.equal(res.ease_factor, 2.3);
  assert.equal(res.next_review_date, "2026-10-08");
});

test("revision: hard rating respects minimum ease factor", () => {
  const state = { interval_days: 7, repetitions: 2, ease_factor: 1.35 };
  const res = next_review(state, "hard", "2026-10-07");
  assert.equal(res.ease_factor, MIN_EASE_FACTOR);
});

test("revision: easy rating accelerates intervals and boosts ease factor", () => {
  const state = { interval_days: 7, repetitions: 2, ease_factor: 2.5 };
  const res = next_review(state, "easy", "2026-10-07");
  assert.equal(res.interval_days, 14);
  assert.equal(res.repetitions, 3);
  assert.equal(res.ease_factor, 2.65);
  assert.equal(res.next_review_date, "2026-10-21");
});

test("revision: handles month-end and leap-year day boundary calculations safely", () => {
  // End of year transition
  const resDec = next_review({ interval_days: 1, repetitions: 0, ease_factor: 2.5 }, "medium", "2026-12-30");
  assert.equal(resDec.next_review_date, "2027-01-02");

  // Leap year boundary (2028 is a leap year)
  const resLeap = next_review({ interval_days: 1, repetitions: 0, ease_factor: 2.5 }, "medium", "2028-02-27");
  assert.equal(resLeap.next_review_date, "2028-03-01");
});

test("revision: handles empty or null state without throwing", () => {
  const res = next_review(null, null, null);
  assert.ok(res.next_review_date);
  assert.equal(res.interval_days, 3);
  assert.equal(res.repetitions, 1);
});

test("revision: service adds items and rejects duplicates idempotently", async () => {
  await db.ensureInitialized();
  const testUserId = `test-user-${Date.now()}`;
  const item1 = await service.addItem(testUserId, {
    problemTitle: "Two Sum",
    problemSlug: "two-sum",
    platform: "leetcode",
    difficulty: "Easy",
    topic: "Array",
  });

  assert.ok(item1.id);
  assert.equal(item1.problem_slug, "two-sum");

  // Attempt duplicate addition
  const itemDuplicate = await service.addItem(testUserId, {
    problemTitle: "Two Sum",
    problemSlug: "two-sum",
    platform: "leetcode",
  });
  assert.equal(itemDuplicate.id, item1.id);

  // Retrieve today items
  const todayItems = await service.getTodayItems(testUserId);
  assert.equal(todayItems.length, 1);
  assert.equal(todayItems[0].problem_slug, "two-sum");

  // Review item
  const updated = await service.recordReview(testUserId, item1.id, "easy", "2026-10-07");
  assert.equal(updated.repetitions, 1);
  assert.equal(updated.interval_days, 3);

  // Clean up
  await service.deleteItem(testUserId, item1.id);
  const remaining = await service.getAllItems(testUserId);
  assert.equal(remaining.length, 0);
});
