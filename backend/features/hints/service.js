// backend/features/hints/service.js
const fetch = require("node-fetch");
const db = require("../db");

const HINTS_DAILY_LIMIT = Number(process.env.HINTS_DAILY_LIMIT) || 10;
const hintCache = new Map();

// Curated safe hint knowledge base for instant rule-based fallback
const HINT_KNOWLEDGE_BASE = {
  "two-sum": {
    nudge: "Notice that for each number x, the required complement is target - x.",
    approach: "Instead of checking all pairs in O(n^2), store previously seen values in a Hash Map to look up the complement in O(1).",
    pseudocode: "1. Initialize empty map seen\n2. Loop index i, value num in array:\n   complement = target - num\n   if complement in seen: return [seen[complement], i]\n   seen[num] = i\n3. Return empty if not found",
  },
  "valid-parentheses": {
    nudge: "The most recently opened bracket must be the first one to close.",
    approach: "Use a Last-In, First-Out (LIFO) Stack data structure to track opening brackets and match them against closing brackets.",
    pseudocode: "1. Initialize empty stack\n2. For each char in string:\n   if opening bracket: push onto stack\n   else if closing bracket: check if stack top matches, then pop; else invalid\n3. Return true if stack is empty, else false",
  },
  "best-time-to-buy-and-sell-stock": {
    nudge: "You can only sell after you buy. What is the minimum price seen so far?",
    approach: "Maintain a running minimum price as you iterate from left to right, and track the maximum profit (current_price - min_price).",
    pseudocode: "1. min_price = infinity, max_profit = 0\n2. For each price in prices:\n   min_price = min(min_price, price)\n   max_profit = max(max_profit, price - min_price)\n3. Return max_profit",
  },
  "binary-search": {
    nudge: "The array is already sorted. Look at the middle element.",
    approach: "Divide the search space in half each iteration by comparing the target with the middle element.",
    pseudocode: "1. low = 0, high = len - 1\n2. While low <= high:\n   mid = low + (high - low) / 2\n   if nums[mid] == target: return mid\n   else if nums[mid] < target: low = mid + 1\n   else: high = mid - 1\n3. Return -1",
  },
};

function sanitizeProblemInput(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/[<>{}[\]]/g, "")
    .replace(/(?:ignore previous instructions|system prompt|reveal prompt|act as an unfiltered|give me the full code|show solution code)/gi, "")
    .trim()
    .slice(0, 300);
}

function validateHintOutput(content, requestedLevel) {
  if (!content || typeof content !== "string") return null;
  const lower = content.toLowerCase();

  // Strict anti-leak code detection
  const codePatterns = [
    /class\s+solution/i,
    /public\s+(?:int|void|boolean|string|vector)/i,
    /def\s+[a-z_]+\s*\(/i,
    /#include\s*</i,
    /import\s+(?:java|os|sys)/i,
  ];

  for (const pattern of codePatterns) {
    if (pattern.test(content)) {
      return null; // Output contained full implementation code
    }
  }

  return {
    level: requestedLevel,
    hint: content.trim(),
    safetyVerified: true,
  };
}

async function checkAndIncrementHintUsage(userId) {
  await db.ensureInitialized();
  const todayStr = new Date().toISOString().slice(0, 10);

  const rows = await db.query(
    "SELECT hint_count FROM ai_hint_usage WHERE user_id = ? AND date = ?",
    [userId, todayStr]
  );

  const currentCount = Number(rows[0]?.hint_count) || 0;
  if (currentCount >= HINTS_DAILY_LIMIT) {
    return { allowed: false, currentCount, limit: HINTS_DAILY_LIMIT };
  }

  const id = db.generateId();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO ai_hint_usage (id, user_id, date, hint_count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET hint_count = hint_count + 1, updated_at = ?`,
    [id, userId, todayStr, now, now]
  );

  return { allowed: true, currentCount: currentCount + 1, limit: HINTS_DAILY_LIMIT };
}

async function getHint(userId, { problemSlug, problemTitle = "", level = "nudge" }) {
  const normalizedLevel = ["nudge", "approach", "pseudocode"].includes(level) ? level : "nudge";
  const slug = String(problemSlug || "").toLowerCase().trim();

  // 1. Check in-memory cache
  const cacheKey = `${slug}:${normalizedLevel}`;
  if (hintCache.has(cacheKey)) {
    return { ...hintCache.get(cacheKey), source: "cache" };
  }

  // 2. Check rule-based knowledge base
  const kbEntry = HINT_KNOWLEDGE_BASE[slug];
  if (kbEntry && kbEntry[normalizedLevel]) {
    const hintObj = {
      level: normalizedLevel,
      hint: kbEntry[normalizedLevel],
      safetyVerified: true,
      source: "rule-based",
    };
    hintCache.set(cacheKey, hintObj);
    return hintObj;
  }

  // 3. Rate limit check for LLM usage
  if (userId) {
    const quota = await checkAndIncrementHintUsage(userId);
    if (!quota.allowed) {
      return {
        error: "DAILY_LIMIT_REACHED",
        message: `You have reached your daily hint quota of ${HINTS_DAILY_LIMIT} hints. Try again tomorrow!`,
      };
    }
  }

  // 4. If no AI_API_KEY, return structured fallback guidance
  if (!process.env.AI_API_KEY) {
    const fallbackGuidance = {
      nudge: `Focus on the constraints of "${problemTitle || slug}". Could a linear scan or hash set simplify the search?`,
      approach: "Identify the bottleneck in the naive solution: replace repeated scans with precomputed hash lookups or two-pointer invariants.",
      pseudocode: "1. Parse input constraints\n2. Initialize lookup state\n3. Iterate and check invariant\n4. Return target result",
    };
    return {
      level: normalizedLevel,
      hint: fallbackGuidance[normalizedLevel],
      safetyVerified: true,
      source: "fallback",
    };
  }

  // 5. Call LLM with strict safety constraints
  const safeTitle = sanitizeProblemInput(problemTitle || slug);
  const prompt = `Problem: ${safeTitle}.
Request: Provide a Level "${normalizedLevel}" hint for this problem.
Level 1 'nudge': A gentle observation or question to trigger the right intuition.
Level 2 'approach': The general algorithmic technique or data structure to use without code.
Level 3 'pseudocode': High-level 3 to 5 step conceptual outline in plain English.
STRICT RULE: NEVER provide working programming language code (no Python, C++, Java, JS, or syntax). Never write function definitions or full solutions.`;

  try {
    const endpoint = process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions";
    const model = process.env.AI_MODEL || "gpt-4o-mini";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are a DSA coach. Provide only conceptual hints. Never output code." },
          { role: "user", content: prompt },
        ],
      }),
      timeout: 8000,
    });

    if (!res.ok) throw new Error(`LLM status ${res.status}`);
    const data = await res.json();
    const rawHint = data.choices?.[0]?.message?.content || "";
    const validated = validateHintOutput(rawHint, normalizedLevel);

    if (validated) {
      hintCache.set(cacheKey, { ...validated, source: "ai" });
      return { ...validated, source: "ai" };
    }
  } catch (err) {
    console.warn("AI hint query failed, using fallback:", err.message);
  }

  return {
    level: normalizedLevel,
    hint: `Analyze the problem requirements carefully. What subproblems repeat?`,
    safetyVerified: true,
    source: "fallback",
  };
}

module.exports = {
  getHint,
  sanitizeProblemInput,
  validateHintOutput,
  checkAndIncrementHintUsage,
  HINT_KNOWLEDGE_BASE,
};
