// backend/features/index.js - Entry point for Daily Prep Companion features
const { isFeatureEnabled, getAllFeatureFlags } = require("./flags");

function init(app) {
  // Public feature flags endpoint for client-side progressive enhancement
  app.get("/api/features", (_req, res) => {
    res.json(getAllFeatureFlags());
  });

  // 1. Spaced Repetition Revision List
  if (isFeatureEnabled("revision")) {
    const revisionRoutes = require("./revision/routes");
    app.use("/api/revision", revisionRoutes);
  }

  // 2. Upcoming Contests Calendar
  if (isFeatureEnabled("contests")) {
    const contestsRoutes = require("./contests/routes");
    app.use("/api/contests", contestsRoutes);
  }

  // 3. Badges, XP & Levels
  if (isFeatureEnabled("badges")) {
    const badgesRoutes = require("./badges/routes");
    app.use("/api/badges", badgesRoutes);
  }

  // 4. Mock Interview Mode
  if (isFeatureEnabled("mock")) {
    const mockRoutes = require("./mock/routes");
    app.use("/api/mock", mockRoutes);
  }

  // 5. AI Hint Mode
  if (isFeatureEnabled("hints")) {
    const hintsRoutes = require("./hints/routes");
    app.use("/api/hints", hintsRoutes);
  }

  // 6. Weekly Digest Email
  if (isFeatureEnabled("digest")) {
    const digestRoutes = require("./digest/routes");
    app.use("/api/digest", digestRoutes);
  }

  // 7. Problem Notes & Bookmarks
  if (isFeatureEnabled("notes")) {
    const notesRoutes = require("./notes/routes");
    app.use("/api/notes", notesRoutes);
  }
}

module.exports = {
  init,
  isFeatureEnabled,
  getAllFeatureFlags,
};
