// backend/features/contests/service.js
const {
  fetchCodeforcesContests,
  fetchLeetCodeContests,
  fetchCodeChefContests,
  generateIcs,
  buildGoogleCalendarUrl,
} = require("./adapters");
const db = require("../db");

let cachedContests = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 45 * 60 * 1000; // 45 minutes

async function getUpcomingContests(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedContests && now < cacheExpiresAt) {
    return cachedContests;
  }

  const [cfRes, lcRes, ccRes] = await Promise.allSettled([
    fetchCodeforcesContests(),
    fetchLeetCodeContests(),
    fetchCodeChefContests(),
  ]);

  const allContests = [];
  const notices = [];

  // Codeforces
  if (cfRes.status === "fulfilled") {
    if (cfRes.value.error) notices.push(`Codeforces: ${cfRes.value.error}`);
    else if (Array.isArray(cfRes.value)) allContests.push(...cfRes.value);
  } else {
    notices.push("Codeforces: Upstream connection failed");
  }

  // LeetCode
  if (lcRes.status === "fulfilled") {
    if (lcRes.value.error) notices.push(`LeetCode: ${lcRes.value.error}`);
    else if (Array.isArray(lcRes.value)) allContests.push(...lcRes.value);
  } else {
    notices.push("LeetCode: Upstream connection failed");
  }

  // CodeChef
  if (ccRes.status === "fulfilled") {
    if (ccRes.value.error) notices.push(`CodeChef: ${ccRes.value.error}`);
    else if (Array.isArray(ccRes.value)) allContests.push(...ccRes.value);
  } else {
    notices.push("CodeChef: Upstream connection failed");
  }

  // Sort chronologically
  allContests.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  // Attach Google Calendar URLs
  const enriched = allContests.map((c) => ({
    ...c,
    googleCalendarUrl: buildGoogleCalendarUrl(c),
  }));

  const result = {
    contests: enriched,
    notices,
    cachedAt: new Date().toISOString(),
  };

  cachedContests = result;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return result;
}

async function addContestReminder(userId, email, contest) {
  if (!userId || !email || !contest || !contest.id) {
    throw new Error("userId, email, and contest details are required");
  }
  const id = db.generateId();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT OR REPLACE INTO contest_reminders (
      id, user_id, email, contest_id, platform, contest_name, start_time, reminded_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      id,
      userId,
      email,
      contest.id,
      contest.platform,
      contest.name,
      contest.startTime,
      now,
    ]
  );

  return { id, contestId: contest.id, registered: true };
}

async function removeContestReminder(userId, contestId) {
  const res = await db.execute(
    "DELETE FROM contest_reminders WHERE user_id = ? AND contest_id = ?",
    [userId, contestId]
  );
  return res.changes > 0;
}

async function getUserReminders(userId) {
  if (!userId) return [];
  return db.query("SELECT * FROM contest_reminders WHERE user_id = ?", [userId]);
}

module.exports = {
  getUpcomingContests,
  generateIcs,
  addContestReminder,
  removeContestReminder,
  getUserReminders,
};
