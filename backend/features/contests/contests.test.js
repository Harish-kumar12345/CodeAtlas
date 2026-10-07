// backend/features/contests/contests.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateIcs, buildGoogleCalendarUrl } = require("./adapters");
const service = require("./service");
const db = require("../db");

test("contests: generateIcs outputs valid RFC 5545 format", () => {
  const sampleContest = {
    id: "cf_1999",
    name: "Codeforces Round 999 (Div. 2)",
    platform: "Codeforces",
    url: "https://codeforces.com/contests/1999",
    startTime: "2026-10-15T14:35:00.000Z",
    durationSeconds: 7200,
    endTime: "2026-10-15T16:35:00.000Z",
  };

  const ics = generateIcs(sampleContest);
  assert.ok(ics.includes("BEGIN:VCALENDAR"));
  assert.ok(ics.includes("BEGIN:VEVENT"));
  assert.ok(ics.includes("SUMMARY:Codeforces Round 999 (Div. 2)"));
  assert.ok(ics.includes("DTSTART:20261015T143500Z"));
  assert.ok(ics.includes("DTEND:20261015T163500Z"));
  assert.ok(ics.includes("UID:Codeforces-cf_1999@leetmatric.com"));
  assert.ok(ics.includes("END:VEVENT"));
  assert.ok(ics.includes("END:VCALENDAR"));
});

test("contests: buildGoogleCalendarUrl creates valid web intent link", () => {
  const sampleContest = {
    id: "lc_biweekly-150",
    name: "Biweekly Contest 150",
    platform: "LeetCode",
    url: "https://leetcode.com/contest/biweekly-150",
    startTime: "2026-10-18T14:30:00.000Z",
    durationSeconds: 5400,
  };

  const url = buildGoogleCalendarUrl(sampleContest);
  assert.ok(url.startsWith("https://calendar.google.com/calendar/render?"));
  assert.ok(url.includes("action=TEMPLATE"));
  assert.ok(url.includes("Biweekly+Contest+150") || url.includes("Biweekly%20Contest%20150"));
});

test("contests: reminders can be registered, listed, and removed", async () => {
  await db.ensureInitialized();
  const testUserId = `test-user-${Date.now()}`;
  const testEmail = "test@example.com";
  const contest = {
    id: "cf_test_100",
    name: "Test Contest",
    platform: "Codeforces",
    startTime: "2026-11-01T12:00:00.000Z",
  };

  // Add reminder
  const res = await service.addContestReminder(testUserId, testEmail, contest);
  assert.ok(res.id);
  assert.equal(res.contestId, "cf_test_100");

  // Fetch reminders
  const list = await service.getUserReminders(testUserId);
  assert.equal(list.length, 1);
  assert.equal(list[0].contest_name, "Test Contest");

  // Remove reminder
  const removed = await service.removeContestReminder(testUserId, "cf_test_100");
  assert.equal(removed, true);

  const listAfter = await service.getUserReminders(testUserId);
  assert.equal(listAfter.length, 0);
});
