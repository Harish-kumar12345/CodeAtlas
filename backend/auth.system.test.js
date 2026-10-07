const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

// Set environment for unit tests
const testDbPath = path.join(os.tmpdir(), `auth-unit-${Date.now()}-${process.pid}.sqlite`);
process.env.DB_PATH = testDbPath;
process.env.AUTH_ENABLED = "true";

const authDb = require("./auth/db");
const cryptoUtils = require("./auth/crypto");
const rateLimitUtils = require("./auth/rate-limit");
const sessionUtils = require("./auth/session");

test.before(async () => {
  try { fs.unlinkSync(testDbPath); } catch {}
  await authDb.ensureReady();
});

test.after(async () => {
  await authDb.closeAuthDatabase();
  try { fs.unlinkSync(testDbPath); } catch {}
});

// ── 1. Unit Tests ────────────────────────────────────────────────────────────

test("password hashing: argon2id produces valid hash and verifies properly", async () => {
  const password = "StrongPassword#2026";
  const hash = await cryptoUtils.hashPassword(password);
  assert.ok(hash.startsWith("$argon2id$"));

  const matches = await cryptoUtils.verifyPassword(hash, password);
  assert.equal(matches, true);

  const wrong = await cryptoUtils.verifyPassword(hash, "WrongPassword#2026");
  assert.equal(wrong, false);
});

test("password policy: rejects weak and common passwords", () => {
  const short = cryptoUtils.validatePasswordStrength("short7");
  assert.equal(short.valid, false);

  const common = cryptoUtils.validatePasswordStrength("password123");
  assert.equal(common.valid, false);

  const strong = cryptoUtils.validatePasswordStrength("MySecureP@ssw0rd!2026");
  assert.equal(strong.valid, true);
  assert.ok(strong.score >= 3);
});

test("session lifecycle: create, retrieve, touch, and delete", async () => {
  const user = await authDb.createUser({
    email: "session-test@example.com",
    displayName: "Session User",
  });

  const sessionId = cryptoUtils.randomToken(32);
  const expiresAt = new Date(Date.now() + 60000).toISOString();

  await authDb.createSession({
    id: sessionId,
    userId: user.id,
    userAgent: "NodeTest",
    ipAddress: "127.0.0.1",
    expiresAt,
  });

  const session = await authDb.getSession(sessionId);
  assert.ok(session);
  assert.equal(session.userId, user.id);
  assert.equal(session.user.email, "session-test@example.com");

  await authDb.touchSession(sessionId);
  await authDb.deleteSession(sessionId);

  const deadSession = await authDb.getSession(sessionId);
  assert.equal(deadSession, null);
});

test("token expiry and single-use reuse prevention", async () => {
  const user = await authDb.createUser({
    email: "token-test@example.com",
    displayName: "Token User",
  });

  const rawToken = cryptoUtils.randomToken(32);
  const tokenHash = cryptoUtils.hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60000).toISOString();

  await authDb.createEmailToken({
    userId: user.id,
    tokenHash,
    type: "verify_email",
    expiresAt,
  });

  const found = await authDb.getEmailToken(tokenHash, "verify_email");
  assert.ok(found);
  assert.equal(found.userId, user.id);

  // Mark token used
  await authDb.markEmailTokenUsed(found.id);

  // Reusing token must fail
  const reused = await authDb.getEmailToken(tokenHash, "verify_email");
  assert.equal(reused, null);
});

test("rate limiting and lockout behavior", () => {
  const testIp = "192.168.1.100";
  const testEmail = "lockout@example.com";

  // Record 4 failed attempts
  for (let i = 0; i < 4; i++) {
    rateLimitUtils.recordFailedLogin(testIp, testEmail);
    const status = rateLimitUtils.checkLoginLockout(testIp, testEmail);
    assert.equal(status.locked, false);
  }

  // 5th attempt locks the account
  rateLimitUtils.recordFailedLogin(testIp, testEmail);
  const lockedStatus = rateLimitUtils.checkLoginLockout(testIp, testEmail);
  assert.equal(lockedStatus.locked, true);
  assert.ok(lockedStatus.retryAfterSeconds > 0);

  // Reset clears lockout
  rateLimitUtils.recordSuccessfulLogin(testIp, testEmail);
});

// ── 2. Server Integration & Security Tests ───────────────────────────────────

const serverPort = 3105;
const serverDbPath = path.join(os.tmpdir(), `auth-server-${Date.now()}-${process.pid}.sqlite`);
let testServer;

async function waitForServer(port) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Test server failed to start");
}

test.before(async () => {
  try { fs.unlinkSync(serverDbPath); } catch {}
  testServer = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname),
    env: {
      ...process.env,
      AUTH_ENABLED: "true",
      PORT: String(serverPort),
      DB_PATH: serverDbPath,
      EMAIL_PROVIDER: "console",
    },
    stdio: "ignore",
  });
  await waitForServer(serverPort);
});

test.after(() => {
  if (testServer && !testServer.killed) testServer.kill();
  try { fs.unlinkSync(serverDbPath); } catch {}
});

async function api(path, options = {}) {
  const res = await fetch(`http://127.0.0.1:${serverPort}${path}`, options);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

test("security: enumeration resistance for wrong email vs wrong password", async () => {
  const csrfRes = await api("/auth/csrf");
  const csrf = csrfRes.body.csrfToken;
  const cookie = csrfRes.headers.get("set-cookie") || "";

  // 1. Wrong email
  const wrongEmail = await api("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: cookie,
    },
    body: JSON.stringify({ email: "doesnotexist@example.com", password: "SomePassword#123" }),
  });

  // 2. Register real user
  await api("/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: cookie,
    },
    body: JSON.stringify({ email: "validuser@example.com", password: "ValidPassword#123", displayName: "Valid User" }),
  });

  // 3. Wrong password for real user
  const wrongPass = await api("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: cookie,
    },
    body: JSON.stringify({ email: "validuser@example.com", password: "WrongPassword#123" }),
  });

  // Both must return identical 401 response shape and code
  assert.equal(wrongEmail.status, 401);
  assert.equal(wrongPass.status, 401);
  assert.equal(wrongEmail.body.code, "INVALID_CREDENTIALS");
  assert.equal(wrongPass.body.code, "INVALID_CREDENTIALS");
  assert.equal(wrongEmail.body.message, wrongPass.body.message);
});

test("security: CSRF validation failure on state-changing requests", async () => {
  // Post without CSRF token must fail with 403
  const res = await api("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "csrf@example.com", password: "Password#123" }),
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, "CSRF_ERROR");
});

test("security: tampered or invalid session cookie is rejected and cleared", async () => {
  const res = await api("/auth/me", {
    headers: {
      Cookie: "leetmatric_session=invalid-tampered-session-id-123456",
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.user, null);
  const setCookie = res.headers.get("set-cookie") || "";
  assert.ok(setCookie.includes("Max-Age=0") || setCookie.includes("leetmatric_session="));
});

test("authorization: user A cannot access or mutate user B private data", async () => {
  const csrfRes = await api("/auth/csrf");
  const csrf = csrfRes.body.csrfToken;
  const baseCookie = csrfRes.headers.get("set-cookie");

  // Register User A
  const resA = await api("/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: baseCookie,
    },
    body: JSON.stringify({ email: "usera@example.com", password: "UserAPassword#123", displayName: "User A" }),
  });
  const cookieA = resA.headers.get("set-cookie");

  // User A sets a goal
  await api("/auth/goal", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: `${baseCookie}; ${cookieA}`,
    },
    body: JSON.stringify({ dailyTarget: 10, remindersEnabled: true }),
  });

  // Register User B
  const resB = await api("/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: baseCookie,
    },
    body: JSON.stringify({ email: "userb@example.com", password: "UserBPassword#123", displayName: "User B" }),
  });
  const cookieB = resB.headers.get("set-cookie");

  // User B reads goal: must see null or their own goal, NOT User A's goal
  const goalB = await api("/auth/goal", {
    headers: {
      Cookie: `${baseCookie}; ${cookieB}`,
    },
  });

  assert.equal(goalB.status, 200);
  assert.equal(goalB.body.goal, null);
});

test("end-to-end: register, login, authenticated dashboard, and logout flow", async () => {
  const csrfRes = await api("/auth/csrf");
  const csrf = csrfRes.body.csrfToken;
  const cookie = csrfRes.headers.get("set-cookie");

  // 1. Register
  const reg = await api("/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: cookie,
    },
    body: JSON.stringify({ email: "e2e@example.com", password: "Password#2026", displayName: "E2E User" }),
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, "e2e@example.com");

  const sessionCookie = reg.headers.get("set-cookie");

  // 2. Fetch authenticated profile
  const me = await api("/auth/me", {
    headers: {
      Cookie: `${cookie}; ${sessionCookie}`,
    },
  });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.displayName, "E2E User");

  // 3. Set a goal and link leetcode username
  const linkRes = await api("/auth/links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: `${cookie}; ${sessionCookie}`,
    },
    body: JSON.stringify({ platform: "leetcode", username: "e2e_coder" }),
  });
  assert.equal(linkRes.status, 201);
  assert.equal(linkRes.body.links.length, 1);
  assert.equal(linkRes.body.links[0].username, "e2e_coder");

  // 4. Export private data
  const exp = await api("/auth/export", {
    headers: {
      Cookie: `${cookie}; ${sessionCookie}`,
    },
  });
  assert.equal(exp.status, 200);
  assert.equal(exp.body.user.email, "e2e@example.com");
  assert.equal(exp.body.platformLinks[0].username, "e2e_coder");

  // 5. Logout
  const logout = await api("/auth/logout", {
    method: "POST",
    headers: {
      "X-CSRF-Token": csrf,
      Cookie: `${cookie}; ${sessionCookie}`,
    },
  });
  assert.equal(logout.status, 200);

  // 6. Verify session invalidated
  const deadMe = await api("/auth/me", {
    headers: {
      Cookie: `${cookie}; ${sessionCookie}`,
    },
  });
  assert.equal(deadMe.status, 200);
  assert.equal(deadMe.body.user, null);
});

test("oauth: invalid state is strictly rejected", async () => {
  const oauthModule = require("./auth/oauth");
  await assert.rejects(
    async () => {
      await oauthModule.handleOAuthCallback("google", "test-code", "non-existent-state-token");
    },
    { code: "OAUTH_INVALID_STATE" }
  );
});

test("regression: when AUTH_ENABLED=false, auth routes return 404 while baseline remains identical", async () => {
  const disabledPort = 3108;
  const disabledDb = path.join(os.tmpdir(), `auth-disabled-${Date.now()}-${process.pid}.sqlite`);
  const disabledServer = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname),
    env: { ...process.env, AUTH_ENABLED: "false", PORT: String(disabledPort), DB_PATH: disabledDb },
    stdio: "ignore",
  });

  try {
    await waitForServer(disabledPort);
    // Baseline public endpoint
    const health = await fetch(`http://127.0.0.1:${disabledPort}/health`);
    assert.equal(health.status, 200);

    // Auth register endpoint should not be mounted (falls through to static or 404)
    const register = await fetch(`http://127.0.0.1:${disabledPort}/auth/register`, { method: "POST" });
    assert.ok([404, 405].includes(register.status));

    // /api/auth/me should not be mounted (hits api catch-all 404)
    const me = await fetch(`http://127.0.0.1:${disabledPort}/api/auth/me`);
    assert.equal(me.status, 404);
  } finally {
    if (disabledServer && !disabledServer.killed) disabledServer.kill();
    try { fs.unlinkSync(disabledDb); } catch {}
  }
});
