// backend/features/digest/digest.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getWeekIdentifier,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildDigestHtml,
  sendDigestForUser,
  updateDigestPreferences,
  getUserPreferences,
} = require("./service");
const db = require("../db");

test("digest: getWeekIdentifier returns consistent ISO format", () => {
  const d1 = new Date("2026-10-07T12:00:00Z");
  const weekId = getWeekIdentifier(d1);
  assert.match(weekId, /^2026-W\d{2}$/);
});

test("digest: HMAC unsubscribe tokens are verifiable and reject tampering", () => {
  const userId = "user-12345-uuid";
  const token = generateUnsubscribeToken(userId);
  assert.ok(token);

  // Valid verification
  assert.equal(verifyUnsubscribeToken(userId, token), true);

  // Tampered token
  const tampered = token.slice(0, -2) + "aa";
  assert.equal(verifyUnsubscribeToken(userId, tampered), false);

  // Wrong user
  assert.equal(verifyUnsubscribeToken("another-user", token), false);
});

test("digest: buildDigestHtml generates clean HTML with required sections", () => {
  const html = buildDigestHtml({
    user: { displayName: "Alice", email: "alice@example.com" },
    weekId: "2026-W41",
    stats: { solvedThisWeek: 7, streak: 12 },
    revisionDue: [{ problem_title: "LRU Cache", difficulty: "Medium" }],
    contests: [{ platform: "LeetCode", name: "Weekly 420", startTime: "2026-10-18T02:30:00Z" }],
    unsubscribeUrl: "https://example.com/unsub",
  });

  assert.ok(html.includes("LeetMatric Weekly Digest"));
  assert.ok(html.includes("Weekly Performance"));
  assert.ok(html.includes("LRU Cache"));
  assert.ok(html.includes("Weekly 420"));
  assert.ok(html.includes("https://example.com/unsub"));
});

test("digest: sendDigestForUser sends once and enforces idempotency for the same week", async () => {
  await db.ensureInitialized();
  const testUserId = `digest-user-${Date.now()}`;
  const user = { id: testUserId, email: "test-digest@example.com" };
  const weekId = `2026-W99-test`;

  // First send
  const res1 = await sendDigestForUser(user, { weekId });
  assert.equal(res1.success, true);
  assert.equal(res1.weekId, weekId);

  // Duplicate send in same week
  const res2 = await sendDigestForUser(user, { weekId });
  assert.equal(res2.skipped, true);
  assert.equal(res2.reason, "ALREADY_SENT");
});

test("digest: user preferences can be updated and retrieved", async () => {
  await db.ensureInitialized();
  const testUserId = `pref-user-${Date.now()}`;

  const updated = await updateDigestPreferences(testUserId, true, "Asia/Kolkata");
  assert.equal(updated.digest_opt_in, true);
  assert.equal(updated.timezone, "Asia/Kolkata");

  const fetched = await getUserPreferences(testUserId);
  assert.equal(fetched.digest_opt_in, true);
  assert.equal(fetched.timezone, "Asia/Kolkata");
});
