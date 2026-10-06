const fetch = require("node-fetch");

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  if (!response.ok) {
    const error = new Error(`Provider returned ${response.status}`);
    error.code = response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE";
    throw error;
  }
  return response.json();
}

async function getText(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: "text/html", ...headers } });
  if (!response.ok) {
    const error = new Error(`Provider returned ${response.status}`);
    error.code = response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE";
    throw error;
  }
  return response.text();
}

async function getCodeforces(username) {
  try {
    const data = await getJson(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(username)}`);
    const user = data.result?.[0];
    return {
      provider: "Codeforces",
      username,
      available: true,
      rating: user?.rating || null,
      maxRating: user?.maxRating || null,
      rank: user?.rank || null,
      solved: null,
    };
  } catch (error) {
    return { provider: "Codeforces", username, available: false, error: "Profile unavailable" };
  }
}

async function getCodeChef(username) {
  try {
    const data = await getText(`https://www.codechef.com/users/${encodeURIComponent(username)}`);
    const rating = data.match(/rating-number[^>]*>([^<]+)/i)?.[1]?.trim() || null;
    return {
      provider: "CodeChef",
      username,
      available: Boolean(rating),
      rating: rating ? Number(rating) : null,
      solved: null,
      ...(rating ? {} : { error: "Profile unavailable or provider format changed" }),
    };
  } catch (error) {
    return { provider: "CodeChef", username, available: false, error: "Profile unavailable" };
  }
}

async function getGitHub(username) {
  try {
    const headers = process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {};
    const user = await getJson(`https://api.github.com/users/${encodeURIComponent(username)}`, headers);
    return {
      provider: "GitHub",
      username,
      available: true,
      repositories: user.public_repos,
      followers: user.followers,
      contributions: null,
    };
  } catch (error) {
    return { provider: "GitHub", username, available: false, error: "Profile unavailable" };
  }
}

async function getPlatformProfiles(username) {
  const [codeforces, codechef, github] = await Promise.all([
    getCodeforces(username),
    getCodeChef(username),
    getGitHub(username),
  ]);
  return { codeforces, codechef, github };
}

function combinedScore(leetcode, platforms) {
  const solved = leetcode.analytics.difficulty.reduce((sum, item) => sum + item.solved, 0);
  const rating = platforms.codeforces.rating || platforms.codechef.rating || 0;
  const githubActivity = (platforms.github.repositories || 0) + (platforms.github.followers || 0);
  return Math.round(solved * 2 + rating / 10 + githubActivity / 10);
}

module.exports = { combinedScore, getCodeChef, getCodeforces, getGitHub, getPlatformProfiles };
