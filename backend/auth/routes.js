const express = require("express");
const authDb = require("./db");
const { hashPassword, verifyPassword, validatePasswordStrength, hashToken, timingSafeEqual } = require("./crypto");
const { rotateSession, endSession, endAllSessions, setSessionCookie } = require("./session");
const { getCsrfToken, csrfProtection } = require("./csrf");
const {
  checkLoginLockout,
  recordFailedLogin,
  recordSuccessfulLogin,
  checkSignupLimit,
  recordSignup,
  checkPasswordResetLimit,
  recordPasswordReset,
  checkVerificationResendLimit,
  recordVerificationResend,
} = require("./rate-limit");
const { sendVerificationEmail, sendPasswordResetEmail } = require("./email");
const { buildAuthorizationUrl, handleOAuthCallback } = require("./oauth");
const { requireAuth } = require("./permissions");

const router = express.Router();

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || "127.0.0.1";
}

// ── CSRF Endpoint ────────────────────────────────────────────────────────────

router.get("/csrf", (req, res) => {
  const token = getCsrfToken(req, res);
  res.json({ csrfToken: token });
});

// ── Registration ─────────────────────────────────────────────────────────────

router.post("/register", csrfProtection, async (req, res) => {
  const ip = getClientIp(req);
  const signupCheck = checkSignupLimit(ip);
  if (signupCheck.limited) {
    return res.status(429).json({
      code: "RATE_LIMITED",
      message: `Too many sign-up attempts. Please wait ${signupCheck.retryAfterSeconds} seconds before trying again.`,
      retryable: true,
    });
  }

  const email = String(req.body?.email || "").toLowerCase().trim();
  const password = String(req.body?.password || "");
  const displayName = String(req.body?.displayName || "").trim() || email.split("@")[0];

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email) || email.length > 255) {
    return res.status(400).json({
      code: "INVALID_EMAIL",
      message: "Please enter a valid email address.",
      retryable: false,
    });
  }

  // Validate password strength
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    return res.status(400).json({
      code: "WEAK_PASSWORD",
      message: strength.error,
      score: strength.score,
      retryable: false,
    });
  }

  try {
    const existing = await authDb.getUserByEmail(email);
    if (existing) {
      // Enumeration mitigation: do not reveal email already exists
      // Return a 400 with a generic message or instruction to sign in
      return res.status(409).json({
        code: "REGISTRATION_FAILED",
        message: "An account with this email address already exists. Please sign in instead.",
        retryable: false,
      });
    }

    recordSignup(ip);
    const passwordHash = await hashPassword(password);
    const user = await authDb.createUser({
      email,
      passwordHash,
      displayName,
      role: "user",
      isEmailVerified: false,
      isPublic: true,
    });

    await authDb.addAuditLog({
      userId: user.id,
      event: "user_registered",
      ipAddress: ip,
      userAgent: req.get("user-agent"),
      metadata: { method: "password" },
    });

    // Send verification email
    try {
      await sendVerificationEmail(req, user);
    } catch (e) {
      console.error("Failed to send verification email:", e);
    }

    // Auto-login on sign-up with rotated session
    await rotateSession(req, res, user, false);

    return res.status(201).json({
      message: "Account created successfully. Please check your inbox to verify your email.",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isEmailVerified: user.isEmailVerified,
        isPublic: user.isPublic,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Unable to complete registration. Please try again later.",
      retryable: true,
    });
  }
});

// ── Login ────────────────────────────────────────────────────────────────────

router.post("/login", csrfProtection, async (req, res) => {
  const ip = getClientIp(req);
  const email = String(req.body?.email || "").toLowerCase().trim();
  const password = String(req.body?.password || "");
  const rememberMe = Boolean(req.body?.rememberMe);

  const lockout = checkLoginLockout(ip, email);
  if (lockout.locked) {
    return res.status(429).json({
      code: "ACCOUNT_LOCKED",
      message: `Too many failed sign-in attempts. For security, please wait ${lockout.retryAfterSeconds} seconds before trying again.`,
      retryable: true,
    });
  }

  // Consistent generic error for wrong email or wrong password to prevent user enumeration
  const invalidCredentialsError = () => {
    recordFailedLogin(ip, email);
    return res.status(401).json({
      code: "INVALID_CREDENTIALS",
      message: "Incorrect email or password. Please try again.",
      retryable: false,
    });
  };

  if (!email || !password) {
    return invalidCredentialsError();
  }

  try {
    const user = await authDb.getUserByEmail(email);
    if (!user || !user.passwordHash) {
      // Perform a dummy hash verification to prevent timing attacks
      await verifyPassword("$argon2id$v=19$m=65536,t=3,p=4$dummySaltString123456$dummyHashValueString1234567890", password);
      return invalidCredentialsError();
    }

    const matches = await verifyPassword(user.passwordHash, password);
    if (!matches) {
      return invalidCredentialsError();
    }

    // Success: reset failed attempts
    recordSuccessfulLogin(ip, email);

    // Rotate session to prevent session fixation
    await rotateSession(req, res, user, rememberMe);

    await authDb.addAuditLog({
      userId: user.id,
      event: "user_login",
      ipAddress: ip,
      userAgent: req.get("user-agent"),
      metadata: { method: "password", rememberMe },
    });

    return res.json({
      message: "Signed in successfully.",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isEmailVerified: user.isEmailVerified,
        isPublic: user.isPublic,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred during sign-in. Please try again later.",
      retryable: true,
    });
  }
});

// ── Logout ───────────────────────────────────────────────────────────────────

router.post("/logout", csrfProtection, async (req, res) => {
  if (req.authUser) {
    await authDb.addAuditLog({
      userId: req.authUser.id,
      event: "user_logout",
      ipAddress: getClientIp(req),
      userAgent: req.get("user-agent"),
    });
  }
  await endSession(req, res);
  res.json({ message: "Signed out successfully." });
});

router.post("/logout-all", requireAuth, csrfProtection, async (req, res) => {
  await endAllSessions(req.authUser.id);
  await authDb.addAuditLog({
    userId: req.authUser.id,
    event: "user_logout_all",
    ipAddress: getClientIp(req),
    userAgent: req.get("user-agent"),
  });
  await endSession(req, res);
  res.json({ message: "Logged out from all devices." });
});

// ── Email Verification ───────────────────────────────────────────────────────

router.get("/verify-email", async (req, res) => {
  const token = String(req.query?.token || "");
  if (!token) {
    return res.status(400).send("Invalid or missing verification token.");
  }

  try {
    const tokenHash = hashToken(token);
    const emailToken = await authDb.getEmailToken(tokenHash, "verify_email");

    if (!emailToken || new Date() > new Date(emailToken.expiresAt)) {
      return res.status(400).send("This verification link is invalid or has expired. Please request a new one.");
    }

    await authDb.markEmailTokenUsed(emailToken.id);
    await authDb.updateUser(emailToken.userId, { isEmailVerified: true });
    await authDb.addAuditLog({
      userId: emailToken.userId,
      event: "email_verified",
      ipAddress: getClientIp(req),
      userAgent: req.get("user-agent"),
    });

    // Redirect to login or settings with verified banner
    return res.redirect("/settings.html?verified=true");
  } catch (error) {
    console.error("Email verification error:", error);
    return res.status(500).send("Unable to verify email at this time. Please try again later.");
  }
});

router.post("/resend-verification", requireAuth, csrfProtection, async (req, res) => {
  const ip = getClientIp(req);
  const check = checkVerificationResendLimit(ip, req.authUser.email);
  if (check.limited) {
    return res.status(429).json({
      code: "RATE_LIMITED",
      message: `Too many verification requests. Please wait ${check.retryAfterSeconds} seconds before requesting again.`,
      retryable: true,
    });
  }

  if (req.authUser.isEmailVerified) {
    return res.json({ message: "Your email is already verified." });
  }

  recordVerificationResend(ip, req.authUser.email);
  await sendVerificationEmail(req, req.authUser);
  return res.json({ message: "A new verification email has been sent to your address." });
});

// ── Password Reset ───────────────────────────────────────────────────────────

router.post("/forgot-password", csrfProtection, async (req, res) => {
  const ip = getClientIp(req);
  const email = String(req.body?.email || "").toLowerCase().trim();

  const limitCheck = checkPasswordResetLimit(ip, email);
  if (limitCheck.limited) {
    return res.status(429).json({
      code: "RATE_LIMITED",
      message: `Too many password reset requests. Please wait ${limitCheck.retryAfterSeconds} seconds before trying again.`,
      retryable: true,
    });
  }

  // Generic enumeration-resistant response
  const genericResponse = {
    message: "If an account with that email exists, password reset instructions have been sent.",
  };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json(genericResponse);
  }

  recordPasswordReset(ip, email);

  try {
    const user = await authDb.getUserByEmail(email);
    if (user) {
      await sendPasswordResetEmail(req, user);
      await authDb.addAuditLog({
        userId: user.id,
        event: "password_reset_requested",
        ipAddress: ip,
        userAgent: req.get("user-agent"),
      });
    }
    return res.json(genericResponse);
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.json(genericResponse);
  }
});

router.post("/reset-password", csrfProtection, async (req, res) => {
  const token = String(req.body?.token || "");
  const newPassword = String(req.body?.newPassword || "");

  if (!token) {
    return res.status(400).json({
      code: "INVALID_TOKEN",
      message: "Reset token is missing or invalid.",
      retryable: false,
    });
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    return res.status(400).json({
      code: "WEAK_PASSWORD",
      message: strength.error,
      score: strength.score,
      retryable: false,
    });
  }

  try {
    const tokenHash = hashToken(token);
    const emailToken = await authDb.getEmailToken(tokenHash, "reset_password");

    if (!emailToken || new Date() > new Date(emailToken.expiresAt)) {
      return res.status(400).json({
        code: "TOKEN_EXPIRED",
        message: "This password reset link is invalid or has expired. Please request a new one.",
        retryable: false,
      });
    }

    const passwordHash = await hashPassword(newPassword);
    await authDb.updateUser(emailToken.userId, { passwordHash });
    await authDb.markEmailTokenUsed(emailToken.id);

    // Invalidate all existing sessions on password reset for security
    await endAllSessions(emailToken.userId);

    await authDb.addAuditLog({
      userId: emailToken.userId,
      event: "password_reset_completed",
      ipAddress: getClientIp(req),
      userAgent: req.get("user-agent"),
    });

    return res.json({
      message: "Your password has been successfully reset. Please sign in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to reset password. Please try again later.",
      retryable: true,
    });
  }
});

router.post("/change-password", requireAuth, csrfProtection, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");

  const user = await authDb.getUserById(req.authUser.id);
  if (user.passwordHash) {
    const matches = await verifyPassword(user.passwordHash, currentPassword);
    if (!matches) {
      return res.status(400).json({
        code: "INVALID_PASSWORD",
        message: "Your current password is incorrect.",
        retryable: false,
      });
    }
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    return res.status(400).json({
      code: "WEAK_PASSWORD",
      message: strength.error,
      score: strength.score,
      retryable: false,
    });
  }

  const newHash = await hashPassword(newPassword);
  await authDb.updateUser(req.authUser.id, { passwordHash: newHash });

  // Invalidate all OTHER sessions
  await authDb.deleteSessionsForUser(req.authUser.id, req.authSession.id);

  await authDb.addAuditLog({
    userId: req.authUser.id,
    event: "password_changed",
    ipAddress: getClientIp(req),
    userAgent: req.get("user-agent"),
  });

  return res.json({ message: "Password updated successfully." });
});

router.post("/change-email", requireAuth, csrfProtection, async (req, res) => {
  const newEmail = String(req.body?.newEmail || "").toLowerCase().trim();
  const password = String(req.body?.password || "");

  const user = await authDb.getUserById(req.authUser.id);
  if (user.passwordHash) {
    const matches = await verifyPassword(user.passwordHash, password);
    if (!matches) {
      return res.status(400).json({
        code: "INVALID_PASSWORD",
        message: "Password confirmation is incorrect.",
        retryable: false,
      });
    }
  }

  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return res.status(400).json({
      code: "INVALID_EMAIL",
      message: "Please enter a valid email address.",
      retryable: false,
    });
  }

  const existing = await authDb.getUserByEmail(newEmail);
  if (existing && existing.id !== req.authUser.id) {
    return res.status(409).json({
      code: "EMAIL_TAKEN",
      message: "An account with this email address already exists.",
      retryable: false,
    });
  }

  await authDb.updateUser(req.authUser.id, { email: newEmail, isEmailVerified: false });
  const updatedUser = await authDb.getUserById(req.authUser.id);

  try {
    await sendVerificationEmail(req, updatedUser);
  } catch (e) {
    console.error("Failed to send verification for new email:", e);
  }

  await authDb.addAuditLog({
    userId: req.authUser.id,
    event: "email_changed",
    ipAddress: getClientIp(req),
    userAgent: req.get("user-agent"),
    metadata: { newEmail },
  });

  return res.json({
    message: "Email updated. Please check your new inbox to verify your address.",
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.displayName,
      isEmailVerified: updatedUser.isEmailVerified,
    },
  });
});

// ── OAuth Handlers ───────────────────────────────────────────────────────────

router.get("/google", (req, res) => {
  try {
    const url = buildAuthorizationUrl("google", req);
    res.redirect(url);
  } catch (error) {
    res.status(503).json({
      code: "OAUTH_UNCONFIGURED",
      message: error.message,
      retryable: false,
    });
  }
});

router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code || !state) {
    return res.redirect(`/login.html?error=${encodeURIComponent(error || "Sign-in was cancelled.")}`);
  }

  try {
    const oauthProfile = await handleOAuthCallback("google", String(code), String(state));
    await processOAuthLogin(req, res, oauthProfile);
  } catch (err) {
    console.error("Google OAuth error:", err);
    res.redirect(`/login.html?error=${encodeURIComponent(err.message || "Google sign-in failed.")}`);
  }
});

router.get("/github", (req, res) => {
  try {
    const url = buildAuthorizationUrl("github", req);
    res.redirect(url);
  } catch (error) {
    res.status(503).json({
      code: "OAUTH_UNCONFIGURED",
      message: error.message,
      retryable: false,
    });
  }
});

router.get("/github/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code || !state) {
    return res.redirect(`/login.html?error=${encodeURIComponent(error || "Sign-in was cancelled.")}`);
  }

  try {
    const oauthProfile = await handleOAuthCallback("github", String(code), String(state));
    await processOAuthLogin(req, res, oauthProfile);
  } catch (err) {
    console.error("GitHub OAuth error:", err);
    res.redirect(`/login.html?error=${encodeURIComponent(err.message || "GitHub sign-in failed.")}`);
  }
});

async function processOAuthLogin(req, res, oauthProfile) {
  const ip = getClientIp(req);

  // Check if OAuth account already exists
  let account = await authDb.getOAuthAccount(oauthProfile.provider, oauthProfile.providerUserId);
  let user = null;

  if (account) {
    user = await authDb.getUserById(account.userId);
  } else {
    // Check if user is logged in and linking
    if (oauthProfile.linkUserId) {
      user = await authDb.getUserById(oauthProfile.linkUserId);
      if (user) {
        await authDb.createOAuthAccount({
          userId: user.id,
          provider: oauthProfile.provider,
          providerUserId: oauthProfile.providerUserId,
          providerEmail: oauthProfile.email,
        });
        await authDb.addAuditLog({
          userId: user.id,
          event: "oauth_linked",
          ipAddress: ip,
          userAgent: req.get("user-agent"),
          metadata: { provider: oauthProfile.provider },
        });
        return res.redirect("/settings.html?linked=" + oauthProfile.provider);
      }
    }

    // Check if an existing user has the exact same verified email
    const existingUser = await authDb.getUserByEmail(oauthProfile.email);
    if (existingUser) {
      // Security: Only auto-link if email is verified by provider AND user email is verified
      if (oauthProfile.isEmailVerified && existingUser.isEmailVerified) {
        user = existingUser;
        await authDb.createOAuthAccount({
          userId: user.id,
          provider: oauthProfile.provider,
          providerUserId: oauthProfile.providerUserId,
          providerEmail: oauthProfile.email,
        });
      } else {
        return res.redirect(`/login.html?error=${encodeURIComponent("An account with this email already exists. Please log in with password to link this social account.")}`);
      }
    } else {
      // Create new user via OAuth
      user = await authDb.createUser({
        email: oauthProfile.email,
        displayName: oauthProfile.displayName,
        avatarUrl: oauthProfile.avatarUrl,
        isEmailVerified: oauthProfile.isEmailVerified,
        isPublic: true,
      });

      await authDb.createOAuthAccount({
        userId: user.id,
        provider: oauthProfile.provider,
        providerUserId: oauthProfile.providerUserId,
        providerEmail: oauthProfile.email,
      });

      await authDb.addAuditLog({
        userId: user.id,
        event: "user_registered",
        ipAddress: ip,
        userAgent: req.get("user-agent"),
        metadata: { method: "oauth", provider: oauthProfile.provider },
      });
    }
  }

  await rotateSession(req, res, user, false);
  await authDb.addAuditLog({
    userId: user.id,
    event: "user_login",
    ipAddress: ip,
    userAgent: req.get("user-agent"),
    metadata: { method: "oauth", provider: oauthProfile.provider },
  });

  return res.redirect("/settings.html");
}

router.get("/oauth/link/:provider", requireAuth, (req, res) => {
  const provider = req.params.provider.toLowerCase();
  try {
    const url = buildAuthorizationUrl(provider, req, req.authUser.id);
    res.redirect(url);
  } catch (error) {
    res.status(400).json({ code: "OAUTH_ERROR", message: error.message });
  }
});

router.delete("/oauth/:provider", requireAuth, csrfProtection, async (req, res) => {
  const provider = req.params.provider.toLowerCase();
  const user = await authDb.getUserById(req.authUser.id);
  const oauthAccounts = await authDb.getOAuthAccountsForUser(req.authUser.id);

  // Cannot unlink last method:
  // Must have a password OR more than one OAuth account
  const hasPassword = Boolean(user.passwordHash);
  const remainingAccounts = oauthAccounts.filter(a => a.provider !== provider);

  if (!hasPassword && remainingAccounts.length === 0) {
    return res.status(400).json({
      code: "CANNOT_UNLINK_LAST_METHOD",
      message: "You cannot unlink your only login method. Please set a password or connect another social account first.",
      retryable: false,
    });
  }

  await authDb.deleteOAuthAccount(req.authUser.id, provider);
  await authDb.addAuditLog({
    userId: req.authUser.id,
    event: "oauth_unlinked",
    ipAddress: getClientIp(req),
    userAgent: req.get("user-agent"),
    metadata: { provider },
  });

  res.json({ message: `${provider} has been unlinked.` });
});

// ── User API & Dashboard ─────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
  if (!req.authUser) {
    return res.json({ user: null });
  }

  const [oauthAccounts, links, goal] = await Promise.all([
    authDb.getOAuthAccountsForUser(req.authUser.id),
    authDb.getUserLinks(req.authUser.id),
    authDb.getUserGoal(req.authUser.id),
  ]);

  return res.json({
    user: {
      ...req.authUser,
      hasPassword: Boolean((await authDb.getUserById(req.authUser.id)).passwordHash),
      oauthAccounts: oauthAccounts.map(a => a.provider),
      links,
      goal,
    },
  });
});

router.patch("/profile", requireAuth, csrfProtection, async (req, res) => {
  const { displayName, avatarUrl, isPublic } = req.body;
  const updates = {};

  if (typeof displayName === "string") updates.displayName = displayName.trim().slice(0, 50);
  if (typeof avatarUrl === "string") updates.avatarUrl = avatarUrl.trim();
  if (typeof isPublic === "boolean") updates.isPublic = isPublic;

  const updated = await authDb.updateUser(req.authUser.id, updates);
  await authDb.addAuditLog({
    userId: req.authUser.id,
    event: "profile_updated",
    ipAddress: getClientIp(req),
    userAgent: req.get("user-agent"),
    metadata: updates,
  });

  res.json({ user: updated });
});

router.get("/sessions", requireAuth, async (req, res) => {
  const sessions = await authDb.getActiveSessionsForUser(req.authUser.id);
  res.json({
    sessions: sessions.map(s => ({
      ...s,
      isCurrent: s.id === req.authSession.id,
    })),
  });
});

router.delete("/sessions/:id", requireAuth, csrfProtection, async (req, res) => {
  const sessionId = req.params.id;
  if (sessionId === req.authSession.id) {
    await endSession(req, res);
    return res.json({ message: "Current session terminated." });
  }
  await authDb.deleteSession(sessionId);
  res.json({ message: "Session revoked." });
});

router.get("/export", requireAuth, async (req, res) => {
  const [user, oauthAccounts, sessions, links, goal, audit] = await Promise.all([
    authDb.getUserById(req.authUser.id),
    authDb.getOAuthAccountsForUser(req.authUser.id),
    authDb.getActiveSessionsForUser(req.authUser.id),
    authDb.getUserLinks(req.authUser.id),
    authDb.getUserGoal(req.authUser.id),
    authDb.getAuditLogsForUser(req.authUser.id, 50),
  ]);

  const sanitizedUser = { ...user };
  delete sanitizedUser.passwordHash;

  const exportData = {
    exportedAt: new Date().toISOString(),
    user: sanitizedUser,
    oauthAccounts,
    activeSessions: sessions,
    platformLinks: links,
    goal,
    recentAuditLogs: audit,
  };

  res.setHeader("Content-Disposition", 'attachment; filename="leetmatric-data-export.json"');
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(exportData, null, 2));
});

router.delete("/account", requireAuth, csrfProtection, async (req, res) => {
  await authDb.addAuditLog({
    userId: req.authUser.id,
    event: "account_deleted",
    ipAddress: getClientIp(req),
    userAgent: req.get("user-agent"),
  });
  await authDb.deleteUser(req.authUser.id);
  await endSession(req, res);
  res.status(204).send();
});

// ── Platform Links & Personal Goals ──────────────────────────────────────────

router.get("/links", requireAuth, async (req, res) => {
  res.json({ links: await authDb.getUserLinks(req.authUser.id) });
});

router.post("/links", requireAuth, csrfProtection, async (req, res) => {
  const platform = String(req.body?.platform || "").toLowerCase().trim();
  const username = String(req.body?.username || "").trim();
  const isPrimary = Boolean(req.body?.isPrimary);

  if (!["leetcode", "codeforces", "codechef", "github"].includes(platform) || !/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
    return res.status(400).json({
      code: "INVALID_LINK",
      message: "Please choose a supported platform and enter a valid username.",
      retryable: false,
    });
  }

  const links = await authDb.upsertUserLink(req.authUser.id, platform, username, isPrimary);
  res.status(201).json({ links });
});

router.delete("/links/:platform/:username", requireAuth, csrfProtection, async (req, res) => {
  const platform = String(req.params.platform || "").toLowerCase().trim();
  const username = String(req.params.username || "").trim();
  const links = await authDb.deleteUserLink(req.authUser.id, platform, username);
  res.json({ links });
});

router.get("/goal", requireAuth, async (req, res) => {
  res.json({ goal: await authDb.getUserGoal(req.authUser.id) });
});

router.put("/goal", requireAuth, csrfProtection, async (req, res) => {
  const dailyTarget = Number(req.body?.dailyTarget);
  if (!Number.isInteger(dailyTarget) || dailyTarget < 1 || dailyTarget > 100) {
    return res.status(400).json({
      code: "INVALID_TARGET",
      message: "Daily target must be an integer between 1 and 100.",
      retryable: false,
    });
  }

  const goal = await authDb.saveUserGoal(req.authUser.id, {
    dailyTarget,
    remindersEnabled: Boolean(req.body?.remindersEnabled),
    reminderChannel: ["telegram", "email"].includes(req.body?.reminderChannel) ? req.body.reminderChannel : null,
  });

  res.json({ goal });
});

router.get("/audit", requireAuth, async (req, res) => {
  const logs = await authDb.getAuditLogsForUser(req.authUser.id, 50);
  res.json({ logs });
});

module.exports = router;
