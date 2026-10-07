// backend/resilience.test.js
// Verification suite for Phase 1: Observability, Resilience, Health Probes, and Degradation
const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const {
  execute,
  getCircuit,
  getAllCircuitStatuses,
  resetAllCircuits,
  STATES,
} = require("./infrastructure/resilience");
const logger = require("./infrastructure/logger");
const {
  livenessHandler,
  readinessHandler,
  statusHandler,
  maintenanceMiddleware,
} = require("./infrastructure/health");
const { getCodeforces, getCodeChef, getGitHub } = require("./platforms");
const { createStudyPlan } = require("./engagement");
const { sendEmail } = require("./auth/email");

test("circuit breaker: transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED", async () => {
  resetAllCircuits();
  const testCircuit = getCircuit("test-service");
  testCircuit.failureThreshold = 2;
  testCircuit.cooldownMs = 50;

  assert.equal(testCircuit.state, STATES.CLOSED);

  // 1st failure: remains CLOSED
  await execute("test-service", async () => {
    throw new Error("fail 1");
  }, (err) => err.message, { retries: 0 });
  assert.equal(testCircuit.state, STATES.CLOSED);
  assert.equal(testCircuit.failureCount, 1);

  // 2nd failure: trips to OPEN
  await execute("test-service", async () => {
    throw new Error("fail 2");
  }, (err) => err.message, { retries: 0 });
  assert.equal(testCircuit.isOpen(), true);

  // Fast-fail while OPEN (action is not even attempted)
  let attempted = false;
  const fallbackResult = await execute("test-service", async () => {
    attempted = true;
    return "ok";
  }, () => "fallback_executed", { retries: 0 });

  assert.equal(attempted, false);
  assert.equal(fallbackResult, "fallback_executed");

  // Wait for cooldown
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(testCircuit.isOpen(), false); // resets to HALF_OPEN

  // Success in HALF_OPEN resets to CLOSED
  await execute("test-service", async () => "healed", null, { retries: 0 });
  assert.equal(testCircuit.state, STATES.CLOSED);
  assert.equal(testCircuit.failureCount, 0);
});

test("circuit breaker: retries with exponential backoff on retryable error", async () => {
  resetAllCircuits();
  let attempts = 0;
  const start = Date.now();

  const result = await execute("retry-service", async () => {
    attempts++;
    if (attempts < 3) throw new Error("transient glitch");
    return "success";
  }, null, { retries: 3, baseDelayMs: 20 });

  const duration = Date.now() - start;
  assert.equal(attempts, 3);
  assert.equal(result, "success");
  assert.ok(duration >= 20, "Should have delayed across retries");
});

test("health probes: /healthz returns liveness status with uptime", () => {
  let resStatus = 0;
  let resData = null;
  const mockRes = {
    status(code) { resStatus = code; return this; },
    json(data) { resData = data; return this; },
  };

  livenessHandler({}, mockRes);
  assert.equal(resStatus, 200);
  assert.equal(resData.status, "ok");
  assert.ok(typeof resData.uptimeSeconds === "number");
  assert.ok(resData.timestamp);
});

test("health probes: /readyz checks deep dependencies and circuits", async () => {
  let resStatus = 0;
  let resData = null;
  const mockRes = {
    status(code) { resStatus = code; return this; },
    json(data) { resData = data; return this; },
  };

  await readinessHandler({}, mockRes);
  assert.equal(resStatus, 200);
  assert.equal(resData.status, "ready");
  assert.equal(resData.checks.cache, "ok");
  assert.ok(resData.checks.circuits.leetcode);
});

test("health probes: /status outputs json and accepts html format", () => {
  let resStatus = 0;
  let resData = null;
  let sentHtml = "";

  const mockJsonRes = {
    status(code) { resStatus = code; return this; },
    json(data) { resData = data; return this; },
    accepts(type) { return type !== "html"; },
  };
  statusHandler({ accepts: () => false, path: "/status" }, mockJsonRes);
  assert.equal(resStatus, 200);
  assert.equal(resData.service, "LeetMatric");
  assert.ok(["operational", "maintenance"].includes(resData.status));

  const mockHtmlRes = {
    status(code) { resStatus = code; return this; },
    type(t) { return this; },
    send(html) { sentHtml = html; return this; },
  };
  statusHandler({
    accepts: (types) => (Array.isArray(types) && types.includes("html") ? "html" : false),
    path: "/status",
    xhr: false,
  }, mockHtmlRes);
  assert.ok(sentHtml.includes("LeetMatric Status"));
});

test("maintenance mode: gates api requests while keeping health probes accessible", () => {
  process.env.MAINTENANCE_MODE = "true";

  // /healthz should pass through
  let passedThrough = false;
  maintenanceMiddleware({ path: "/healthz", accepts: () => false }, {}, () => { passedThrough = true; });
  assert.equal(passedThrough, true);

  // Regular API call should receive 503
  let resStatus = 0;
  let resBody = null;
  const mockRes = {
    status(code) { resStatus = code; return this; },
    json(data) { resBody = data; return this; },
  };
  maintenanceMiddleware({ path: "/api/profile/test", accepts: () => false }, mockRes, () => {});
  assert.equal(resStatus, 503);
  assert.equal(resBody.code, "MAINTENANCE_MODE");

  delete process.env.MAINTENANCE_MODE;
});

test("graceful degradation: simulated platform failure does not crash profile loaders", async () => {
  // Verify that an OPEN circuit for Codeforces immediately returns safe fallback
  const cfCircuit = getCircuit("codeforces");
  cfCircuit.state = STATES.OPEN;
  cfCircuit.lastFailureTime = Date.now();
  const cf = await getCodeforces("any_user");
  assert.equal(cf.provider, "Codeforces");
  assert.equal(cf.available, false);
  cfCircuit.state = STATES.CLOSED;

  // Verify that an OPEN circuit for CodeChef immediately returns safe fallback
  const ccCircuit = getCircuit("codechef");
  ccCircuit.state = STATES.OPEN;
  ccCircuit.lastFailureTime = Date.now();
  const cc = await getCodeChef("any_user");
  assert.equal(cc.provider, "CodeChef");
  assert.equal(cc.available, false);
  ccCircuit.state = STATES.CLOSED;

  // Verify that an OPEN circuit for GitHub immediately returns safe fallback
  const ghCircuit = getCircuit("github");
  ghCircuit.state = STATES.OPEN;
  ghCircuit.lastFailureTime = Date.now();
  const gh = await getGitHub("any_user");
  assert.equal(gh.provider, "GitHub");
  assert.equal(gh.available, false);
  ghCircuit.state = STATES.CLOSED;
});

test("graceful degradation: AI study plan falls back to rule-based when LLM fails or is unconfigured", async () => {
  const mockProfile = {
    analytics: {
      weakTopics: ["Dynamic Programming", "Graph"],
      difficulty: [{ difficulty: "Easy", solved: 5 }, { difficulty: "Medium", solved: 10 }],
      streaks: { current: 3 },
    },
  };
  const mockRecommendations = [{ title: "Coin Change" }, { title: "Number of Islands" }];

  const plan = await createStudyPlan(mockProfile, mockRecommendations);
  assert.equal(plan.source, "rule-based");
  assert.ok(Array.isArray(plan.plan.days));
  assert.equal(plan.plan.days.length, 7);
});

test("graceful degradation: email service fails safely without crashing", async () => {
  const success = await sendEmail({
    to: "test@example.com",
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
  });
  // Without EMAIL_PROVIDER set or in dev, handles safely
  assert.ok(typeof success === "boolean");
});

test("logger: redacts sensitive keys in metadata", () => {
  const originalWarn = console.warn;
  let loggedOutput = "";
  console.warn = (msg) => { loggedOutput = msg; };

  try {
    logger.warn("test_event", "Checking redaction", {
      username: "student",
      password: "secretpassword123",
      token: "jwt_token_secret",
      apiKey: "secret_api_key",
      nested: {
        authorization: "Bearer 12345",
        normalField: "public_value",
      },
    });

    const parsed = JSON.parse(loggedOutput);
    assert.equal(parsed.password, "[REDACTED]");
    assert.equal(parsed.token, "[REDACTED]");
    assert.equal(parsed.apiKey, "[REDACTED]");
    assert.equal(parsed.nested.authorization, "[REDACTED]");
    assert.equal(parsed.nested.normalField, "public_value");
    assert.equal(parsed.username, "student");
  } finally {
    console.warn = originalWarn;
  }
});
