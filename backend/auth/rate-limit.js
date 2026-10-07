/**
 * Abuse protection and rate limiting for new auth endpoints.
 * Keeps limits separate from existing general API limits.
 */

class MemoryRateLimiter {
  constructor() {
    this.hits = new Map();
    // Cleanup expired entries every 10 minutes
    setInterval(() => this.cleanup(), 10 * 60 * 1000).unref();
  }

  getKey(prefix, identifier) {
    return `${prefix}:${String(identifier || "").toLowerCase().trim()}`;
  }

  isLimited(prefix, identifier, maxAttempts, windowMs) {
    const key = this.getKey(prefix, identifier);
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || now > entry.resetAt) {
      return { limited: false, remaining: maxAttempts, resetAt: now + windowMs };
    }

    if (entry.count >= maxAttempts) {
      return { limited: true, remaining: 0, resetAt: entry.resetAt };
    }

    return { limited: false, remaining: maxAttempts - entry.count, resetAt: entry.resetAt };
  }

  recordAttempt(prefix, identifier, windowMs) {
    const key = this.getKey(prefix, identifier);
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || now > entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }

    entry.count += 1;
    return entry.count;
  }

  reset(prefix, identifier) {
    const key = this.getKey(prefix, identifier);
    this.hits.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.hits.entries()) {
      if (now > entry.resetAt) {
        this.hits.delete(key);
      }
    }
  }
}

const limiter = new MemoryRateLimiter();

// 15-minute lockout for 5 failed logins
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

// 1-hour window for signups (10 per IP)
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_MAX_PER_IP = 10;

// 1-hour window for password reset (3 per email/IP)
const RESET_WINDOW_MS = 60 * 60 * 1000;
const RESET_MAX = 3;

function checkLoginLockout(ip, email) {
  const ipCheck = limiter.isLimited("login_ip", ip, LOGIN_MAX_ATTEMPTS * 3, LOGIN_WINDOW_MS);
  if (ipCheck.limited) {
    return { locked: true, retryAfterSeconds: Math.ceil((ipCheck.resetAt - Date.now()) / 1000) };
  }

  if (email) {
    const emailCheck = limiter.isLimited("login_email", email, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    if (emailCheck.limited) {
      return { locked: true, retryAfterSeconds: Math.ceil((emailCheck.resetAt - Date.now()) / 1000) };
    }
  }

  return { locked: false };
}

function recordFailedLogin(ip, email) {
  limiter.recordAttempt("login_ip", ip, LOGIN_WINDOW_MS);
  if (email) limiter.recordAttempt("login_email", email, LOGIN_WINDOW_MS);
}

function recordSuccessfulLogin(ip, email) {
  limiter.reset("login_email", email);
}

function checkSignupLimit(ip) {
  const check = limiter.isLimited("signup_ip", ip, SIGNUP_MAX_PER_IP, SIGNUP_WINDOW_MS);
  if (check.limited) {
    return { limited: true, retryAfterSeconds: Math.ceil((check.resetAt - Date.now()) / 1000) };
  }
  return { limited: false };
}

function recordSignup(ip) {
  limiter.recordAttempt("signup_ip", ip, SIGNUP_WINDOW_MS);
}

function checkPasswordResetLimit(ip, email) {
  const ipCheck = limiter.isLimited("reset_ip", ip, RESET_MAX * 3, RESET_WINDOW_MS);
  if (ipCheck.limited) {
    return { limited: true, retryAfterSeconds: Math.ceil((ipCheck.resetAt - Date.now()) / 1000) };
  }
  if (email) {
    const emailCheck = limiter.isLimited("reset_email", email, RESET_MAX, RESET_WINDOW_MS);
    if (emailCheck.limited) {
      return { limited: true, retryAfterSeconds: Math.ceil((emailCheck.resetAt - Date.now()) / 1000) };
    }
  }
  return { limited: false };
}

function recordPasswordReset(ip, email) {
  limiter.recordAttempt("reset_ip", ip, RESET_WINDOW_MS);
  if (email) limiter.recordAttempt("reset_email", email, RESET_WINDOW_MS);
}

function checkVerificationResendLimit(ip, email) {
  return checkPasswordResetLimit(ip, email);
}

function recordVerificationResend(ip, email) {
  recordPasswordReset(ip, email);
}

module.exports = {
  checkLoginLockout,
  recordFailedLogin,
  recordSuccessfulLogin,
  checkSignupLimit,
  recordSignup,
  checkPasswordResetLimit,
  recordPasswordReset,
  checkVerificationResendLimit,
  recordVerificationResend,
};
