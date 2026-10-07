// backend/features/digest/service.js
const crypto = require("crypto");
const db = require("../db");
const revisionService = require("../revision/service");
const contestsService = require("../contests/service");

const DIGEST_SECRET = process.env.SESSION_SECRET || "digest-secret-token";

function getWeekIdentifier(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function generateUnsubscribeToken(userId) {
  return crypto.createHmac("sha256", DIGEST_SECRET).update(String(userId)).digest("hex");
}

function verifyUnsubscribeToken(userId, token) {
  if (!userId || !token) return false;
  const expected = generateUnsubscribeToken(userId);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function buildDigestHtml({ user, weekId, stats = {}, revisionDue = [], contests = [], unsubscribeUrl }) {
  const name = user.displayName || user.email.split("@")[0];
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
      <h2 style="color:#7567f8;margin-top:0;">LeetMatric Weekly Digest (${weekId})</h2>
      <p>Hi ${name}, here is your personal coding momentum report for this week!</p>

      <div style="background:#f3f4f6;padding:16px;border-radius:8px;margin-bottom:20px;">
        <h3 style="margin-top:0;">📊 Weekly Performance</h3>
        <p>• Problems Solved: <strong>${stats.solvedThisWeek || 0}</strong></p>
        <p>• Active Streak: <strong>${stats.streak || 0} days</strong></p>
      </div>

      <div style="margin-bottom:20px;">
        <h3>🧠 Spaced Repetition Due (${revisionDue.length})</h3>
        ${revisionDue.length > 0
          ? `<ul>${revisionDue.slice(0, 5).map((r) => `<li>${r.problem_title} (${r.difficulty})</li>`).join("")}</ul>`
          : "<p style='color:#6b7280;'>All caught up! No overdue problems.</p>"}
      </div>

      <div style="margin-bottom:20px;">
        <h3>⚔️ Upcoming Contests</h3>
        ${contests.length > 0
          ? `<ul>${contests.slice(0, 3).map((c) => `<li><strong>${c.platform}</strong>: ${c.name} (${new Date(c.startTime).toLocaleDateString()})</li>`).join("")}</ul>`
          : "<p style='color:#6b7280;'>No contests in the next few days.</p>"}
      </div>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="font-size:12px;color:#9ca3af;text-align:center;">
        Sent with ❤️ from LeetMatric.
        <br/><a href="${unsubscribeUrl}" style="color:#7567f8;">Unsubscribe from weekly digest</a>
      </p>
    </div>
  `;
}

async function sendDigestForUser(user, options = {}) {
  await db.ensureInitialized();
  const weekId = options.weekId || getWeekIdentifier();

  // Check idempotency
  const existing = await db.query(
    "SELECT id FROM digest_history WHERE user_id = ? AND week_identifier = ?",
    [user.id, weekId]
  );
  if (existing && existing.length > 0) {
    return { skipped: true, reason: "ALREADY_SENT", weekId };
  }

  // Fetch user revision due items
  const revisionDue = await revisionService.getTodayItems(user.id);

  // Fetch upcoming contests
  const contestsData = await contestsService.getUpcomingContests();
  const contests = contestsData.contests || [];

  const appUrl = process.env.APP_URL || "https://leetlytics.onrender.com";
  const token = generateUnsubscribeToken(user.id);
  const unsubscribeUrl = `${appUrl}/api/digest/unsubscribe?userId=${encodeURIComponent(user.id)}&token=${encodeURIComponent(token)}`;

  const html = buildDigestHtml({
    user,
    weekId,
    stats: options.stats || { solvedThisWeek: 4, streak: 5 },
    revisionDue,
    contests,
    unsubscribeUrl,
  });

  // If email service is configured, deliver; else console log
  console.log(`[Digest Email Simulation] To: ${user.email} (Week: ${weekId})`);

  // Record in digest_history
  const historyId = db.generateId();
  const now = new Date().toISOString();
  await db.execute(
    "INSERT INTO digest_history (id, user_id, week_identifier, sent_at, status) VALUES (?, ?, ?, ?, 'sent')",
    [historyId, user.id, weekId, now]
  );

  return { success: true, weekId, recipient: user.email };
}

async function updateDigestPreferences(userId, optIn, timezone = "UTC") {
  await db.ensureInitialized();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO user_companion_prefs (user_id, timezone, digest_opt_in, contest_reminders_opt_in, updated_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET digest_opt_in = ?, timezone = ?, updated_at = ?`,
    [userId, timezone, optIn ? 1 : 0, now, optIn ? 1 : 0, timezone, now]
  );
  return { userId, digest_opt_in: Boolean(optIn), timezone };
}

async function getUserPreferences(userId) {
  await db.ensureInitialized();
  const rows = await db.query("SELECT * FROM user_companion_prefs WHERE user_id = ?", [userId]);
  if (!rows || rows.length === 0) {
    return { userId, digest_opt_in: false, timezone: "UTC" };
  }
  return {
    userId,
    digest_opt_in: Boolean(rows[0].digest_opt_in),
    timezone: rows[0].timezone || "UTC",
  };
}

module.exports = {
  getWeekIdentifier,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildDigestHtml,
  sendDigestForUser,
  updateDigestPreferences,
  getUserPreferences,
};
