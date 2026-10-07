const crypto = require("crypto");
const fetch = require("node-fetch");
const { randomToken } = require("./crypto");

// In-memory or cookie-backed state + PKCE store (10-minute expiry)
const oauthStateCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStateCache.entries()) {
    if (now > val.expiresAt) oauthStateCache.delete(key);
  }
}, 5 * 60 * 1000).unref();

function generatePkce() {
  const verifier = randomToken(32);
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

function getRedirectUri(req, provider) {
  const envVar = provider === "google" ? process.env.GOOGLE_CALLBACK_URL : process.env.GITHUB_CALLBACK_URL;
  if (envVar) return envVar;
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("host") || "localhost:3000";
  return `${proto}://${host}/auth/${provider}/callback`;
}

function buildAuthorizationUrl(provider, req, currentUserId = null) {
  const state = randomToken(24);
  const pkce = generatePkce();
  const redirectUri = getRedirectUri(req, provider);

  oauthStateCache.set(state, {
    provider,
    verifier: pkce.verifier,
    userId: currentUserId, // for linking flows
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  if (provider === "google") {
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new Error("Google OAuth is not configured on this server.");
    }
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  if (provider === "github") {
    if (!process.env.GITHUB_CLIENT_ID) {
      throw new Error("GitHub OAuth is not configured on this server.");
    }
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  throw new Error(`Unsupported OAuth provider: ${provider}`);
}

async function handleOAuthCallback(provider, code, state) {
  const stateData = oauthStateCache.get(state);
  if (!stateData || stateData.provider !== provider) {
    const error = new Error("Invalid or expired OAuth state parameter.");
    error.code = "OAUTH_INVALID_STATE";
    throw error;
  }
  oauthStateCache.delete(state);

  if (provider === "google") {
    return exchangeGoogleCode(code, stateData);
  } else if (provider === "github") {
    return exchangeGitHubCode(code, stateData);
  }
  throw new Error(`Unsupported provider ${provider}`);
}

async function exchangeGoogleCode(code, stateData) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: stateData.redirectUri,
      grant_type: "authorization_code",
      code_verifier: stateData.verifier,
    }),
  });

  if (!tokenRes.ok) {
    const error = new Error("Failed to exchange code with Google");
    error.code = "OAUTH_TOKEN_EXCHANGE_FAILED";
    throw error;
  }

  const tokenData = await tokenRes.json();
  const userinfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userinfoRes.ok) {
    const error = new Error("Failed to load Google user profile");
    error.code = "OAUTH_USERINFO_FAILED";
    throw error;
  }

  const profile = await userinfoRes.json();

  if (!profile.email_verified) {
    const error = new Error("Google email is not verified. A verified email is required.");
    error.code = "OAUTH_EMAIL_UNVERIFIED";
    throw error;
  }

  return {
    provider: "google",
    providerUserId: profile.sub,
    email: profile.email.toLowerCase(),
    displayName: profile.name || profile.given_name || profile.email.split("@")[0],
    avatarUrl: profile.picture || null,
    isEmailVerified: true,
    linkUserId: stateData.userId,
  };
}

async function exchangeGitHubCode(code, stateData) {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "LeetMatric/1.0",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: stateData.redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const error = new Error("Failed to exchange code with GitHub");
    error.code = "OAUTH_TOKEN_EXCHANGE_FAILED";
    throw error;
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    const error = new Error(tokenData.error_description || "GitHub OAuth failed");
    error.code = "OAUTH_TOKEN_EXCHANGE_FAILED";
    throw error;
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "LeetMatric/1.0",
    },
  });

  if (!userRes.ok) {
    const error = new Error("Failed to load GitHub user profile");
    error.code = "OAUTH_USERINFO_FAILED";
    throw error;
  }

  const profile = await userRes.json();

  // Fetch verified emails
  const emailsRes = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "LeetMatric/1.0",
    },
  });

  let verifiedEmail = null;
  if (emailsRes.ok) {
    const emails = await emailsRes.json();
    if (Array.isArray(emails)) {
      const primaryVerified = emails.find(e => e.primary && e.verified);
      const anyVerified = emails.find(e => e.verified);
      verifiedEmail = primaryVerified ? primaryVerified.email : (anyVerified ? anyVerified.email : null);
    }
  }

  if (!verifiedEmail && profile.email) {
    // If user's public email is provided but no emails endpoint returned verified
    verifiedEmail = profile.email;
  }

  if (!verifiedEmail) {
    const error = new Error("GitHub account does not have a verified email. Please verify your email on GitHub first.");
    error.code = "OAUTH_EMAIL_UNVERIFIED";
    throw error;
  }

  return {
    provider: "github",
    providerUserId: String(profile.id),
    email: verifiedEmail.toLowerCase(),
    displayName: profile.name || profile.login,
    avatarUrl: profile.avatar_url || null,
    isEmailVerified: true,
    linkUserId: stateData.userId,
  };
}

module.exports = {
  buildAuthorizationUrl,
  handleOAuthCallback,
};
