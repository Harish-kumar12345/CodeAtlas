// backend/features/mock/service.js
const db = require("../db");

// Catalog of vetted interview problems
const MOCK_CATALOG = [
  { title: "Two Sum", slug: "two-sum", difficulty: "Easy", topic: "Array" },
  { title: "Valid Parentheses", slug: "valid-parentheses", difficulty: "Easy", topic: "Stack" },
  { title: "Best Time to Buy and Sell Stock", slug: "best-time-to-buy-and-sell-stock", difficulty: "Easy", topic: "Array" },
  { title: "Binary Search", slug: "binary-search", difficulty: "Easy", topic: "Binary Search" },
  { title: "Merge Two Sorted Lists", slug: "merge-two-sorted-lists", difficulty: "Easy", topic: "Linked List" },
  { title: "3Sum", slug: "3sum", difficulty: "Medium", topic: "Array" },
  { title: "Longest Substring Without Repeating Characters", slug: "longest-substring-without-repeating-characters", difficulty: "Medium", topic: "String" },
  { title: "Coin Change", slug: "coin-change", difficulty: "Medium", topic: "Dynamic Programming" },
  { title: "Number of Islands", slug: "number-of-islands", difficulty: "Medium", topic: "Graph" },
  { title: "Kth Smallest Element in a BST", slug: "kth-smallest-element-in-a-bst", difficulty: "Medium", topic: "Tree" },
  { title: "Word Ladder", slug: "word-ladder", difficulty: "Hard", topic: "Graph" },
  { title: "Trapping Rain Water", slug: "trapping-rain-water", difficulty: "Hard", topic: "Two Pointers" },
  { title: "Edit Distance", slug: "edit-distance", difficulty: "Hard", topic: "Dynamic Programming" },
  { title: "Minimum Window Substring", slug: "minimum-window-substring", difficulty: "Hard", topic: "Sliding Window" },
];

function selectMockProblems(difficulty = "Medium", topics = []) {
  const normalizedDiff = ["Easy", "Medium", "Hard"].includes(difficulty) ? difficulty : "Medium";
  const normalizedTopics = (Array.isArray(topics) ? topics : [topics])
    .filter(Boolean)
    .map((t) => String(t).toLowerCase());

  let matches = MOCK_CATALOG.filter((p) => p.difficulty === normalizedDiff);
  if (normalizedTopics.length > 0) {
    const topicMatches = matches.filter((p) => normalizedTopics.some((t) => p.topic.toLowerCase().includes(t)));
    if (topicMatches.length >= 2) matches = topicMatches;
  }

  // Shuffle and pick 2
  const shuffled = matches.slice().sort(() => 0.5 - Math.random());
  if (shuffled.length >= 2) return shuffled.slice(0, 2);

  // Fallback to any 2 in catalog
  return MOCK_CATALOG.slice(0, 2);
}

function generateRuleBasedFeedback(session, problems) {
  const solvedCount = problems.filter((p) => p.status === "solved").length;
  const total = problems.length;
  const topicsList = [...new Set(problems.map((p) => p.topic))].join(", ");

  let verdict = "Solid attempt!";
  let tips = "Focus on edge cases and dry-running before coding.";

  if (solvedCount === total) {
    verdict = "Excellent performance! Both target problems solved within the timed window.";
    tips = "Try optimizing space complexity or practicing under a stricter 30-minute constraint.";
  } else if (solvedCount === 0) {
    verdict = "Tough session, but every mock interview builds endurance.";
    tips = `Review fundamentals in ${topicsList}. Break problems into smaller subproblems with brute-force first.`;
  } else {
    verdict = `Good pacing: ${solvedCount} out of ${total} problems completed.`;
    tips = "For unsolved problems, practice recognizing standard patterns within the first 5 minutes.";
  }

  return {
    summary: verdict,
    advice: tips,
    topicsCovered: topicsList,
    disclaimer: "Self-reported mock interview assessment.",
  };
}

async function startSession(userId, { durationMinutes = 45, targetDifficulty = "Medium", targetTopics = [] }) {
  if (!userId) throw new Error("userId is required");
  const duration = [30, 45, 60].includes(Number(durationMinutes)) ? Number(durationMinutes) : 45;
  const sessionId = db.generateId();
  const now = new Date().toISOString();

  const selectedProblems = selectMockProblems(targetDifficulty, targetTopics);

  await db.execute(
    `INSERT INTO mock_sessions (
      id, user_id, duration_minutes, target_difficulty, target_topics,
      status, score, ai_feedback, started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'active', 0, NULL, ?, NULL, ?)`,
    [
      sessionId,
      userId,
      duration,
      targetDifficulty,
      JSON.stringify(targetTopics),
      now,
      now,
    ]
  );

  for (let i = 0; i < selectedProblems.length; i++) {
    const p = selectedProblems[i];
    await db.execute(
      `INSERT INTO mock_session_problems (
        id, session_id, problem_title, problem_slug, platform, difficulty, topic, order_index, status, time_spent_seconds, solved_at
      ) VALUES (?, ?, ?, ?, 'leetcode', ?, ?, ?, 'unsolved', 0, NULL)`,
      [
        db.generateId(),
        sessionId,
        p.title,
        p.slug,
        p.difficulty,
        p.topic,
        i + 1,
      ]
    );
  }

  return getSession(userId, sessionId);
}

async function getSession(userId, sessionId) {
  const sessions = await db.query(
    "SELECT * FROM mock_sessions WHERE id = ? AND user_id = ?",
    [sessionId, userId]
  );
  if (!sessions || sessions.length === 0) return null;
  const session = sessions[0];

  const problems = await db.query(
    "SELECT * FROM mock_session_problems WHERE session_id = ? ORDER BY order_index ASC",
    [sessionId]
  );

  // Compute live timer
  const startedAt = new Date(session.started_at).getTime();
  const now = Date.now();
  const totalSeconds = session.duration_minutes * 60;
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
  const isExpired = remainingSeconds === 0 && session.status === "active";

  let parsedFeedback = null;
  if (session.ai_feedback) {
    try {
      parsedFeedback = typeof session.ai_feedback === "string" ? JSON.parse(session.ai_feedback) : session.ai_feedback;
    } catch {
      parsedFeedback = { verdict: String(session.ai_feedback), tips: "" };
    }
  }

  let parsedTopics = [];
  if (session.target_topics) {
    try {
      parsedTopics = typeof session.target_topics === "string" ? JSON.parse(session.target_topics) : session.target_topics;
    } catch {
      parsedTopics = [];
    }
  }

  return {
    ...session,
    ai_feedback: parsedFeedback,
    target_topics: parsedTopics,
    problems: problems.map((p) => ({
      ...p,
      url: `https://leetcode.com/problems/${p.problem_slug}/`,
    })),
    timer: {
      totalSeconds,
      elapsedSeconds,
      remainingSeconds,
      isExpired,
    },
  };
}

async function updateProblemStatus(userId, sessionId, problemSlug, { status, timeSpentSeconds = 0 }) {
  const session = await getSession(userId, sessionId);
  if (!session) return null;

  const validStatus = status === "solved" ? "solved" : "unsolved";
  const now = new Date().toISOString();

  await db.execute(
    `UPDATE mock_session_problems
     SET status = ?, time_spent_seconds = ?, solved_at = ?
     WHERE session_id = ? AND problem_slug = ?`,
    [
      validStatus,
      Number(timeSpentSeconds) || 0,
      validStatus === "solved" ? now : null,
      sessionId,
      problemSlug,
    ]
  );

  return getSession(userId, sessionId);
}

async function finishSession(userId, sessionId) {
  const session = await getSession(userId, sessionId);
  if (!session) return null;

  const solvedCount = session.problems.filter((p) => p.status === "solved").length;
  const score = Math.round((solvedCount / session.problems.length) * 100);
  const feedback = generateRuleBasedFeedback(session, session.problems);
  const now = new Date().toISOString();

  await db.execute(
    `UPDATE mock_sessions
     SET status = 'completed', score = ?, ai_feedback = ?, completed_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      score,
      JSON.stringify(feedback),
      now,
      sessionId,
      userId,
    ]
  );

  return getSession(userId, sessionId);
}

async function getSessionHistory(userId) {
  if (!userId) return [];
  const sessions = await db.query(
    "SELECT * FROM mock_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 20",
    [userId]
  );
  return sessions;
}

module.exports = {
  selectMockProblems,
  startSession,
  getSession,
  updateProblemStatus,
  finishSession,
  getSessionHistory,
  generateRuleBasedFeedback,
};
