const fetch = require("node-fetch");

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "CodeAtlas/1.0 (+https://leetlytics.onrender.com)",
      ...headers,
    },
  });
  if (!response.ok) {
    const error = new Error(`Provider returned ${response.status}`);
    error.status = response.status;
    error.code = response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE";
    throw error;
  }
  return response.json();
}

async function getText(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html",
      "User-Agent": "CodeAtlas/1.0 (+https://leetlytics.onrender.com)",
      ...headers,
    },
  });
  if (!response.ok) {
    const error = new Error(`Provider returned ${response.status}`);
    error.code = response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE";
    throw error;
  }
  return response.text();
}

async function getCodeforces(username) {
  try {
    const [infoData, statusData] = await Promise.all([
      getJson(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(username)}`),
      getJson(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(username)}&from=1&count=10000`),
    ]);
    const user = infoData.result?.[0];
    const submissions = statusData.result || [];
    const solvedProblems = new Set(
      submissions
        .filter(item => item.verdict === "OK" && item.problem?.contestId && item.problem?.index)
        .map(item => `${item.problem.contestId}-${item.problem.index}`),
    );
    return {
      provider: "Codeforces",
      username,
      available: true,
      rating: user?.rating || null,
      maxRating: user?.maxRating || null,
      rank: user?.rank || null,
      solved: solvedProblems.size,
      submissions: submissions.length,
      contribution: user?.contribution || 0,
      friends: user?.friendOfCount || 0,
    };
  } catch (error) {
    return { provider: "Codeforces", username, available: false, error: "Profile unavailable" };
  }
}

async function getCodeChef(username) {
  try {
    const data = await getText(`https://www.codechef.com/users/${encodeURIComponent(username)}`);
    const rating = data.match(/class=["']rating-number["'][^>]*>\s*([\d,]+)/i)?.[1]?.replace(/,/g, "") || null;
    const highestRating = data.match(/Highest Rating\s*([\d,]+)/i)?.[1]?.replace(/,/g, "") || null;
    const globalRank = data.match(/class=['"]global-rank['"]>\s*([\d,]+)/i)?.[1] || null;
    const solved = data.match(/Total Problems Solved:\s*([\d,]+)/i)?.[1] || null;
    const stars = (data.match(/class=["']rating-star["'][\s\S]*?<\/div>/i)?.[0]?.match(/&#9733;|★/g) || []).length;
    const hasPublicProfile = /"currentUser"\s*:\s*"[^"]+"/i.test(data);
    return {
      provider: "CodeChef",
      username,
      available: Boolean(rating) || hasPublicProfile,
      rating: rating ? Number(rating) : null,
      highestRating: highestRating ? Number(highestRating) : null,
      globalRank: globalRank ? Number(globalRank) : null,
      solved: solved ? Number(solved) : null,
      stars,
      ...((rating || hasPublicProfile) ? {} : { error: "Profile unavailable or provider format changed" }),
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
      following: user.following,
      publicGists: user.public_gists,
      profileUrl: user.html_url,
      contributions: null,
    };
  } catch (error) {
    try {
      const profilePage = await getText(`https://github.com/${encodeURIComponent(username)}`);
      if (/<title>[^<]*GitHub/i.test(profilePage) && !/Page not found/i.test(profilePage)) {
        return {
          provider: "GitHub",
          username,
          available: true,
          repositories: null,
          followers: null,
          contributions: null,
        };
      }
    } catch {
      // Preserve the provider-specific error below when the fallback is unavailable.
    }
    const message = error.status === 403
      ? "GitHub API rate limit reached"
      : error.status === 404
        ? "GitHub profile not found"
        : "GitHub is temporarily unavailable";
    return { provider: "GitHub", username, available: false, error: message };
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
