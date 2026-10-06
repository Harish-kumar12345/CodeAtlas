/* ─────────────────────────────────────────────────────────────────────────
   LeetMatric — app.js
   Talks to /api/* endpoints served by the Node backend.
   ───────────────────────────────────────────────────────────────────────── */

const API_BASE = ""; // same origin; backend serves frontend at /

// ── DOM refs ────────────────────────────────────────────────────────────────
const searchBtn   = document.getElementById("search-btn");
const userInput   = document.getElementById("user-input");
const results     = document.getElementById("results");
const searchHint  = document.getElementById("search-hint");
const btnText     = searchBtn.querySelector(".btn-text");
const btnSpinner  = searchBtn.querySelector(".btn-spinner");
const compareInput = document.getElementById("compare-input");
const compareBtn = document.getElementById("compare-btn");
const themeToggle = document.getElementById("theme-toggle");
const platformSelector = document.getElementById("platform-selector");
const previewHeatmapCells = document.getElementById("preview-heatmap-cells");
const authSignIn = document.getElementById("auth-sign-in");
const authUser = document.getElementById("auth-user");
const authLogout = document.getElementById("auth-logout");
const authDelete = document.getElementById("auth-delete");
let selectedPlatform = "leetcode";

async function loadAuthState() {
  try {
    const response = await fetch("/api/me");
    const data = await response.json();
    if (!response.ok || !data.user) return;
    authSignIn.hidden = true;
    authUser.hidden = false;
    authUser.textContent = `Signed in as ${data.user.displayName || data.user.email || "GitHub user"}`;
    authLogout.hidden = false;
    authDelete.hidden = false;
  } catch {
    // Public profile search remains usable if auth status cannot be loaded.
  }
}

authLogout?.addEventListener("click", () => { window.location.href = "/auth/logout"; });
authDelete?.addEventListener("click", async () => {
  if (!window.confirm("Delete your CodeAtlas account and private data?")) return;
  const response = await fetch("/api/me", { method: "DELETE" });
  if (response.ok) window.location.reload();
});
loadAuthState();

// ── Helpers ──────────────────────────────────────────────────────────────────
const CIRC = 2 * Math.PI * 46; // SVG ring circumference (r=46)

function setTheme(theme, persist = true) {
  const light = theme === "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  themeToggle.textContent = light ? "◐ Dark" : "☼ Light";
  themeToggle.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
  themeToggle.setAttribute("aria-pressed", String(light));
  if (persist) localStorage.setItem("codeatlas-theme", light ? "light" : "dark");
}

const savedTheme = localStorage.getItem("codeatlas-theme") || localStorage.getItem("leetmatric-theme");
const preferredTheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
setTheme(savedTheme || preferredTheme, false);
themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));

platformSelector?.addEventListener("click", event => {
  const option = event.target.closest(".platform-option");
  if (!option) return;
  platformSelector.querySelectorAll(".platform-option").forEach(button => {
    const active = button === option;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const platform = option.dataset.platform;
  userInput.setAttribute("aria-label", `${option.textContent.trim()} username`);
  selectedPlatform = platform;
  userInput.placeholder = platform === "github"
    ? "e.g. torvalds"
    : platform === "codeforces"
      ? "e.g. tourist"
      : platform === "codechef"
        ? "e.g. admin"
        : "e.g. neal_wu";
  searchHint.textContent = "";
});

if (previewHeatmapCells) {
  const levels = [0, 0, 1, 1, 2, 2, 3, 4];
  previewHeatmapCells.innerHTML = Array.from(
    { length: 84 },
    (_, index) => `<i class="heat-${levels[(index * 7 + 3) % levels.length]}"></i>`,
  ).join("");
}

function updatePreview(userData, calData, username) {
  const profile = userData.matchedUser?.profile || {};
  const analytics = userData.analytics || {};
  const solved = (analytics.difficulty || []).reduce((sum, item) => sum + Number(item.solved || 0), 0);
  const contest = analytics.contests?.history || [];
  const latestRating = contest.length ? contest[contest.length - 1].rating : null;
  const activeDays = calData?.totalActiveDays ?? "—";
  const heatmap = analytics.heatmap || [];
  const cells = heatmap.slice(-84).map(day => {
    const level = Math.max(0, Math.min(4, Number(day.level) || 0));
    return `<i class="heat-${level}" title="${Number(day.count || 0)} submissions"></i>`;
  }).join("");

  document.getElementById("preview-badge").innerHTML = '<span class="live-dot"></span> Live profile';
  document.getElementById("preview-avatar").textContent = (profile.realName || username).charAt(0).toUpperCase();
  document.getElementById("preview-username").textContent = profile.realName || username;
  document.getElementById("preview-subtitle").textContent = `@${username} · LeetCode`;
  document.getElementById("preview-score").textContent = solved.toLocaleString();
  document.getElementById("preview-solved").textContent = solved.toLocaleString();
  document.getElementById("preview-solved-note").textContent = "problems solved";
  document.getElementById("preview-streak").textContent = `${analytics.streaks?.current || 0} days`;
  document.getElementById("preview-active-days").textContent = activeDays === "—" ? activeDays : Number(activeDays).toLocaleString();
  document.getElementById("preview-rating").textContent = latestRating ? Number(latestRating).toLocaleString() : "—";
  document.getElementById("preview-rating-note").textContent = latestRating ? "Latest contest rating" : "No contest data";
  if (cells) previewHeatmapCells.innerHTML = cells;
}

function updatePlatformPreview(platform, profile) {
  const metrics = {
    Codeforces: [
      ["Rating", profile.rating ?? "—", "Current rating"],
      ["Solved", profile.solved ?? "—", "Accepted problems"],
      ["Submissions", profile.submissions ?? "—", "Recent submissions"],
      ["Rank", profile.rank || "—", "Competitive rank"],
    ],
    CodeChef: [
      ["Rating", profile.rating ?? "—", "Current rating"],
      ["Solved", profile.solved ?? "—", "Problems solved"],
      ["Global rank", profile.globalRank ?? "—", "Overall rank"],
      ["Stars", profile.stars || "—", "CodeChef stars"],
    ],
    GitHub: [
      ["Repositories", profile.repositories ?? "—", "Public repositories"],
      ["Followers", profile.followers ?? "—", "People following"],
      ["Following", profile.following ?? "—", "Accounts following"],
      ["Gists", profile.publicGists ?? "—", "Public gists"],
    ],
  }[profile.provider] || [];
  const labelIds = ["preview-label-1", "preview-label-2", "preview-label-3", "preview-label-4"];
  const valueIds = ["preview-solved", "preview-streak", "preview-active-days", "preview-rating"];
  const noteIds = ["preview-solved-note", "preview-streak-note", "preview-active-note", "preview-rating-note"];
  metrics.forEach(([label, value, note], index) => {
    document.getElementById(labelIds[index]).textContent = label;
    document.getElementById(valueIds[index]).textContent = value;
    document.getElementById(noteIds[index]).textContent = note;
  });
  document.getElementById("preview-badge").innerHTML = `<span class="live-dot"></span> Live ${escapeHTML(profile.provider)} profile`;
  document.getElementById("preview-avatar").textContent = profile.username.charAt(0).toUpperCase();
  document.getElementById("preview-username").textContent = profile.username;
  document.getElementById("preview-subtitle").textContent = `@${profile.username} · ${profile.provider}`;
  document.getElementById("preview-score").textContent = metrics[0]?.[1] ?? "—";
  previewHeatmapCells.innerHTML = "";
  previewHeatmapCells.parentElement.querySelector(".preview-heatmap-title").textContent = `${profile.provider} profile metrics`;
}

document.querySelectorAll(".example-link").forEach(example => {
  example.addEventListener("click", () => {
    userInput.value = example.dataset.example;
    userInput.focus();
    handleSearch();
  });

  document.addEventListener("click", async event => {
    const link = event.target.closest("[data-dashboard-target]");
    if (!link) return;
    const target = document.getElementById(link.dataset.dashboardTarget);
    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      return;
    }
    const username = userInput.value.trim();
    const validationError = validate(username);
    if (!validationError) {
      event.preventDefault();
      await handleSearch();
      results.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    event.preventDefault();
    userInput.focus();
    const platformName = platformSelector?.querySelector(".platform-option.active")?.textContent.trim() || "selected platform";
    searchHint.textContent = `Search a ${platformName} profile first to open this live section.`;
  });
});

function validate(username) {
  if (!username.trim()) return "Username cannot be empty.";
  if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username))
    return "Use only letters, numbers, _ or − (max 25 chars).";
  return null;
}

function setLoading(loading) {
  searchBtn.disabled = loading;
  btnText.hidden     = loading;
  btnSpinner.hidden  = !loading;
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - parseInt(ts);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function pct(solved, total) {
  return total > 0 ? ((solved / total) * 100).toFixed(1) : "0.0";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function renderError(message, retryable = true) {
  results.innerHTML = `
    <div class="empty-state">
      <div class="icon">⚠️</div>
      <div class="err-msg">${escapeHTML(message)}</div>
      <div>${retryable ? "The service may be waking up or temporarily unavailable." : "Check the username and try again."}</div>
      ${retryable ? '<button type="button" class="dashboard-action primary" data-retry-search>Retry</button>' : ""}
    </div>`;
}

document.addEventListener("click", event => {
  if (event.target.closest("[data-retry-search]")) handleSearch();
});

// ── Skeleton ─────────────────────────────────────────────────────────────────
function showSkeleton() {
  results.innerHTML = `
    <div class="skeleton-section">
      <div class="skel-row">
        <div class="skel skel-circle" style="width:64px;height:64px;flex-shrink:0"></div>
        <div style="flex:1">
          <div class="skel skel-line" style="width:50%"></div>
          <div class="skel skel-line" style="width:30%"></div>
        </div>
      </div>
    </div>
    <div class="skeleton-section">
      <div class="skel skel-line" style="width:25%;margin-bottom:1.5rem"></div>
      <div style="display:flex;justify-content:space-around;gap:1rem">
        ${[1,2,3].map(()=>`<div class="skel skel-circle" style="width:108px;height:108px"></div>`).join("")}
      </div>
    </div>
    <div class="skeleton-section">
      <div class="skel skel-line" style="width:25%;margin-bottom:1.25rem"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        ${[1,2,3,4].map(()=>`
          <div style="background:var(--surface2);border-radius:var(--radius);padding:1rem">
            <div class="skel skel-line" style="width:60%"></div>
            <div class="skel skel-line" style="width:40%;height:22px"></div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderPlatformProfile(platform, profile) {
  const labels = {
    Codeforces: [
      ["Rating", profile.rating || "Unrated"],
      ["Best rating", profile.maxRating || "—"],
      ["Rank", profile.rank || "—"],
      ["Solved", profile.solved ?? "—"],
      ["Submissions", profile.submissions ?? "—"],
      ["Contribution", profile.contribution ?? "—"],
    ],
    CodeChef: [
      ["Rating", profile.rating || "Unrated"],
      ["Highest rating", profile.highestRating || "—"],
      ["Global rank", profile.globalRank || "—"],
      ["Problems solved", profile.solved ?? "—"],
      ["Stars", profile.stars || "—"],
    ],
    GitHub: [
      ["Repositories", profile.repositories ?? 0],
      ["Followers", profile.followers ?? 0],
      ["Following", profile.following ?? 0],
      ["Public gists", profile.publicGists ?? 0],
    ],
  };
  const stats = labels[profile.provider] || [];
  results.innerHTML = `
    <section class="analytics-section platform-profile-card" aria-labelledby="platform-profile-title">
      <div class="section-header">
        <div>
          <span class="section-kicker">${escapeHTML(profile.provider)} profile</span>
          <h2 id="platform-profile-title">@${escapeHTML(profile.username)}</h2>
        </div>
        <span class="platform-badge ${platform}"><i></i>${escapeHTML(profile.provider)}</span>
      </div>
      <div class="stats-grid">
        ${stats.map(([label, value]) => `
          <div class="stat-tile">
            <span class="stat-label">${escapeHTML(label)}</span>
            <strong class="stat-value">${escapeHTML(value)}</strong>
          </div>`).join("")}
      </div>
      <p class="muted platform-profile-note">Public profile data loaded successfully.</p>
    </section>`;
}

async function fetchPlatformProfile(username, platform) {
  showSkeleton();
  try {
    const response = await fetch(`${API_BASE}/api/platform/${encodeURIComponent(platform)}/${encodeURIComponent(username)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || "Unable to load this profile.");
      error.retryable = data.retryable !== false && response.status >= 500;
      throw error;
    }
    renderPlatformProfile(platform, data.profile);
    updatePlatformPreview(platform, data.profile);
  } catch (error) {
    renderError(error.message, error.retryable !== false);
  }
}

// ── SVG Ring helper ───────────────────────────────────────────────────────────
function ringHTML(difficulty, id) {
  return `
    <div class="ring-item">
      <div class="ring-wrap">
        <svg class="ring-svg" viewBox="0 0 110 110">
          <circle class="ring-bg" cx="55" cy="55" r="46"/>
          <circle id="${id}" class="ring-fg ${difficulty}" cx="55" cy="55" r="46"/>
        </svg>
        <div class="ring-label">
          <span class="ring-count" id="${id}-count">—</span>
          <span class="ring-sub">solved</span>
        </div>
      </div>
      <span class="ring-tag ${difficulty}">${difficulty}</span>
    </div>`;
}

function animateRing(id, solved, total) {
  const circle = document.getElementById(id);
  const countEl = document.getElementById(`${id}-count`);
  if (!circle) return;
  circle.style.strokeDasharray  = CIRC;
  circle.style.strokeDashoffset = CIRC;
  countEl.textContent = `${solved}/${total}`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    circle.style.strokeDashoffset = CIRC * (1 - (total > 0 ? solved/total : 0));
  }));
}

// ── Build heatmap from LeetCode's submissionCalendar JSON ────────────────────
function buildHeatmap(calendarStr) {
  if (Array.isArray(calendarStr)) {
    const cols = [];
    let col = [];
    calendarStr.forEach((day) => {
      const cell = {
        lvl: Number(day.level) || 0,
        cnt: Number(day.count) || 0,
        dateStr: day.date
      };
      col.push(cell);
      if (col.length === 7) {
        cols.push(col);
        col = [];
      }
    });
    if (col.length) cols.push(col);
    return `
      <div class="heatmap">
        ${cols.map(week => `
          <div class="heatmap-col">
            ${week.map(d => `
              <div class="heatmap-cell lvl-${d.lvl}" title="${d.cnt} submission${d.cnt !== 1 ? "s" : ""} on ${d.dateStr}"></div>
            `).join("")}
          </div>
        `).join("")}
      </div>`;
  }

  let calData = {};
  if (calendarStr && typeof calendarStr === "object") {
    calData = calendarStr;
  } else {
    try {
      calData = JSON.parse(calendarStr || "{}");
    } catch {
      calData = {};
    }
  }
  const today   = new Date();
  today.setHours(0,0,0,0);
  const weeks = 26; // ~6 months
  const cells  = [];
  // Generate last 26 weeks of days
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (weeks * 7 - 1));
  // pad to Monday
  const dayOfWeek = startDate.getDay(); // 0=Sun
  startDate.setDate(startDate.getDate() - dayOfWeek);

  let cols = [];
  let col  = [];
  const cur = new Date(startDate);
  while (cur <= today) {
    const ts  = Math.floor(Date.UTC(
      cur.getFullYear(),
      cur.getMonth(),
      cur.getDate(),
    ) / 1000);
    const cnt = calData[ts] || 0;
    const lvl = cnt === 0 ? 0 : cnt < 3 ? 1 : cnt < 6 ? 2 : cnt < 10 ? 3 : 4;
    const dateStr = cur.toISOString().slice(0,10);
    col.push({ lvl, cnt, dateStr });
    if (col.length === 7) { cols.push(col); col = []; }
    cur.setDate(cur.getDate() + 1);
  }
  if (col.length) cols.push(col);

  return `
    <div class="heatmap">
      ${cols.map(week => `
        <div class="heatmap-col">
          ${week.map(d => `
            <div class="heatmap-cell lvl-${d.lvl}" title="${d.cnt} submission${d.cnt !== 1 ? "s" : ""} on ${d.dateStr}"></div>
          `).join("")}
        </div>
      `).join("")}
    </div>`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(userData, calData, recentData, username, progress = [], recommendations = []) {
  const aq = userData.allQuestionsCount;
  const ac = userData.matchedUser.submitStats.acSubmissionNum;
  const ts = userData.matchedUser.submitStats.totalSubmissionNum;
  const profile = userData.matchedUser.profile;
  updatePreview(userData, calData, username);

  const totals  = { easy: aq[1].count, medium: aq[2].count, hard: aq[3].count };
  const solved  = { easy: ac[1].count, medium: ac[2].count, hard: ac[3].count };
  const subs    = { all: ts[0].submissions, easy: ts[1].submissions, medium: ts[2].submissions, hard: ts[3].submissions };
  const analytics = userData.analytics || {};
  const topics = analytics.topics || [];
  const weakTopics = analytics.weakTopics || [];
  const contestHistory = analytics.contests?.history || [];
  const maxTopicSolved = Math.max(...topics.map(topic => topic.solved), 1);
  const maxRating = Math.max(...contestHistory.map(contest => contest.rating), 1);
  const minRating = Math.min(...contestHistory.map(contest => contest.rating), maxRating);
  const ratingRange = Math.max(maxRating - minRating, 1);

  // Profile
  const avatarHTML = profile.userAvatar
    ? `<img class="profile-avatar" src="${profile.userAvatar}" alt="${username}" loading="lazy" onerror="this.replaceWith(document.createElement('div'))">`
    : `<div class="profile-avatar-placeholder">👤</div>`;

  // Heatmap
  const heatmapSource = analytics.heatmap?.length
    ? analytics.heatmap
    : calData?.heatmap?.length
      ? calData.heatmap
      : calData?.submissionCalendar;
  const heatmapHTML = heatmapSource
    ? buildHeatmap(heatmapSource)
    : `<div class="empty-state" style="padding:1rem">No calendar data.</div>`;

  // Recent submissions
  const recentHTML = (recentData?.length)
    ? recentData.map(s => {
        const ac = s.statusDisplay === "Accepted";
        return `
          <div class="recent-item">
            <div class="recent-status ${ac ? "ac" : "rej"}"></div>
            <div class="recent-title">
              <a href="https://leetcode.com/problems/${s.titleSlug}" target="_blank" rel="noopener">${s.title}</a>
            </div>
            <span class="recent-lang">${s.lang}</span>
            <span class="recent-time">${timeAgo(s.timestamp)}</span>
          </div>`;
      }).join("")
    : `<div class="empty-state" style="padding:1rem">No recent submissions.</div>`;

  results.innerHTML = `
    <div class="dashboard-shell">
    <!-- Profile -->
    <div class="profile-card">
      ${avatarHTML}
      <div class="profile-info">
        <div class="profile-name">${escapeHTML(profile.realName || username)}</div>
        <div class="profile-username">@${escapeHTML(username)}</div>
        <div class="profile-rank">
          <span>Global Rank</span>
          <span class="rank-badge">#${profile.ranking?.toLocaleString() || "—"}</span>
        </div>
        <div class="platform-badges" aria-label="Connected platforms">
          <span class="platform-badge leetcode"><i></i>LeetCode</span>
          <span class="platform-badge muted-platform"><i></i>Codeforces</span>
          <span class="platform-badge muted-platform"><i></i>GitHub</span>
        </div>
      </div>
      <div class="profile-actions">
        <a class="dashboard-action secondary" href="/api/user/${encodeURIComponent(username)}/report.pdf">Download PDF</a>
        <button class="dashboard-action primary" id="profile-compare-btn" type="button">Compare</button>
      </div>
    </div>

    <div class="dashboard-intro">
      <div><span class="section-kicker">Profile overview</span><h2>Progress at a glance</h2></div>
      <span class="ui-badge">LeetCode profile</span>
    </div>

    <!-- Solved Rings -->
    <div class="solved-section" id="dashboard-overview">
      <div class="section-title">// problems solved</div>
      <div class="rings-row">
        ${ringHTML("easy",   "ring-easy")}
        ${ringHTML("medium", "ring-medium")}
        ${ringHTML("hard",   "ring-hard")}
      </div>
    </div>

    <!-- Submission Stats -->
    <div class="stats-section">
      <div class="section-title">// submission stats</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Submissions</div>
          <div class="stat-value all">${subs.all.toLocaleString()}</div>
          <div class="stat-sub">${solved.easy + solved.medium + solved.hard} problems solved</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Easy Submissions</div>
          <div class="stat-value easy">${subs.easy.toLocaleString()}</div>
          <div class="stat-sub">${analytics.difficulty?.[0]?.acceptanceRate ?? "—"}% acceptance</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Medium Submissions</div>
          <div class="stat-value medium">${subs.medium.toLocaleString()}</div>
          <div class="stat-sub">${analytics.difficulty?.[1]?.acceptanceRate ?? "—"}% acceptance</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Hard Submissions</div>
          <div class="stat-value hard">${subs.hard.toLocaleString()}</div>
          <div class="stat-sub">${analytics.difficulty?.[2]?.acceptanceRate ?? "—"}% acceptance</div>
        </div>
      </div>
    </div>

    <!-- Streak & Heatmap -->
    <div class="streak-section" id="dashboard-activity">
      <div class="section-title">// activity</div>
      <div class="streak-row">
        <div class="streak-pill">
          <div class="streak-icon">🔥</div>
          <div class="streak-info">
            <div class="streak-num">${analytics.streaks?.current ?? calData?.streak ?? "—"}</div>
            <div class="streak-lbl">Current Streak</div>
          </div>
        </div>
        <div class="streak-pill">
          <div class="streak-icon">📅</div>
          <div class="streak-info">
            <div class="streak-num">${analytics.streaks?.longest ?? "—"}</div>
            <div class="streak-lbl">Longest Streak</div>
          </div>
        </div>
        <div class="streak-pill">
          <div class="streak-icon">📅</div>
          <div class="streak-info">
            <div class="streak-num">${analytics.streaks?.totalActiveDays ?? calData?.totalActiveDays ?? "—"}</div>
            <div class="streak-lbl">Active Days</div>
          </div>
        </div>
      </div>
      <div class="heatmap-wrap">${heatmapHTML}</div>
    </div>

    <!-- Topics -->
    <div class="analytics-section" id="dashboard-topics">
      <div class="section-title">// topic strengths</div>
      <div class="topic-layout">
        <div class="topic-bars">
          ${topics.slice(0, 12).map(topic => `
            <div class="topic-row">
              <span class="topic-name">${escapeHTML(topic.topic)}</span>
              <div class="topic-track"><span style="width:${(topic.solved / maxTopicSolved) * 100}%"></span></div>
              <span class="topic-count">${topic.solved}</span>
            </div>`).join("") || `<div class="empty-state">No topic data available.</div>`}
        </div>

        <div class="analytics-section" id="dashboard-progress">
          <div class="section-title">// progress history</div>
          ${progress.length > 1 ? `
            <div class="progress-chart">
              <svg viewBox="0 0 600 150" role="img" aria-label="Solved problem growth">
                <polyline points="${progress.map((entry, index) => {
                  const max = Math.max(...progress.map(item => item.totalSolved), 1);
                  const x = (index / (progress.length - 1)) * 580 + 10;
                  const y = 135 - (entry.totalSolved / max) * 110;
                  return `${x},${y}`;
                }).join(" ")}" />
              </svg>
            </div>` : `<div class="muted">Daily snapshots will build this chart over time.</div>`}
        </div>

        <div class="analytics-section" id="dashboard-study">
          <div class="section-title">// recommended practice</div>
          <div class="recommendation-list">
            ${recommendations.map(problem => `<a class="recommendation-item" href="${problem.url}" target="_blank" rel="noopener"><strong>${escapeHTML(problem.title)}</strong><span>${escapeHTML(problem.topic)} · ${escapeHTML(problem.difficulty)}</span></a>`).join("") || `<div class="muted">No recommendations available.</div>`}
          </div>

          <div class="analytics-section" id="dashboard-platforms">
            <div class="section-title">// coding profile</div>
            <div id="platform-summary" class="muted">Loading Codeforces, CodeChef and GitHub…</div>
            <a class="study-plan-btn export-link" href="/api/user/${encodeURIComponent(username)}/report.pdf">Download PDF report</a>
          </div>
          <button class="study-plan-btn" id="study-plan-btn" type="button">Generate 7-day AI study plan</button>
          <div id="study-plan-output" class="study-plan-output" hidden></div>
        </div>
        <div class="weak-topics">
          <div class="analytics-label">Focus next</div>
          ${weakTopics.map(topic => `<span class="weak-topic">${escapeHTML(topic)}</span>`).join("") || `<span class="muted">No weak topics found.</span>`}
        </div>
      </div>
    </div>

    <!-- Contest history -->
    <div class="analytics-section" id="dashboard-contest">
      <div class="section-title">// contest rating</div>
      <div class="contest-summary">
        <div><strong>${analytics.contests?.contestsAttended || 0}</strong><span>attended</span></div>
        <div><strong>${analytics.contests?.bestRank ? `#${analytics.contests.bestRank.toLocaleString()}` : "—"}</strong><span>best rank</span></div>
        <div><strong>+${analytics.contests?.biggestRatingGain || 0}</strong><span>biggest gain</span></div>
        <div><strong>${analytics.contests?.biggestRatingDrop || 0}</strong><span>biggest drop</span></div>
      </div>
      ${contestHistory.length > 1 ? `
        <div class="rating-chart" aria-label="Contest rating history">
          <svg viewBox="0 0 600 180" role="img">
            <polyline points="${contestHistory.map((contest, index) => {
              const x = (index / (contestHistory.length - 1)) * 580 + 10;
              const y = 165 - ((contest.rating - minRating) / ratingRange) * 140;
              return `${x},${y}`;
            }).join(" ")}" />
            ${contestHistory.map((contest, index) => {
              const x = (index / (contestHistory.length - 1)) * 580 + 10;
              const y = 165 - ((contest.rating - minRating) / ratingRange) * 140;
              return `<circle cx="${x}" cy="${y}" r="3" aria-label="${escapeHTML(contest.title)}: ${contest.rating}" />`;
            }).join("")}
          </svg>
        </div>` : `<div class="empty-state">Not enough contest history to draw a graph.</div>`}
    </div>

    <!-- Recent Submissions -->
    <div class="recent-section" id="dashboard-recent">
      <div class="section-title">// recent submissions</div>
      <div class="recent-list">${recentHTML}</div>
    </div>
    <div class="workspace-grid">
      <section class="workspace-card" id="dashboard-leaderboard">
        <div class="section-title">// leaderboard</div>
        <p class="workspace-copy">Create a group code and compare progress with your cohort.</p>
        <div class="workspace-form">
          <input id="group-code-input" maxlength="32" placeholder="Group code" aria-label="Group code" />
          <button id="leaderboard-btn" class="dashboard-action primary" type="button">View group</button>
        </div>
        <div id="leaderboard-output" class="workspace-output muted">No group loaded yet.</div>
      </section>
      <section class="workspace-card" id="dashboard-settings">
        <div class="section-title">// goals & settings</div>
        <p class="workspace-copy">Set a daily solving target for ${escapeHTML(username)}.</p>
        <div class="workspace-form">
          <input id="daily-goal-input" type="number" min="1" max="100" value="1" aria-label="Daily solving target" />
          <button id="goal-btn" class="dashboard-action primary" type="button">Save goal</button>
        </div>
        <div id="goal-output" class="workspace-output muted">Loading goal…</div>
      </section>
    </div>
    </div>
  `;

  // Animate rings after render
  animateRing("ring-easy",   solved.easy,   totals.easy);
  animateRing("ring-medium", solved.medium, totals.medium);
  animateRing("ring-hard",   solved.hard,   totals.hard);
}

// ── Fetch pipeline ─────────────────────────────────────────────────────────
async function fetchAll(username) {
  showSkeleton();
  try {
    const [userRes, calRes, recentRes, progressRes, recommendationsRes] = await Promise.allSettled([
      fetch(`${API_BASE}/api/user/${username}`),
      fetch(`${API_BASE}/api/user/${username}/calendar`),
      fetch(`${API_BASE}/api/user/${username}/recent`),
      fetch(`${API_BASE}/api/user/${username}/progress?days=30`),
      fetch(`${API_BASE}/api/user/${username}/recommendations`),
    ]);

    // Main user data is required
    if (userRes.status === "rejected" || !userRes.value.ok) {
      if (userRes.status === "rejected") {
        const error = new Error("The server is waking up or unreachable. Please try again in a few seconds.");
        error.retryable = true;
        throw error;
      }
      const errorData = await userRes.value.json().catch(() => ({}));
      const error = new Error(errorData.message || errorData.error || "Unable to load this profile.");
      error.retryable = errorData.retryable !== false;
      throw error;
    }

    const userData   = await userRes.value.json();
    const calData    = calRes.status === "fulfilled" && calRes.value.ok
      ? await calRes.value.json() : null;
    const recentData = recentRes.status === "fulfilled" && recentRes.value.ok
      ? await recentRes.value.json() : [];
    const progressData = progressRes.status === "fulfilled" && progressRes.value.ok
      ? await progressRes.value.json() : { history: [] };
    const recommendationsData = recommendationsRes.status === "fulfilled" && recommendationsRes.value.ok
      ? await recommendationsRes.value.json() : { problems: [] };

    render(userData, calData, recentData, username, progressData.history, recommendationsData.problems);
    const platformSummary = document.getElementById("platform-summary");
    fetch(`${API_BASE}/api/user/${encodeURIComponent(username)}/platforms`)
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.message || data.error || "Platforms unavailable");
        platformSummary.innerHTML = `<strong>Combined score: ${data.combinedScore}</strong><br>${Object.values(data.platforms).map(platform => `${escapeHTML(platform.provider)}: ${platform.available ? "available" : escapeHTML(platform.error)}`).join(" · ")}`;
      })
      .catch(error => { platformSummary.textContent = error.message; });
    document.getElementById("study-plan-btn")?.addEventListener("click", async (event) => {
      const output = document.getElementById("study-plan-output");
      event.currentTarget.disabled = true;
      output.hidden = false;
      output.textContent = "Generating a plan…";
      try {
        const response = await fetch(`${API_BASE}/api/user/${username}/study-plan`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || "Unable to generate a plan.");
        output.textContent = data.plan;
      } catch (error) {
        output.textContent = error.message;
      } finally {
        event.currentTarget.disabled = false;
      }
    });
    document.getElementById("profile-compare-btn")?.addEventListener("click", () => {
      compareInput?.focus();
    });
    const goalOutput = document.getElementById("goal-output");
    fetch(`${API_BASE}/api/user/${encodeURIComponent(username)}/goal`)
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.message || data.error || "Unable to load goal.");
        const goal = data.goal || {};
        const goalInput = document.getElementById("daily-goal-input");
        if (goal.dailyTarget) goalInput.value = goal.dailyTarget;
        goalOutput.textContent = goal.dailyTarget ? `${goal.dailyTarget} problem${goal.dailyTarget === 1 ? "" : "s"} per day` : "No daily goal set.";
      })
      .catch(error => { goalOutput.textContent = error.message; });
    document.getElementById("goal-btn")?.addEventListener("click", async event => {
      const goalInput = document.getElementById("daily-goal-input");
      const dailyTarget = Number(goalInput.value);
      event.currentTarget.disabled = true;
      try {
        const response = await fetch(`${API_BASE}/api/user/${encodeURIComponent(username)}/goal`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dailyTarget, remindersEnabled: false }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || "Unable to save goal.");
        goalOutput.textContent = `Saved: ${data.goal.dailyTarget} problem${data.goal.dailyTarget === 1 ? "" : "s"} per day`;
      } catch (error) {
        goalOutput.textContent = error.message;
      } finally {
        event.currentTarget.disabled = false;
      }
    });
    document.getElementById("leaderboard-btn")?.addEventListener("click", async event => {
      const code = document.getElementById("group-code-input").value.trim();
      const output = document.getElementById("leaderboard-output");
      if (!/^[a-zA-Z0-9_-]{3,32}$/.test(code)) {
        output.textContent = "Use a group code with 3–32 letters, numbers, _ or -.";
        return;
      }
      event.currentTarget.disabled = true;
      output.textContent = "Loading group…";
      try {
        const joinResponse = await fetch(`${API_BASE}/api/groups/${encodeURIComponent(code)}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username }),
        });
        const joinData = await joinResponse.json().catch(() => ({}));
        if (!joinResponse.ok) throw new Error(joinData.message || joinData.error || "Sign in to join this group.");
        const response = await fetch(`${API_BASE}/api/groups/${encodeURIComponent(code)}/leaderboard`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || "Unable to load leaderboard.");
        output.innerHTML = data.leaderboard.length
          ? data.leaderboard.map((member, index) => `<div class="leaderboard-row"><strong>#${index + 1} @${escapeHTML(member.username)}</strong><span>${member.solved} solved · ${member.streak} day streak</span></div>`).join("")
          : "No members in this group yet.";
      } catch (error) {
        output.textContent = error.message;
      } finally {
        event.currentTarget.disabled = false;
      }
    });
  } catch (err) {
    renderError(err.message, err.retryable !== false);
  }
}

// ── Events ───────────────────────────────────────────────────────────────────
let debounceTimer;

async function handleSearch() {
  const username = userInput.value.trim();
  const err = validate(username);
  if (err) { searchHint.textContent = err; return; }
  searchHint.textContent = "";
  setLoading(true);
  if (selectedPlatform === "leetcode") {
    await fetchAll(username);
  } else {
    await fetchPlatformProfile(username, selectedPlatform);
  }
  setLoading(false);
}

searchBtn.addEventListener("click", handleSearch);
compareBtn.addEventListener("click", async () => {
  const first = userInput.value.trim();
  const second = compareInput.value.trim();
  const firstError = validate(first);
  const secondError = validate(second);
  if (firstError || secondError) {
    searchHint.textContent = firstError || secondError;
    return;
  }
  setLoading(true);
  compareBtn.disabled = true;
  results.innerHTML = `<div class="skeleton-section">Loading comparison…</div>`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}/api/compare/${encodeURIComponent(first)}/${encodeURIComponent(second)}?platform=${encodeURIComponent(selectedPlatform)}`, {
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "Unable to compare profiles.");
    if (!Array.isArray(data.users) || data.users.length !== 2) {
      throw new Error("The comparison response was incomplete. Please try again.");
    }
    const [firstUser, secondUser] = data.users;
    const winner = (a, b, key) => Number(a[key] || 0) >= Number(b[key] || 0) ? "winner" : "";
    const metricRows = user => {
      if (data.platform === "leetcode") {
        return `<span><b>${user.solved}</b> solved</span>
          <span><b>${user.streaks.current}</b> day streak</span>
          <span><b>${user.contestRating ? Math.round(user.contestRating) : "—"}</b> contest rating</span>`;
      }
      const metrics = {
        codeforces: [["rating", "rating"], ["solved", "solved"], ["submissions", "submissions"]],
        codechef: [["rating", "rating"], ["solved", "solved"], ["globalRank", "global rank"]],
        github: [["repositories", "repositories"], ["followers", "followers"], ["publicGists", "public gists"]],
      }[data.platform] || [];
      return metrics.map(([key, label]) => `<span><b>${user[key] ?? "—"}</b> ${label}</span>`).join("");
    };
    const leadingKey = data.platform === "leetcode"
      ? "solved"
      : data.platform === "github"
        ? "repositories"
        : "rating";
    results.innerHTML = `
      <div class="comparison-workspace">
        <div class="dashboard-intro"><div><span class="section-kicker">Compare</span><h2>Head-to-head ${escapeHTML(data.platform)}</h2></div><span class="ui-badge">Live comparison</span></div>
      <div class="analytics-section">
        <div class="section-title">// head-to-head</div>
        <div class="comparison-grid">${data.users.map(user => `
          <div class="comparison-user ${user === firstUser ? winner(firstUser, secondUser, leadingKey) : winner(secondUser, firstUser, leadingKey)}">
            <strong>@${escapeHTML(user.username)}</strong>
            ${metricRows(user)}
          </div>`).join("")}</div>
      </div>
      </div>`;
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Comparison timed out. LeetCode may be waking up or unavailable; please try again."
      : error.message;
    results.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><div class="err-msg">${escapeHTML(message)}</div></div>`;
  } finally {
    clearTimeout(timeout);
    compareBtn.disabled = false;
    setLoading(false);
  }
});
userInput.addEventListener("keydown", e => {
  if (e.key === "Enter") handleSearch();
});
userInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { searchHint.textContent = ""; }, 300);
});
