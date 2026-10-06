function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[char]));
}

function renderStatsCard(username, profileResponse, theme = "dark") {
  const light = theme === "light";
  const background = light ? "#ffffff" : "#0f1018";
  const foreground = light ? "#161823" : "#e9eaf6";
  const muted = light ? "#555878" : "#9599c2";
  const accent = "#7c6aff";
  const difficulty = profileResponse.analytics?.difficulty || [];
  const solved = difficulty.reduce((sum, item) => sum + item.solved, 0);
  const streak = profileResponse.analytics?.streaks?.current || 0;
  const rating = profileResponse.analytics?.contestRanking?.rating;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="240" viewBox="0 0 720 240" role="img" aria-label="LeetCode stats for ${escapeXml(username)}">
  <rect width="720" height="240" rx="20" fill="${background}"/>
  <rect x="1" y="1" width="718" height="238" rx="19" fill="none" stroke="${accent}" stroke-opacity=".35"/>
  <text x="32" y="48" fill="${foreground}" font-family="Arial,sans-serif" font-size="26" font-weight="700">${escapeXml(username)}</text>
  <text x="32" y="76" fill="${muted}" font-family="Arial,sans-serif" font-size="14">LeetMatric · LeetCode progress</text>
  <text x="32" y="136" fill="${accent}" font-family="Arial,sans-serif" font-size="38" font-weight="700">${solved}</text>
  <text x="32" y="160" fill="${muted}" font-family="Arial,sans-serif" font-size="13">problems solved</text>
  <text x="220" y="136" fill="#00e5a0" font-family="Arial,sans-serif" font-size="38" font-weight="700">${streak}</text>
  <text x="220" y="160" fill="${muted}" font-family="Arial,sans-serif" font-size="13">day streak</text>
  <text x="395" y="136" fill="#f5a623" font-family="Arial,sans-serif" font-size="38" font-weight="700">${rating ? Math.round(rating) : "—"}</text>
  <text x="395" y="160" fill="${muted}" font-family="Arial,sans-serif" font-size="13">contest rating</text>
  <text x="32" y="207" fill="${muted}" font-family="Arial,sans-serif" font-size="12">Track your journey at leetlytics.onrender.com</text>
</svg>`;
}

module.exports = { renderStatsCard };
