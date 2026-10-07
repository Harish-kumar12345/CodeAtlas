const routes = require("./routes");
const { sessionMiddleware, clearSessionCookie, COOKIE_NAME } = require("./session");
const { csrfProtection, getCsrfToken } = require("./csrf");
const { requireAuth, requireRole } = require("./permissions");
const db = require("./db");
const crypto = require("./crypto");
const email = require("./email");
const oauth = require("./oauth");

module.exports = {
  routes,
  sessionMiddleware,
  clearSessionCookie,
  COOKIE_NAME,
  csrfProtection,
  getCsrfToken,
  requireAuth,
  requireRole,
  db,
  crypto,
  email,
  oauth,
};
