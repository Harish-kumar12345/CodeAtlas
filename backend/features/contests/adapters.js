// backend/features/contests/adapters.js
// Adapters for fetching and normalizing upcoming contests across platforms
const fetch = require("node-fetch");

const USER_AGENT = "LeetMatric/1.0 (Contests Calendar)";

function formatIcsTimestamp(dateObj) {
  return dateObj.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Generates an RFC 5545 compliant iCalendar string for a contest.
 */
function generateIcs(contest) {
  const startDate = new Date(contest.startTime);
  const endDate = new Date(contest.endTime || (startDate.getTime() + (contest.durationSeconds || 7200) * 1000));
  const startStr = formatIcsTimestamp(startDate);
  const endStr = formatIcsTimestamp(endDate);
  const nowStr = formatIcsTimestamp(new Date());
  const uid = `${contest.platform}-${contest.id}@leetmatric.com`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LeetMatric//Contests Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowStr}`,
    `DTSTART:${startStr}`,
    `DTEND:${endStr}`,
    `SUMMARY:${contest.name}`,
    `DESCRIPTION:Upcoming ${contest.platform} contest: ${contest.url}`,
    `URL:${contest.url}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * Builds Google Calendar web intent URL.
 */
function buildGoogleCalendarUrl(contest) {
  const startDate = new Date(contest.startTime);
  const endDate = new Date(contest.endTime || (startDate.getTime() + (contest.durationSeconds || 7200) * 1000));
  const startStr = formatIcsTimestamp(startDate);
  const endStr = formatIcsTimestamp(endDate);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: contest.name,
    dates: `${startStr}/${endStr}`,
    details: `Platform: ${contest.platform}\nContest link: ${contest.url}`,
    location: contest.url,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

async function fetchCodeforcesContests() {
  try {
    const res = await fetch("https://codeforces.com/api/contest.list?gym=false", {
      headers: { "User-Agent": USER_AGENT },
      timeout: 8000,
    });
    if (!res.ok) throw new Error(`Codeforces HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "OK" || !Array.isArray(data.result)) {
      throw new Error("Invalid Codeforces payload");
    }
    const nowSec = Math.floor(Date.now() / 1000);
    return data.result
      .filter((c) => c.phase === "BEFORE" || c.startTimeSeconds > nowSec)
      .map((c) => ({
        id: `cf_${c.id}`,
        name: c.name,
        platform: "Codeforces",
        url: `https://codeforces.com/contests/${c.id}`,
        startTime: new Date(c.startTimeSeconds * 1000).toISOString(),
        durationSeconds: c.durationSeconds || 7200,
        endTime: new Date((c.startTimeSeconds + (c.durationSeconds || 7200)) * 1000).toISOString(),
      }));
  } catch (err) {
    return { error: err.message, contests: [] };
  }
}

async function fetchLeetCodeContests() {
  try {
    const query = `
      query {
        topTwoContests {
          title
          titleSlug
          startTime
          duration
        }
      }
    `;
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ query }),
      timeout: 8000,
    });
    if (!res.ok) throw new Error(`LeetCode HTTP ${res.status}`);
    const data = await res.json();
    const list = data?.data?.topTwoContests || [];
    const nowSec = Math.floor(Date.now() / 1000);
    return list
      .filter((c) => (c.startTime + c.duration) > nowSec)
      .map((c) => ({
        id: `lc_${c.titleSlug}`,
        name: c.title,
        platform: "LeetCode",
        url: `https://leetcode.com/contest/${c.titleSlug}`,
        startTime: new Date(c.startTime * 1000).toISOString(),
        durationSeconds: c.duration,
        endTime: new Date((c.startTime + c.duration) * 1000).toISOString(),
      }));
  } catch (err) {
    return { error: err.message, contests: [] };
  }
}

async function fetchCodeChefContests() {
  try {
    const res = await fetch("https://www.codechef.com/api/list/contests/all?sort_by=START&sorting_order=asc", {
      headers: { "User-Agent": USER_AGENT },
      timeout: 8000,
    });
    if (!res.ok) throw new Error(`CodeChef HTTP ${res.status}`);
    const data = await res.json();
    const future = data.future_contests || [];
    return future.map((c) => {
      const startMs = Date.parse(c.contest_start_date_iso || c.contest_start_date);
      const endMs = Date.parse(c.contest_end_date_iso || c.contest_end_date);
      const durationSeconds = Math.max(3600, Math.floor((endMs - startMs) / 1000) || 7200);
      return {
        id: `cc_${c.contest_code}`,
        name: c.contest_name,
        platform: "CodeChef",
        url: `https://www.codechef.com/${c.contest_code}`,
        startTime: new Date(startMs).toISOString(),
        durationSeconds,
        endTime: new Date(endMs).toISOString(),
      };
    });
  } catch (err) {
    return { error: err.message, contests: [] };
  }
}

module.exports = {
  fetchCodeforcesContests,
  fetchLeetCodeContests,
  fetchCodeChefContests,
  generateIcs,
  buildGoogleCalendarUrl,
};
