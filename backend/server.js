const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const rateLimit = require("express-rate-limit");
const { TtlCache } = require("./cache");
const {
  addGroupMember,
  getGoal,
  getGroupMembers,
  getProgressHistory,
  saveGoal,
  saveSnapshot,
} = require("./database");
const { renderStatsCard } = require("./cards");
const { createStudyPlan, recommendProblems } = require("./engagement");
const {
  combinedScore,
  getCodeChef,
  getCodeforces,
  getGitHub,
  getPlatformProfiles,
} = require("./platforms");
const { buildPdfReport } = require("./report");
const {
  buildHeatmap,
  calcStreaks,
  contestSummary,
  difficultySummary,
  findWeakTopics,
  getTopicStats,
} = require("./analytics");

const app = express();
const PORT = process.env.PORT || 3000;
const profileCache = new TtlCache();
const endpointCache = new TtlCache();

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static("../frontend/public"));

// Rate limiter: max 30 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    error: "Rate limit exceeded",
    message: "Too many requests. Please wait a minute and try again.",
  }),
});
app.use("/api/", limiter);

// ── GraphQL Queries ──────────────────────────────────────────────────────────
const LEETCODE_URL = "https://leetcode.com/graphql/";

const STATS_QUERY = `
  query userSessionProgress($username: String!) {
    allQuestionsCount { difficulty count }
    matchedUser(username: $username) {
      profile { realName userAvatar ranking }
      submitStats {
        acSubmissionNum { difficulty count submissions }
        totalSubmissionNum { difficulty count submissions }
      }
      tagProblemCounts {
        fundamental { tagName problemsSolved }
        intermediate { tagName problemsSolved }
        advanced { tagName problemsSolved }
      }
    }
  }
`;

const CONTEST_QUERY = `
  query userContestRankingInfo($username: String!) {
    userContestRanking(username: $username) {
      attendedContestsCount
      rating
      globalRanking
      totalParticipants
      topPercentage
    }
    userContestRankingHistory(username: $username) {
      attended
      rating
      ranking
      contest { title startTime }
    }
  }
`;

const RECENT_QUERY = `
  query recentSubmissions($username: String!) {
    recentSubmissionList(username: $username, limit: 8) {
      title
      titleSlug
      timestamp
      statusDisplay
      lang
    }
  }
`;

const CALENDAR_QUERY = `
  query userProfileCalendar($username: String!) {
    matchedUser(username: $username) {
      userCalendar {
        streak
        totalActiveDays
        submissionCalendar
      }
    }
  }
`;

// ── Helper ───────────────────────────────────────────────────────────────────
async function leetcodeQuery(query, variables) {
  let res;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    res = await fetch(LEETCODE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Referer": "https://leetcode.com",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (error) {
    error.code = error.name === "AbortError" ? "LEETCODE_TIMEOUT" : "LEETCODE_UNAVAILABLE";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const error = new Error(`LeetCode returned ${res.status}`);
    error.code = res.status === 429 ? "LEETCODE_RATE_LIMITED" : "LEETCODE_UNAVAILABLE";
    throw error;
  }
  const payload = await res.json();
  if (payload.errors?.length) {
    const error = new Error(payload.errors[0].message || "LeetCode query failed");
    error.code = "LEETCODE_UNAVAILABLE";
    throw error;
  }
  return payload;
}

function cachedResponse(cache, key) {
  const value = cache.get(key);
  return value === undefined ? null : value;
}

function sendUpstreamError(res, error) {
  console.error(error);
  if (error.code === "LEETCODE_RATE_LIMITED") {
    return res.status(503).json({
      error: "LeetCode is rate limiting requests",
      message: "LeetCode is temporarily limiting requests. Please try again shortly.",
    });
  }
  if (error.code === "LEETCODE_TIMEOUT") {
    return res.status(504).json({
      error: "LeetCode request timed out",
      message: "LeetCode is taking too long to respond. Please try again shortly.",
    });
  }
  return res.status(502).json({
    error: "LeetCode is unavailable",
    message: "LeetCode could not be reached. Please try again shortly.",
  });
}

async function loadProfile(username) {
  const cacheKey = username.toLowerCase();
  const cached = cachedResponse(profileCache, cacheKey);
  if (cached) return cached;
  const data = await leetcodeQuery(STATS_QUERY, { username });
  if (!data?.data?.matchedUser) {
    const error = new Error("User not found");
    error.code = "USER_NOT_FOUND";
    throw error;
  }
  const user = data.data.matchedUser;
  const topics = getTopicStats(username, user.tagProblemCounts);
  const calendarData = await leetcodeQuery(CALENDAR_QUERY, { username });
  const calendar = calendarData?.data?.matchedUser?.userCalendar;
  const contestData = await leetcodeQuery(CONTEST_QUERY, { username });
  const calendarJson = calendar?.submissionCalendar || "{}";
  const response = {
    ...data.data,
    analytics: {
      difficulty: difficultySummary(
        data.data.allQuestionsCount,
        user.submitStats.acSubmissionNum,
        user.submitStats.acSubmissionNum,
        user.submitStats.totalSubmissionNum,
      ),
      topics,
      weakTopics: findWeakTopics(topics),
      heatmap: buildHeatmap(calendarJson),
      streaks: calcStreaks(calendarJson),
      contests: contestSummary(contestData?.data?.userContestRankingHistory),
      contestRanking: contestData?.data?.userContestRanking || null,
    },
  };
  profileCache.set(cacheKey, response);
  try {
    await saveSnapshot(username, response);
  } catch (error) {
    console.error("Snapshot save failed:", error);
  }
  return response;
}

function sendProfileError(res, error) {
  if (error.code === "USER_NOT_FOUND") {
    return res.status(404).json({ error: "User not found", message: "No public LeetCode profile was found for this username." });
  }
  return sendUpstreamError(res, error);
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("🚀 Leetlytics Backend is Running");
});
// GET /api/user/:username  → stats + profile
app.get("/api/user/:username", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return res.status(400).json({ error: "Invalid username" });
  }
  try {
    res.json(await loadProfile(username));
  } catch (err) {
    sendProfileError(res, err);
  }
});

app.get("/api/user/:username/progress", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return res.status(400).json({ error: "Invalid username" });
  }
  try {
    res.json({ username, history: await getProgressHistory(username, req.query.days) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load progress history" });
  }
});

app.get("/api/user/:username/recommendations", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) return res.status(400).json({ error: "Invalid username" });
  try {
    const profile = await loadProfile(username);
    const recentData = await leetcodeQuery(RECENT_QUERY, { username });
    res.json({ problems: recommendProblems(profile.analytics.weakTopics, profile.analytics.difficulty, recentData.data?.recentSubmissionList || []) });
  } catch (error) {
    sendProfileError(res, error);
  }
});

app.get("/api/user/:username/platforms", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) return res.status(400).json({ error: "Invalid username" });
  try {
    const [profile, platforms] = await Promise.all([loadProfile(username), getPlatformProfiles(username)]);
    res.json({ username, platforms, combinedScore: combinedScore(profile, platforms) });
  } catch (error) {
    sendProfileError(res, error);
  }
});

app.get("/api/platform/:platform/:username", async (req, res) => {
  const platform = req.params.platform.toLowerCase();
  const username = req.params.username.trim();
  const providers = {
    codeforces: getCodeforces,
    codechef: getCodeChef,
    github: getGitHub,
  };
  const provider = providers[platform];
  if (!provider) {
    return res.status(400).json({
      error: "Unsupported platform",
      message: "Choose Codeforces, CodeChef, or GitHub.",
    });
  }
  try {
    const profile = await provider(username);
    if (!profile.available) {
      return res.status(404).json({
        error: "Profile unavailable",
        message: profile.error || `No public ${platform} profile was found.`,
      });
    }
    return res.json({ platform, profile });
  } catch (error) {
    console.error(error);
    return res.status(502).json({
      error: "Platform unavailable",
      message: `Unable to reach ${platform} right now. Please try again shortly.`,
    });
  }
});

app.get("/api/user/:username/report.pdf", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) return res.status(400).json({ error: "Invalid username" });
  try {
    const [profile, platforms, history] = await Promise.all([
      loadProfile(username),
      getPlatformProfiles(username),
      getProgressHistory(username, 365),
    ]);
    const pdf = await buildPdfReport(username, profile, platforms, history);
    res.type("application/pdf").set("Content-Disposition", `attachment; filename="${username}-leetmatric-report.pdf"`).send(pdf);
  } catch (error) {
    sendProfileError(res, error);
  }
});

app.post("/api/user/:username/study-plan", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) return res.status(400).json({ error: "Invalid username" });
  try {
    const profile = await loadProfile(username);
    const recommendations = recommendProblems(profile.analytics.weakTopics, profile.analytics.difficulty);
    res.json(await createStudyPlan(profile, recommendations));
  } catch (error) {
    if (error.code === "AI_NOT_CONFIGURED") return res.status(503).json({ error: "AI study plans are not configured", message: "Set AI_API_KEY on the server to enable study plans." });
    console.error(error);
    res.status(503).json({ error: "AI study plan unavailable", message: "The study-plan provider could not be reached." });
  }
});

app.get("/api/user/:username/goal", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) return res.status(400).json({ error: "Invalid username" });
  res.json({ goal: await getGoal(username) });
});

app.put("/api/user/:username/goal", async (req, res) => {
  const { username } = req.params;
  const dailyTarget = Number(req.body?.dailyTarget);
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username) || !Number.isInteger(dailyTarget) || dailyTarget < 1 || dailyTarget > 100) {
    return res.status(400).json({ error: "Daily target must be an integer from 1 to 100" });
  }
  await saveGoal(username, {
    dailyTarget,
    remindersEnabled: Boolean(req.body.remindersEnabled),
    reminderChannel: req.body.reminderChannel === "telegram" || req.body.reminderChannel === "email" ? req.body.reminderChannel : null,
  });
  res.json({ goal: await getGoal(username) });
});

app.post("/api/groups/:code/members", async (req, res) => {
  const code = req.params.code;
  const username = req.body?.username;
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(code) || !/^[a-zA-Z0-9_-]{1,25}$/.test(username || "")) {
    return res.status(400).json({ error: "Invalid group code or username" });
  }
  await addGroupMember(code, username);
  res.status(201).json({ groupCode: code, username });
});

app.get("/api/groups/:code/leaderboard", async (req, res) => {
  const code = req.params.code;
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(code)) return res.status(400).json({ error: "Invalid group code" });
  try {
    const members = await getGroupMembers(code);
    const leaderboard = await Promise.all(members.map(async ({ username }) => {
      const profile = await loadProfile(username);
      return {
        username,
        solved: profile.analytics.difficulty.reduce((sum, item) => sum + item.solved, 0),
        streak: profile.analytics.streaks.current,
        contestRating: profile.analytics.contestRanking?.rating || null,
      };
    }));
    res.json({ groupCode: code, leaderboard: leaderboard.sort((a, b) => b.solved - a.solved) });
  } catch (error) {
    sendProfileError(res, error);
  }
});

app.get("/api/compare/:first/:second", async (req, res) => {
  const { first, second } = req.params;
  const platform = String(req.query.platform || "leetcode").toLowerCase();
  if (![first, second].every((username) => /^[a-zA-Z0-9_-]{1,25}$/.test(username))) {
    return res.status(400).json({ error: "Invalid username" });
  }
  if (!["leetcode", "codeforces", "codechef", "github"].includes(platform)) {
    return res.status(400).json({ error: "Unsupported platform" });
  }
  try {
    if (platform !== "leetcode") {
      const loaders = { codeforces: getCodeforces, codechef: getCodeChef, github: getGitHub };
      const profiles = await Promise.all([loaders[platform](first), loaders[platform](second)]);
      const unavailable = profiles.find((profile) => !profile.available);
      if (unavailable) {
        const error = new Error(unavailable.error || `${platform} profile is unavailable`);
        error.code = "PLATFORM_PROFILE_UNAVAILABLE";
        throw error;
      }
      return res.json({
        platform,
        users: profiles.map((profile) => ({
          ...profile,
          username: profile.username,
        })),
      });
    }
    const profiles = await Promise.all([loadProfile(first), loadProfile(second)]);
    res.json({
      platform,
      users: profiles.map((profile, index) => ({
        username: [first, second][index],
        solved: profile.analytics.difficulty.reduce((sum, item) => sum + item.solved, 0),
        difficulty: profile.analytics.difficulty,
        streaks: profile.analytics.streaks,
        contestRating: profile.analytics.contestRanking?.rating || null,
        topics: profile.analytics.topics,
      })),
    });
  } catch (error) {
    if (error.code === "PLATFORM_PROFILE_UNAVAILABLE") {
      return res.status(404).json({ error: "Profile unavailable", message: error.message });
    }
    sendProfileError(res, error);
  }
});

app.get("/card/:username.svg", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return res.status(400).type("text/plain").send("Invalid username");
  }
  try {
    const profile = await loadProfile(username);
    const theme = req.query.theme === "light" ? "light" : "dark";
    res.type("image/svg+xml").set("Cache-Control", "public, max-age=900").send(renderStatsCard(username, profile, theme));
  } catch (error) {
    sendProfileError(res, error);
  }
});

// GET /api/user/:username/recent  → last 8 submissions
app.get("/api/user/:username/recent", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return res.status(400).json({ error: "Invalid username" });
  }
  const cacheKey = `recent:${username.toLowerCase()}`;
  const cached = cachedResponse(endpointCache, cacheKey);
  if (cached) return res.json(cached);
  try {
    const data = await leetcodeQuery(RECENT_QUERY, { username });
    const response = data.data?.recentSubmissionList || [];
    endpointCache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

// GET /api/user/:username/calendar  → streak + heatmap
app.get("/api/user/:username/calendar", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return res.status(400).json({ error: "Invalid username" });
  }
  const cacheKey = `calendar:${username.toLowerCase()}`;
  const cached = cachedResponse(endpointCache, cacheKey);
  if (cached) return res.json(cached);
  try {
    const data = await leetcodeQuery(CALENDAR_QUERY, { username });
    const cal = data?.data?.matchedUser?.userCalendar;
    if (!cal) return res.status(404).json({
      error: "Profile data is private or unavailable",
      message: "This profile does not expose calendar data.",
    });
    const response = { ...cal, heatmap: buildHeatmap(cal.submissionCalendar), streaks: calcStreaks(cal.submissionCalendar) };
    endpointCache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  LeetMatric server running → http://localhost:${PORT}`);
});
