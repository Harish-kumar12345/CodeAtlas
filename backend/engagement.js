const PROBLEMS = [
  ["Two Sum", "two-sum", "Array", "Easy"],
  ["Valid Parentheses", "valid-parentheses", "Stack", "Easy"],
  ["Best Time to Buy and Sell Stock", "best-time-to-buy-and-sell-stock", "Array", "Easy"],
  ["Binary Search", "binary-search", "Binary Search", "Easy"],
  ["Merge Two Sorted Lists", "merge-two-sorted-lists", "Linked List", "Easy"],
  ["3Sum", "3sum", "Array", "Medium"],
  ["Longest Substring Without Repeating Characters", "longest-substring-without-repeating-characters", "String", "Medium"],
  ["Product of Array Except Self", "product-of-array-except-self", "Array", "Medium"],
  ["Number of Islands", "number-of-islands", "Graph", "Medium"],
  ["Coin Change", "coin-change", "Dynamic Programming", "Medium"],
  ["Course Schedule", "course-schedule", "Graph", "Medium"],
  ["Trapping Rain Water", "trapping-rain-water", "Two Pointers", "Hard"],
  ["Word Ladder", "word-ladder", "Graph", "Hard"],
  ["Edit Distance", "edit-distance", "Dynamic Programming", "Hard"],
];

function recommendProblems(weakTopics = [], difficulty = [], recent = []) {
  const weak = weakTopics.map((topic) => topic.toLowerCase());
  const accepted = new Set(recent.map((item) => item.titleSlug));
  const preferredDifficulty = difficulty
    .slice()
    .sort((a, b) => a.solved - b.solved)[0]?.difficulty;
  return PROBLEMS
    .filter((problem) => !accepted.has(problem[1]))
    .map((problem) => ({
      title: problem[0],
      slug: problem[1],
      topic: problem[2],
      difficulty: problem[3],
      score: (weak.some((topic) => problem[2].toLowerCase().includes(topic) || topic.includes(problem[2].toLowerCase())) ? 2 : 0)
        + (problem[3] === preferredDifficulty ? 1 : 0),
      url: `https://leetcode.com/problems/${problem[1]}/`,
    }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 8)
    .map(({ score, ...problem }) => problem);
}

async function createStudyPlan(profile, recommendations) {
  if (!process.env.AI_API_KEY) {
    const error = new Error("AI study plans are not configured");
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }
  const endpoint = process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  const prompt = `Create a practical 7-day LeetCode study plan. Weak topics: ${profile.analytics.weakTopics.join(", ")}. Difficulty split: ${JSON.stringify(profile.analytics.difficulty)}. Current streak: ${profile.analytics.streaks.current}. Recommended problems: ${recommendations.map((item) => item.title).join(", ")}. Return JSON with a days array; each day must have day, focus, problems, and habit fields.`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({ model, temperature: 0.3, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) {
    const error = new Error(`AI provider returned ${response.status}`);
    error.code = "AI_UNAVAILABLE";
    throw error;
  }
  const payload = await response.json();
  return { model, plan: payload.choices?.[0]?.message?.content || "" };
}

module.exports = { createStudyPlan, recommendProblems };
