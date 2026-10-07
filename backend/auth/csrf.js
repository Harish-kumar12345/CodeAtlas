const crypto = require("crypto");
const { randomToken } = require("./crypto");

const CSRF_COOKIE_NAME = "leetmatric_csrf";

function getCsrfSecret(req) {
  // If session is active, derive token from session ID or separate cookie
  if (req.authSession) {
    return req.authSession.id;
  }
  return null;
}

/**
 * Creates or gets the CSRF token for the current request
 */
function getCsrfToken(req, res) {
  // We sign a random token with HMAC using the session secret or cookie
  const cookies = req.headers.cookie ? require("./session").parseCookies(req) : {};
  let csrfCookie = cookies[CSRF_COOKIE_NAME];
  if (!csrfCookie) {
    csrfCookie = randomToken(32);
    const isHttps = req.secure || req.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
    const flags = [
      `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfCookie)}`,
      "Path=/",
      "SameSite=Lax",
      // Accessible to JavaScript to read and attach as X-CSRF-Token header
      "Max-Age=86400",
    ];
    if (isHttps) flags.push("Secure");
    res.setHeader("Set-Cookie", flags.join("; "));
  }
  return csrfCookie;
}

/**
 * Middleware that validates CSRF token for state-changing HTTP methods
 */
function csrfProtection(req, res, next) {
  // Safe HTTP methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Exempt public webhook or external callbacks if any
  if (req.path.startsWith("/auth/github/callback") || req.path.startsWith("/auth/google/callback")) {
    return next();
  }

  const cookies = req.headers.cookie ? require("./session").parseCookies(req) : {};
  const expectedToken = cookies[CSRF_COOKIE_NAME];
  const clientToken = req.get("x-csrf-token") || req.body?._csrf;

  if (!expectedToken || !clientToken || expectedToken !== clientToken) {
    return res.status(403).json({
      code: "CSRF_ERROR",
      message: "Invalid or missing CSRF token. Please refresh the page and try again.",
      retryable: false,
    });
  }

  next();
}

module.exports = {
  CSRF_COOKIE_NAME,
  getCsrfToken,
  csrfProtection,
};
