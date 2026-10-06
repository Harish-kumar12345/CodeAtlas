const express = require("express");
const path = require("path");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { randomBytes } = require("crypto");
const { TtlCache } = require("./cache");
const {
  addGroupMember,
  addUserGroupMember,
  getGoal,
  getGroupMembers,
  getLinkedAccounts,
  getPublicAccount,
  getProgressHistory,
  getUserById,
  getUserGoal,
  hasUserGroupMember,
  deleteUser,
  saveGoal,
  saveSnapshot,
  saveUserGoal,
  linkAccount,
  unlinkAccount,
  setAccountVisibility,
  upsertUser,
} = require("./database");
const { clearCookie, createToken, getCookie, readToken, setCookie } = require("./auth");
const { renderStatsCard } = require("./cards");
const { companyPrep, createStudyPlan, recommendProblems } = require("./engagement");
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
  placementReadiness,
} = require("./analytics");

const app = express();
const PORT = process.env.PORT || 3000;
const profileCache = new TtlCache();
const endpointCache = new TtlCache();
const studyPlanCache = new TtlCache();
const studyPlanUsage = new Map();
const STUDY_PLAN_DAILY_LIMIT = 3;
const circuit = { failures: 0, openedAt: 0 };
const CIRCUIT_FAILURE_LIMIT = 3;
const CIRCUIT_COOLDOWN_MS = 30 * 1000;
const upstreamRetryDelay = (attempt) => 250 * (2 ** attempt) + Math.floor(Math.random() * 150);

// ── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  },
}));
app.use(express.json());
app.use(express.static("../frontend/public"));
app.use((req, res, next) => {
  const requestId = req.get("X-Request-ID") || crypto.randomUUID();
  req.requestId = requestId;
  res.set("X-Request-ID", requestId);
  next();
});

function sendError(res, status, code, message, retryable = false) {
  return res.status(status).json({ code, message, retryable });
}

app.get("/health", (_req, res) => {
  const circuitOpen = circuit.openedAt > 0 && Date.now() - circuit.openedAt < CIRCUIT_COOLDOWN_MS;
  res.status(circuitOpen ? 503 : 200).json({
    status: circuitOpen ? "degraded" : "ok",
    service: "leetmatric",
    upstream: circuitOpen ? "open" : "available",
  });
});

// Rate limiter: max 30 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    res.set("Retry-After", "60");
    return sendError(res, 429, "RATE_LIMITED", "Too many requests. Please wait a minute and try again.", true);
  },
});
app.use("/api/", limiter);

function currentUser(req) {
  return readToken(getCookie(req, "codeatlas_session"));
}

async function requireUser(req, res, next) {
  const session = currentUser(req);
  if (!session) return sendError(res, 401, "AUTH_REQUIRED", "Please sign in to continue.", false);
  const user = await getUserById(session.userId);
  if (!user) return sendError(res, 401, "SESSION_INVALID", "Your session has expired. Please sign in again.", false);
  req.user = user;
  return next();
}

app.get("/auth/github", (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return sendError(res, 503, "OAUTH_NOT_CONFIGURED", "GitHub sign-in is not configured on this server.", false);
  }
  const state = randomBytes(24).toString("hex");
  setCookie(res, "codeatlas_oauth_state", createToken({ state }, 600), 600);
  const callback = process.env.GITHUB_CALLBACK_URL || `${req.protocol}://${req.get("host")}/auth/github/callback`;
  const params = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID, redirect_uri: callback, scope: "read:user user:email", state });
  return res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get("/auth/github/callback", async (req, res) => {
  const state = readToken(getCookie(req, "codeatlas_oauth_state"));
  clearCookie(res, "codeatlas_oauth_state");
  if (!state || state.state !== req.query.state) return sendError(res, 400, "OAUTH_STATE_INVALID", "Sign-in could not be verified. Please try again.", false);
  if (!req.query.code || !process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return sendError(res, 503, "OAUTH_NOT_CONFIGURED", "GitHub sign-in is not configured on this server.", false);
  }
  try {
    const callback = process.env.GITHUB_CALLBACK_URL || `${req.protocol}://${req.get("host")}/auth/github/callback`;
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "CodeAtlas/1.0" },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: req.query.code, redirect_uri: callback }),
    });
    const token = await tokenResponse.json();
    if (!token.access_token) return sendError(res, 502, "OAUTH_EXCHANGE_FAILED", "GitHub sign-in could not be completed.", true);
    const profileResponse = await fetch("https://api.github.com/user", { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token.access_token}`, "User-Agent": "CodeAtlas/1.0" } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.id) return sendError(res, 502, "OAUTH_PROFILE_FAILED", "GitHub profile could not be loaded.", true);
    const user = await upsertUser({ provider: "github", providerSubject: profile.id, email: profile.email, displayName: profile.name || profile.login, avatarUrl: profile.avatar_url });
    setCookie(res, "codeatlas_session", createToken({ userId: String(user.id), provider: user.provider }), 7 * 24 * 60 * 60);
    return res.redirect("/");
  } catch (error) {
    console.error(error);
    return sendError(res, 502, "OAUTH_UNAVAILABLE", "GitHub sign-in is temporarily unavailable.", true);
  }
});

app.get("/auth/logout", (req, res) => {
  clearCookie(res, "codeatlas_session");
  res.redirect("/");
});

app.get("/api/me", async (req, res) => {
  const session = currentUser(req);
  if (!session) return res.json({ user: null });
  const user = await getUserById(session.userId);
  if (!user) clearCookie(res, "codeatlas_session");
  return res.json({ user: user || null });
});

app.delete("/api/me", requireUser, async (req, res) => {
  await deleteUser(req.user.userId);
  clearCookie(res, "codeatlas_session");
  return res.status(204).send();
});

app.get("/api/accounts", requireUser, async (req, res) => {
  return res.json({ accounts: await getLinkedAccounts(req.user.id) });
});

app.post("/api/accounts", requireUser, async (req, res) => {
  const platform = String(req.body?.platform || "").toLowerCase();
  const username = String(req.body?.username || "").trim();
  if (!["leetcode", "codeforces", "codechef", "github"].includes(platform) || !/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return sendError(res, 400, "INVALID_ACCOUNT", "Choose a supported platform and valid username.", false);
  }
  await linkAccount(req.user.id, platform, username);
  return res.status(201).json({ accounts: await getLinkedAccounts(req.user.id) });
});

app.delete("/api/accounts/:platform/:username", requireUser, async (req, res) => {
  const platform = String(req.params.platform || "").toLowerCase();
  const username = String(req.params.username || "");
  if (!["leetcode", "codeforces", "codechef", "github"].includes(platform) || !/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return sendError(res, 400, "INVALID_ACCOUNT", "Invalid linked account.", false);
  }
  await unlinkAccount(req.user.id, platform, username);
  return res.status(204).send();
});

app.patch("/api/accounts/:platform/:username", requireUser, async (req, res) => {
  const platform = String(req.params.platform || "").toLowerCase();
  const username = String(req.params.username || "");
  if (!["leetcode", "codeforces", "codechef", "github"].includes(platform) || !/^[a-zA-Z0-9_-]{1,25}$/.test(username) || typeof req.body?.isPublic !== "boolean") {
    return sendError(res, 400, "INVALID_ACCOUNT", "Invalid account or visibility value.", false);
  }
  await setAccountVisibility(req.user.id, platform, username, req.body.isPublic);
  return res.json({ accounts: await getLinkedAccounts(req.user.id) });
});

app.get("/api/public/:platform/:username", async (req, res) => {
  const platform = String(req.params.platform || "").toLowerCase();
  const username = String(req.params.username || "");
  if (!["leetcode", "codeforces", "codechef", "github"].includes(platform) || !/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return sendError(res, 400, "INVALID_PROFILE", "Invalid public profile.", false);
  }
  const account = await getPublicAccount(platform, username);
  if (!account) return sendError(res, 404, "PROFILE_PRIVATE", "This profile is private or has not been linked.", false);
  try {
    const profile = platform === "leetcode" ? await loadProfile(username) : await ({ codeforces: getCodeforces, codechef: getCodeChef, github: getGitHub }[platform])(username);
    return res.json({ username, platform, profile });
  } catch (error) {
    return sendProfileError(res, error);
  }
});

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
  if (circuit.openedAt && Date.now() - circuit.openedAt < CIRCUIT_COOLDOWN_MS) {
    const error = new Error("LeetCode circuit is open");
    error.code = "LEETCODE_CIRCUIT_OPEN";
    throw error;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let res;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      res = await fetch(LEETCODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Referer: "https://leetcode.com", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload.errors?.length) {
          const error = new Error(payload.errors[0].message || "LeetCode query failed");
          error.code = /does not exist|not found/i.test(error.message)
            ? "USER_NOT_FOUND"
            : "LEETCODE_UNAVAILABLE";
          throw error;
        }
        circuit.failures = 0;
        circuit.openedAt = 0;
        return payload;
      }
      const error = new Error(`LeetCode returned ${res.status}`);
      error.code = res.status === 429 ? "LEETCODE_RATE_LIMITED" : "LEETCODE_UNAVAILABLE";
      throw error;
    } catch (error) {
      const retryable = ["LEETCODE_TIMEOUT", "LEETCODE_RATE_LIMITED", "LEETCODE_UNAVAILABLE"].includes(error.code)
        || error.name === "FetchError" || error.name === "AbortError";
      error.code = error.name === "AbortError" ? "LEETCODE_TIMEOUT" : (error.code || "LEETCODE_UNAVAILABLE");
      if (!retryable || attempt === 2) {
        if (retryable) {
          circuit.failures += 1;
          if (circuit.failures >= CIRCUIT_FAILURE_LIMIT) circuit.openedAt = Date.now();
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, upstreamRetryDelay(attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function cachedResponse(cache, key) {
  const value = cache.get(key);
  return value === undefined ? null : value;
}

function sendUpstreamError(res, error) {
  console.error(error);
  if (error.code === "LEETCODE_RATE_LIMITED") {
    return sendError(res, 503, "LEETCODE_RATE_LIMITED", "LeetCode is temporarily limiting requests. Please try again shortly.", true);
  }
  if (error.code === "LEETCODE_CIRCUIT_OPEN") {
    return sendError(res, 503, "LEETCODE_CIRCUIT_OPEN", "LeetCode is temporarily unavailable. Please try again in a few seconds.", true);
  }
  if (error.code === "LEETCODE_TIMEOUT") {
    return sendError(res, 504, "LEETCODE_TIMEOUT", "LeetCode is taking too long to respond. Please try again shortly.", true);
  }
  return sendError(res, 502, "LEETCODE_UNAVAILABLE", "LeetCode could not be reached. Please try again shortly.", true);
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
  response.analytics.readiness = placementReadiness(response.analytics);
  response.analytics.companyPrep = companyPrep(topics);
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
    return sendError(res, 404, "USER_NOT_FOUND", "No public LeetCode profile was found for this username.");
  }
  return sendUpstreamError(res, error);
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("🚀 Leetlytics Backend is Running");
});

app.get("/u/:username", (req, res) => {
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(req.params.username)) return sendError(res, 400, "INVALID_PROFILE", "Invalid public profile.", false);
  return res.sendFile(path.join(__dirname, "../frontend/public/index.html"));
});

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://leetlytics.onrender.com/sitemap.xml\n");
});

app.get("/sitemap.xml", (_req, res) => {
  res.type("application/xml").send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://leetlytics.onrender.com/</loc></url></urlset>');
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
  const usageKey = `${req.user.id}:${new Date().toISOString().slice(0, 10)}`;
  const cacheKey = `${req.user.id}:${username.toLowerCase()}`;
  const cachedPlan = studyPlanCache.get(cacheKey);
  if (cachedPlan) return res.json(cachedPlan);
  const usage = studyPlanUsage.get(usageKey) || 0;
  if (usage >= STUDY_PLAN_DAILY_LIMIT) return sendError(res, 429, "STUDY_PLAN_LIMIT", "Daily study-plan limit reached. Try again tomorrow.", false);
  try {
    const profile = await loadProfile(username);
    const recentData = await leetcodeQuery(RECENT_QUERY, { username });
    res.json({ problems: recommendProblems(profile.analytics.weakTopics, profile.analytics.difficulty, recentData.data?.recentSubmissionList || []) });
  } catch (error) {
    sendProfileError(res, error);
  }
});

app.get("/api/user/:username/company-prep", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) return sendError(res, 400, "INVALID_USERNAME", "Invalid username.", false);
  try {
    const profile = await loadProfile(username);
    return res.json(companyPrep(profile.analytics.topics, String(req.query.company || "Google")));
  } catch (error) {
    return sendProfileError(res, error);
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

app.post("/api/user/:username/study-plan", requireUser, async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) return res.status(400).json({ error: "Invalid username" });
  try {
    const profile = await loadProfile(username);
    const recommendations = recommendProblems(profile.analytics.weakTopics, profile.analytics.difficulty);
    const result = await createStudyPlan(profile, recommendations);
    studyPlanUsage.set(usageKey, usage + 1);
    studyPlanCache.set(cacheKey, result, 15 * 60 * 1000);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: "AI study plan unavailable", message: "The study-plan provider could not be reached." });
  }
});

app.get("/api/user/:username/goal", requireUser, async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) return res.status(400).json({ error: "Invalid username" });
  res.json({ goal: await getUserGoal(req.user.id) });
});

app.put("/api/user/:username/goal", requireUser, async (req, res) => {
  const { username } = req.params;
  const dailyTarget = Number(req.body?.dailyTarget);
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username) || !Number.isInteger(dailyTarget) || dailyTarget < 1 || dailyTarget > 100) {
    return res.status(400).json({ error: "Daily target must be an integer from 1 to 100" });
  }
  await saveUserGoal(req.user.id, username, {
    dailyTarget,
    remindersEnabled: Boolean(req.body.remindersEnabled),
    reminderChannel: req.body.reminderChannel === "telegram" || req.body.reminderChannel === "email" ? req.body.reminderChannel : null,
  });
  res.json({ goal: await getUserGoal(req.user.id) });
});

app.post("/api/groups/:code/members", requireUser, async (req, res) => {
  const code = req.params.code;
  const username = req.body?.username;
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(code) || !/^[a-zA-Z0-9_-]{1,25}$/.test(username || "")) {
    return res.status(400).json({ error: "Invalid group code or username" });
  }
  await addUserGroupMember(code, username, req.user.id);
  res.status(201).json({ groupCode: code, username });
});

app.get("/api/groups/:code/leaderboard", requireUser, async (req, res) => {
  const code = req.params.code;
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(code)) return res.status(400).json({ error: "Invalid group code" });
  try {
    if (!await hasUserGroupMember(code, req.user.id)) {
      return sendError(res, 403, "GROUP_ACCESS_REQUIRED", "Join this group before viewing its leaderboard.", false);
    }
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
