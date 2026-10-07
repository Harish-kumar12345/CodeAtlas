const { randomToken } = require("./crypto");
const authDb = require("./db");

const COOKIE_NAME = "leetmatric_session";
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours idle
const DEFAULT_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REMEMBER_ME_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const key = parts.shift().trim();
    if (key) {
      list[key] = decodeURIComponent(parts.join("=").trim());
    }
  });
  return list;
}

function appendCookieHeader(res, cookieStr) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookieStr);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookieStr]);
  } else {
    res.setHeader("Set-Cookie", [existing, cookieStr]);
  }
}

function setSessionCookie(req, res, sessionId, rememberMe = false) {
  const maxAgeSeconds = Math.floor((rememberMe ? REMEMBER_ME_ABSOLUTE_MS : DEFAULT_ABSOLUTE_MS) / 1000);
  const isHttps = req.secure || req.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  const flags = [
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps) flags.push("Secure");
  appendCookieHeader(res, flags.join("; "));
}

function clearSessionCookie(req, res) {
  const isHttps = req.secure || req.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  const flags = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (isHttps) flags.push("Secure");
  appendCookieHeader(res, flags.join("; "));
}

/**
 * Creates a new session in database and sets the cookie
 */
async function startSession(req, res, user, rememberMe = false) {
  const sessionId = randomToken(32);
  const durationMs = rememberMe ? REMEMBER_ME_ABSOLUTE_MS : DEFAULT_ABSOLUTE_MS;
  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  const userAgent = (req.get("user-agent") || "").slice(0, 255);
  const ipAddress = (req.ip || req.connection?.remoteAddress || "").slice(0, 45);

  await authDb.createSession({
    id: sessionId,
    userId: user.id,
    userAgent,
    ipAddress,
    expiresAt,
  });

  setSessionCookie(req, res, sessionId, rememberMe);
  return sessionId;
}

/**
 * Rotates session ID on login to protect against session fixation attacks
 */
async function rotateSession(req, res, user, rememberMe = false) {
  const cookies = parseCookies(req);
  const oldSessionId = cookies[COOKIE_NAME];
  if (oldSessionId) {
    try {
      await authDb.deleteSession(oldSessionId);
    } catch {}
  }
  return startSession(req, res, user, rememberMe);
}

/**
 * Destroys current session and clears cookie
 */
async function endSession(req, res) {
  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_NAME];
  if (sessionId) {
    await authDb.deleteSession(sessionId);
  }
  clearSessionCookie(req, res);
}

/**
 * Destroys all sessions for a user
 */
async function endAllSessions(userId) {
  await authDb.deleteSessionsForUser(userId);
}

/**
 * Middleware to load current session if cookie is present
 */
async function sessionMiddleware(req, res, next) {
  req.authSession = null;
  req.authUser = null;

  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_NAME];
  if (!sessionId) return next();

  try {
    const session = await authDb.getSession(sessionId);
    if (!session) {
      clearSessionCookie(req, res);
      return next();
    }

    const now = Date.now();
    const expiresAt = new Date(session.expiresAt).getTime();
    const lastActiveAt = new Date(session.lastActiveAt).getTime();

    // Check absolute timeout
    if (now > expiresAt) {
      await authDb.deleteSession(sessionId);
      clearSessionCookie(req, res);
      return next();
    }

    // Check idle timeout
    if (now - lastActiveAt > IDLE_TIMEOUT_MS) {
      await authDb.deleteSession(sessionId);
      clearSessionCookie(req, res);
      return next();
    }

    // Update activity timestamp if more than 5 minutes since last active
    if (now - lastActiveAt > 5 * 60 * 1000) {
      await authDb.touchSession(sessionId);
    }

    req.authSession = session;
    req.authUser = session.user;
    next();
  } catch (error) {
    console.error("Session lookup error:", error);
    next();
  }
}

module.exports = {
  COOKIE_NAME,
  startSession,
  rotateSession,
  endSession,
  endAllSessions,
  sessionMiddleware,
  clearSessionCookie,
  parseCookies,
};
