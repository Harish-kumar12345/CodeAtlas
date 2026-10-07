// frontend/public/companion.js - Daily Prep Companion Frontend Progressive Enhancement
(function () {
  let activeFlags = {};

  async function checkFlags() {
    try {
      const res = await fetch("/api/features");
      if (res.ok) {
        activeFlags = await res.json();
      }
    } catch {
      activeFlags = {};
    }
  }

  function getOrCreateCompanionContainer() {
    let container = document.getElementById("dashboard-companion-shelf");
    if (!container) {
      const resultsEl = document.getElementById("results");
      if (!resultsEl || !resultsEl.parentNode) return null;
      container = document.createElement("div");
      container.id = "dashboard-companion-shelf";
      container.className = "dashboard-shell";
      container.style.marginTop = "1.5rem";
      resultsEl.parentNode.insertBefore(container, resultsEl.nextSibling);
    }
    return container;
  }

  // 1. Revision List Component
  async function mountRevision(container) {
    if (!activeFlags.revision) return;
    try {
      const res = await fetch("/api/revision");
      if (!res.ok) return;
      const data = await res.json();
      const items = data.todayItems || [];

      const section = document.createElement("section");
      section.className = "companion-card";
      section.id = "companion-revision-section";
      section.innerHTML = `
        <div class="companion-header">
          <div class="companion-title">
            <span>🧠</span> Revise Today (${items.length})
          </div>
          <span class="companion-badge">Spaced Repetition</span>
        </div>
        ${items.length === 0 ? `
          <div class="muted" style="padding:1rem 0;">All caught up! No problems due for review today. Add one below to start your recall cycle.</div>
        ` : `
          <div class="companion-grid">
            ${items.map(item => `
              <div class="companion-item" id="rev-${item.id}">
                <div style="font-weight:700;font-size:0.95rem;">${item.problem_title}</div>
                <div style="font-size:0.75rem;color:var(--text2);">${item.topic || "DSA"} · <span class="tag-${(item.difficulty || "medium").toLowerCase()}">${item.difficulty}</span></div>
                <div style="font-size:0.72rem;color:var(--text3);">Interval: ${item.interval_days}d · Reps: ${item.repetitions}</div>
                <div class="companion-actions">
                  <button class="companion-btn-sm easy" data-rev-id="${item.id}" data-rating="easy">Easy</button>
                  <button class="companion-btn-sm medium" data-rev-id="${item.id}" data-rating="medium">Medium</button>
                  <button class="companion-btn-sm hard" data-rev-id="${item.id}" data-rating="hard">Hard</button>
                  <a href="https://leetcode.com/problems/${item.problem_slug}/" target="_blank" rel="noopener" class="companion-btn-sm">Solve ↗</a>
                </div>
              </div>
            `).join("")}
          </div>
        `}
        <div style="margin-top:1.25rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
          <input id="manual-rev-slug" placeholder="Problem slug (e.g. coin-change)" style="padding:0.4rem 0.75rem;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.8rem;flex:1;min-width:200px;" />
          <button id="manual-rev-btn" class="dashboard-action primary" style="font-size:0.78rem;padding:0.4rem 0.85rem;">Add to Revision</button>
        </div>
      `;

      container.appendChild(section);

      // Event listeners for reviews
      section.querySelectorAll("[data-rev-id]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          const id = e.currentTarget.dataset.revId;
          const rating = e.currentTarget.dataset.rating;
          try {
            const reviewRes = await fetch(`/api/revision/${id}/review`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ recallRating: rating }),
            });
            if (reviewRes.ok) {
              const card = document.getElementById(`rev-${id}`);
              if (card) {
                card.style.opacity = "0.5";
                card.innerHTML = `<span style="color:var(--success);font-weight:600;font-size:0.8rem;">✓ Marked as ${rating}! Next review scheduled.</span>`;
              }
            }
          } catch {}
        });
      });

      // Manual add
      document.getElementById("manual-rev-btn")?.addEventListener("click", async () => {
        const input = document.getElementById("manual-rev-slug");
        const slug = input.value.trim().toLowerCase();
        if (!slug) return;
        try {
          const addRes = await fetch("/api/revision", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ problemSlug: slug, problemTitle: slug.replace(/-/g, " ") }),
          });
          if (addRes.ok) {
            input.value = "";
            location.reload();
          }
        } catch {}
      });
    } catch {}
  }

  // 2. Upcoming Contests Component
  async function mountContests(container) {
    if (!activeFlags.contests) return;
    try {
      const res = await fetch("/api/contests");
      if (!res.ok) return;
      const data = await res.json();
      const contests = (data.contests || []).slice(0, 4);

      const section = document.createElement("section");
      section.className = "companion-card";
      section.id = "companion-contests-section";
      section.innerHTML = `
        <div class="companion-header">
          <div class="companion-title">
            <span>⚔️</span> Upcoming Contests
          </div>
          <span class="companion-badge">Live Countdown</span>
        </div>
        ${contests.length === 0 ? `
          <div class="muted" style="padding:1rem 0;">No upcoming contests detected right now.</div>
        ` : `
          <div class="companion-grid">
            ${contests.map(c => {
              const start = new Date(c.startTime);
              return `
                <div class="companion-item">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="platform-badge ${c.platform.toLowerCase()}" style="font-size:0.65rem;">${c.platform}</span>
                    <span style="font-size:0.72rem;color:var(--text3);">${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <strong style="font-size:0.9rem;margin-top:0.25rem;">${c.name}</strong>
                  <div class="companion-actions" style="margin-top:auto;">
                    <a href="${c.url}" target="_blank" rel="noopener" class="companion-btn-sm">Enter Arena ↗</a>
                    <a href="${c.googleCalendarUrl}" target="_blank" rel="noopener" class="companion-btn-sm">+ Google Cal</a>
                    <a href="/api/contests/${c.id}/ics" class="companion-btn-sm">.ICS</a>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `}
      `;
      container.appendChild(section);
    } catch {}
  }

  // 3. Badges & XP Component
  async function mountBadges(container) {
    if (!activeFlags.badges) return;
    try {
      const res = await fetch("/api/badges");
      if (!res.ok) return;
      const data = await res.json();
      const xp = data.xp || { level: 1, totalXP: 0, percentage: 0 };
      const badges = data.badges || data.definitions || [];

      const section = document.createElement("section");
      section.className = "companion-card";
      section.id = "companion-badges-section";
      section.innerHTML = `
        <div class="companion-header">
          <div class="companion-title">
            <span>🏆</span> Level & Milestone Badges
          </div>
          <span class="companion-badge">Level ${xp.level || 1} (${xp.totalXP || 0} XP)</span>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text2);">
            <span>Level Progress</span>
            <span>${xp.percentage || 0}%</span>
          </div>
          <div class="xp-bar-wrap">
            <div class="xp-bar-fill" style="width: ${xp.percentage || 0}%;"></div>
          </div>
        </div>
        <div class="badges-row">
          ${badges.map(b => `
            <div class="badge-pill ${b.earned ? "" : "locked"}" title="${b.description || ""}">
              <span>${b.icon || "🏅"}</span>
              <strong>${b.name}</strong>
            </div>
          `).join("")}
        </div>
      `;
      container.appendChild(section);
    } catch {}
  }

  // 4. Mock Interview Component
  async function mountMock(container) {
    if (!activeFlags.mock) return;
    const section = document.createElement("section");
    section.className = "companion-card";
    section.id = "companion-mock-section";
    section.innerHTML = `
      <div class="companion-header">
        <div class="companion-title">
          <span>⏱️</span> Mock Interview Arena
        </div>
        <span class="companion-badge">Timed Practice</span>
      </div>
      <p style="font-size:0.82rem;color:var(--text2);margin:0 0 1rem;">Simulate a real coding interview under time pressure with 2 targeted problems.</p>
      <div id="mock-arena-content" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <select id="mock-diff-select" style="padding:0.45rem 0.75rem;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.8rem;">
          <option value="Easy">Easy (Warmup)</option>
          <option value="Medium" selected>Medium (Standard)</option>
          <option value="Hard">Hard (Challenging)</option>
        </select>
        <select id="mock-dur-select" style="padding:0.45rem 0.75rem;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.8rem;">
          <option value="30">30 minutes</option>
          <option value="45" selected>45 minutes</option>
          <option value="60">60 minutes</option>
        </select>
        <button id="mock-start-btn" class="dashboard-action primary" style="font-size:0.8rem;padding:0.45rem 1rem;">Start Mock Session</button>
      </div>
      <div id="mock-active-panel" hidden style="margin-top:1rem;"></div>
    `;
    container.appendChild(section);

    document.getElementById("mock-start-btn")?.addEventListener("click", async () => {
      const diff = document.getElementById("mock-diff-select").value;
      const dur = document.getElementById("mock-dur-select").value;
      try {
        const res = await fetch("/api/mock/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetDifficulty: diff, durationMinutes: dur }),
        });
        if (res.status === 401) {
          alert("Please sign in to save mock interview sessions.");
          return;
        }
        if (res.ok) {
          const data = await res.json();
          renderActiveMock(data.session);
        }
      } catch {}
    });

    function renderActiveMock(session) {
      const panel = document.getElementById("mock-active-panel");
      if (!panel) return;
      panel.hidden = false;

      let currentSession = session;
      let remaining = currentSession.timer?.remainingSeconds ?? (currentSession.duration_minutes * 60);

      if (window._mockTimerInterval) clearInterval(window._mockTimerInterval);
      window._mockTimerInterval = setInterval(() => {
        const clockEl = document.getElementById("mock-clock");
        if (remaining <= 0) {
          clearInterval(window._mockTimerInterval);
          if (clockEl) clockEl.textContent = "00:00 (Time's Up)";
          return;
        }
        remaining--;
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        if (clockEl) {
          clockEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        }
      }, 1000);

      function renderProblemList() {
        return (currentSession.problems || []).map(p => {
          const isSolved = p.status === "solved";
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 1rem;background:var(--surface);border-radius:var(--radius-sm);border:1px solid ${isSolved ? 'var(--success)' : 'var(--border)'};gap:10px;flex-wrap:wrap;">
              <div>
                <strong>${p.problem_title}</strong>
                <span style="font-size:0.75rem;color:var(--text2);margin-left:0.5rem;">(${p.difficulty} · ${p.topic})</span>
                <div style="font-size:0.72rem;margin-top:2px;color:${isSolved ? 'var(--success)' : 'var(--text3)'};">
                  ${isSolved ? "✅ Marked as Solved" : "⚪ Incomplete"}
                </div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <a href="${p.url}" target="_blank" rel="noopener" class="companion-btn-sm">Open on LeetCode ↗</a>
                <button class="companion-btn-sm mock-toggle-btn" data-slug="${p.problem_slug}" data-status="${isSolved ? 'unsolved' : 'solved'}" style="cursor:pointer;padding:0.35rem 0.75rem;border-radius:var(--radius-sm);background:${isSolved ? 'var(--success)' : 'var(--surface2)'};color:${isSolved ? '#fff' : 'var(--text)'};border:1px solid ${isSolved ? 'var(--success)' : 'var(--border2)'};font-weight:600;">
                  ${isSolved ? "✅ Solved" : "Mark Solved"}
                </button>
              </div>
            </div>
          `;
        }).join("");
      }

      function updatePanelHTML() {
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        panel.innerHTML = `
          <div style="background:var(--surface2);padding:1.25rem;border-radius:var(--radius);border:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:8px;">
              <div>
                <strong style="font-size:0.95rem;">Mock Session in Progress</strong>
                <div style="font-size:0.72rem;color:var(--text3);margin-top:2px;">Solve problems on LeetCode, then click 'Mark Solved' below before finishing.</div>
              </div>
              <span class="mock-timer" id="mock-clock">${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}</span>
            </div>
            <div id="mock-problems-container" style="display:grid;gap:0.6rem;margin-top:0.75rem;">
              ${renderProblemList()}
            </div>
            <div style="margin-top:1.25rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
              <button id="mock-finish-btn" class="dashboard-action primary" style="padding:0.5rem 1.25rem;font-size:0.85rem;">Complete & View Report</button>
              <span style="font-size:0.72rem;color:var(--text3);">Results are self-reported for mock practice.</span>
            </div>
          </div>
        `;
        bindEvents();
      }

      function bindEvents() {
        panel.querySelectorAll(".mock-toggle-btn").forEach(btn => {
          btn.addEventListener("click", async () => {
            const slug = btn.getAttribute("data-slug");
            const newStatus = btn.getAttribute("data-status");
            btn.disabled = true;
            btn.textContent = "Updating...";
            try {
              const res = await fetch(`/api/mock/sessions/${currentSession.id}/problems/${slug}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
              });
              if (res.ok) {
                const data = await res.json();
                currentSession = data.session;
                updatePanelHTML();
              } else {
                btn.disabled = false;
                btn.textContent = newStatus === "solved" ? "Mark Solved" : "✅ Solved";
              }
            } catch {
              btn.disabled = false;
            }
          });
        });

        document.getElementById("mock-finish-btn")?.addEventListener("click", async () => {
          const btn = document.getElementById("mock-finish-btn");
          if (btn) {
            btn.disabled = true;
            btn.textContent = "Calculating Score...";
          }
          if (window._mockTimerInterval) clearInterval(window._mockTimerInterval);
          try {
            const finRes = await fetch(`/api/mock/sessions/${currentSession.id}/finish`, { method: "POST" });
            if (finRes.ok) {
              const finished = await finRes.json();
              renderMockReport(finished.session);
            } else {
              if (btn) {
                btn.disabled = false;
                btn.textContent = "Complete & View Report";
              }
            }
          } catch {
            if (btn) {
              btn.disabled = false;
              btn.textContent = "Complete & View Report";
            }
          }
        });
      }

      function renderMockReport(finishedSession) {
        const solved = (finishedSession.problems || []).filter(p => p.status === "solved").length;
        const total = finishedSession.problems?.length || 2;
        const score = finishedSession.score || 0;
        const feedback = finishedSession.ai_feedback || {};

        panel.innerHTML = `
          <div style="background:var(--surface2);padding:1.5rem;border-radius:var(--radius);border:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:1rem;">
              <div>
                <span class="companion-badge" style="background:${score >= 50 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'};color:${score >= 50 ? 'var(--success)' : 'var(--accent)'};font-size:0.8rem;padding:0.3rem 0.8rem;">
                  Mock Interview Complete
                </span>
                <h3 style="margin:0.5rem 0 0.2rem;font-size:1.15rem;">Session Summary</h3>
                <div style="font-size:0.75rem;color:var(--text3);">Self-reported performance across ${total} problems</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:2.2rem;font-weight:800;color:${score >= 50 ? 'var(--success)' : 'var(--accent)'};line-height:1;">${score}%</div>
                <div style="font-size:0.75rem;color:var(--text2);margin-top:2px;">${solved}/${total} Problems Solved</div>
              </div>
            </div>

            <div style="background:var(--surface);padding:1rem;border-radius:var(--radius-sm);border:1px solid var(--border2);margin-bottom:1rem;">
              <strong style="font-size:0.85rem;color:var(--text);">AI Readiness Feedback:</strong>
              <p style="font-size:0.82rem;color:var(--text2);margin:0.35rem 0 0.25rem;line-height:1.5;">${feedback.verdict || "Session finished."}</p>
              ${feedback.tips ? `<div style="font-size:0.78rem;color:var(--accent2);margin-top:0.25rem;">💡 <em>${feedback.tips}</em></div>` : ""}
            </div>

            <div style="display:grid;gap:0.5rem;margin-bottom:1.25rem;">
              ${(finishedSession.problems || []).map(p => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.85rem;background:var(--surface);border-radius:var(--radius-sm);">
                  <div>
                    <strong style="font-size:0.88rem;">${p.problem_title}</strong>
                    <span style="font-size:0.72rem;color:var(--text3);margin-left:0.4rem;">(${p.difficulty} · ${p.topic})</span>
                  </div>
                  <span style="font-size:0.78rem;font-weight:600;color:${p.status === 'solved' ? 'var(--success)' : 'var(--text3)'};">
                    ${p.status === 'solved' ? '✅ Solved' : '❌ Unsolved'}
                  </span>
                </div>
              `).join("")}
            </div>

            <button id="mock-restart-btn" class="dashboard-action secondary" style="font-size:0.8rem;padding:0.45rem 1rem;">Start Another Mock</button>
          </div>
        `;

        document.getElementById("mock-restart-btn")?.addEventListener("click", () => {
          panel.hidden = true;
          panel.innerHTML = "";
        });
      }

      updatePanelHTML();
    }
  }

  // Main lifecycle
  async function init() {
    await checkFlags();
    const hasAnyFlag = Object.values(activeFlags).some(Boolean);
    if (!hasAnyFlag) return; // Zero layout shift when all flags are off

    function checkAndMount() {
      const resultsEl = document.getElementById("results");
      const hasDashboard = resultsEl && (resultsEl.querySelector(".profile-card") || resultsEl.querySelector(".platform-profile-card"));
      let container = document.getElementById("dashboard-companion-shelf");

      if (hasDashboard) {
        if (!container) {
          container = getOrCreateCompanionContainer();
        }
        if (container && !container.dataset.mounted) {
          container.dataset.mounted = "true";
          container.innerHTML = "";
          mountRevision(container);
          mountContests(container);
          mountBadges(container);
          mountMock(container);
        }
      } else if (container && resultsEl && resultsEl.querySelector(".skeleton-section")) {
        // Hide while loading a new search
        container.style.display = "none";
      } else if (container && hasDashboard) {
        container.style.display = "";
      }
    }

    const targetNode = document.getElementById("results");
    if (targetNode) {
      const observer = new MutationObserver(checkAndMount);
      observer.observe(targetNode, { childList: true, subtree: true });
    }
    checkAndMount();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
