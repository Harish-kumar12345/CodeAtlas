const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const port = 3102;
const databasePath = path.join(os.tmpdir(), `leetmatric-characterization-${process.pid}.sqlite`);
let server;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok || response.status === 503) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Characterization server did not start");
}

async function request(route, options) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

test.before(async () => {
  try { fs.unlinkSync(databasePath); } catch {}
  server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname),
    env: { ...process.env, AUTH_ENABLED: "false", PORT: String(port), DB_PATH: databasePath },
    stdio: "ignore",
  });
  await waitForServer();
});

test.after(() => {
  if (server && !server.killed) server.kill();
  try { fs.unlinkSync(databasePath); } catch {}
});

test("anonymous baseline endpoints retain status and response shapes", async () => {
  const health = await request("/health");
  assert.ok([200, 503].includes(health.status));
  assert.deepEqual(Object.keys(health.body).sort(), ["service", "status", "upstream"]);

  const me = await request("/api/me");
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { user: null });

  const invalidProfile = await request("/api/user/not%20valid");
  assert.equal(invalidProfile.status, 400);
  assert.deepEqual(Object.keys(invalidProfile.body).sort(), ["error"]);

  const invalidPlatform = await request("/api/platform/unsupported/tester");
  assert.equal(invalidPlatform.status, 400);
  assert.deepEqual(Object.keys(invalidPlatform.body).sort(), ["error", "message"]);

  const notFound = await request("/api/unknown-endpoint");
  assert.equal(notFound.status, 404);
  assert.deepEqual(Object.keys(notFound.body).sort(), ["code", "message", "retryable"]);

  const robots = await request("/robots.txt");
  assert.equal(robots.status, 200);
  assert.ok(typeof robots.body === "string" && robots.body.includes("User-agent"));

  const sitemap = await request("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.ok(typeof sitemap.body === "string" && sitemap.body.includes("urlset"));

  const invalidCard = await request("/card/invalid%20user.svg");
  assert.equal(invalidCard.status, 400);
  assert.equal(invalidCard.body, "Invalid username");

  const invalidProgress = await request("/api/user/invalid%20user/progress");
  assert.equal(invalidProgress.status, 400);
  assert.deepEqual(invalidProgress.body, { error: "Invalid username" });

  const invalidCompare = await request("/api/compare/bad%201/bad%202");
  assert.equal(invalidCompare.status, 400);
  assert.deepEqual(invalidCompare.body, { error: "Invalid username" });

  const invalidRecent = await request("/api/user/bad%20name/recent");
  assert.equal(invalidRecent.status, 400);
  assert.deepEqual(invalidRecent.body, { error: "Invalid username" });

  const invalidCalendar = await request("/api/user/bad%20name/calendar");
  assert.equal(invalidCalendar.status, 400);
  assert.deepEqual(invalidCalendar.body, { error: "Invalid username" });
});

test("anonymous state-changing private routes remain unauthorized", async () => {
  const goal = await request("/api/user/tester/goal");
  assert.equal(goal.status, 401);
  assert.deepEqual(Object.keys(goal.body).sort(), ["code", "message", "retryable"]);

  const accounts = await request("/api/accounts");
  assert.equal(accounts.status, 401);
  assert.deepEqual(Object.keys(accounts.body).sort(), ["code", "message", "retryable"]);

  const leaderboard = await request("/api/groups/demo/leaderboard");
  assert.equal(leaderboard.status, 401);
  assert.deepEqual(Object.keys(leaderboard.body).sort(), ["code", "message", "retryable"]);
});
