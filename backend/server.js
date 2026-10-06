const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const rateLimit = require("express-rate-limit");
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

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static("../frontend/public"));

// Rate limiter: max 30 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests, slow down." },
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
  query userProfileCalendar($username: String!, $year: Int) {
    matchedUser(username: $username) {
      userCalendar(year: $year) {
        streak
        totalActiveDays
        submissionCalendar
      }
    }
  }
`;

// ── Helper ───────────────────────────────────────────────────────────────────
async function leetcodeQuery(query, variables) {
  const res = await fetch(LEETCODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Referer": "https://leetcode.com",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`LeetCode returned ${res.status}`);
  const payload = await res.json();
  if (payload.errors?.length) throw new Error(payload.errors[0].message || "LeetCode query failed");
  return payload;
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
    const data = await leetcodeQuery(STATS_QUERY, { username });
    if (!data?.data?.matchedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = data.data.matchedUser;
    const topics = getTopicStats(username, user.tagProblemCounts);
    const calendarData = await leetcodeQuery(CALENDAR_QUERY, {
      username,
      year: new Date().getFullYear(),
    });
    const calendar = calendarData?.data?.matchedUser?.userCalendar;
    const contestData = await leetcodeQuery(CONTEST_QUERY, { username });
    const calendarJson = calendar?.submissionCalendar || "{}";
    res.json({
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
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to reach LeetCode" });
  }
});

// GET /api/user/:username/recent  → last 8 submissions
app.get("/api/user/:username/recent", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return res.status(400).json({ error: "Invalid username" });
  }
  try {
    const data = await leetcodeQuery(RECENT_QUERY, { username });
    res.json(data.data?.recentSubmissionList || []);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to reach LeetCode" });
  }
});

// GET /api/user/:username/calendar  → streak + heatmap
app.get("/api/user/:username/calendar", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return res.status(400).json({ error: "Invalid username" });
  }
  const year = new Date().getFullYear();
  try {
    const data = await leetcodeQuery(CALENDAR_QUERY, { username, year });
    const cal = data?.data?.matchedUser?.userCalendar;
    if (!cal) return res.status(404).json({ error: "Calendar not found" });
    res.json({ ...cal, heatmap: buildHeatmap(cal.submissionCalendar), streaks: calcStreaks(cal.submissionCalendar) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to reach LeetCode" });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  LeetMatric server running → http://localhost:${PORT}`);
});
