// backend/features/companion.system.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

test("companion system: all routes return 404 when flags are off", async () => {
  // Save env
  const savedEnv = { ...process.env };
  delete process.env.FEATURE_REVISION;
  delete process.env.FEATURE_CONTESTS;
  delete process.env.FEATURE_BADGES;
  delete process.env.FEATURE_MOCK;
  delete process.env.FEATURE_HINTS;
  delete process.env.FEATURE_DIGEST;
  delete process.env.FEATURE_NOTES;

  // Clear module cache
  delete require.cache[require.resolve("./flags")];
  delete require.cache[require.resolve("./index")];
  delete require.cache[require.resolve("../server")];

  const express = require("express");
  const app = express();
  app.use(express.json());

  const companion = require("./index");
  companion.init(app);

  app.use("/api", (req, res) => {
    res.status(404).json({ code: "NOT_FOUND" });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Features overview endpoint
    const resFlags = await fetch(`${baseUrl}/api/features`);
    const flags = await resFlags.json();
    assert.equal(flags.revision, false);
    assert.equal(flags.contests, false);
    assert.equal(flags.badges, false);
    assert.equal(flags.mock, false);
    assert.equal(flags.hints, false);
    assert.equal(flags.digest, false);
    assert.equal(flags.notes, false);

    // Endpoints must all 404
    const endpoints = [
      "/api/revision",
      "/api/contests",
      "/api/badges",
      "/api/mock/sessions",
      "/api/hints",
      "/api/digest/preferences",
      "/api/notes",
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep}`);
      assert.equal(res.status, 404, `Expected 404 for ${ep} when flag is off`);
    }
  } finally {
    server.close();
    process.env = savedEnv;
  }
});

test("companion system: active flags mount routes and enforce authentication", async () => {
  const savedEnv = { ...process.env };
  process.env.FEATURE_REVISION = "true";
  process.env.FEATURE_CONTESTS = "true";
  process.env.FEATURE_BADGES = "true";
  process.env.FEATURE_MOCK = "true";
  process.env.FEATURE_HINTS = "true";
  process.env.FEATURE_DIGEST = "true";
  process.env.FEATURE_NOTES = "true";

  delete require.cache[require.resolve("./flags")];
  delete require.cache[require.resolve("./index")];

  const express = require("express");
  const app = express();
  app.use(express.json());

  const companion = require("./index");
  companion.init(app);

  app.use("/api", (req, res) => {
    res.status(404).json({ code: "NOT_FOUND" });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Features endpoint reflects true
    const resFlags = await fetch(`${baseUrl}/api/features`);
    const flags = await resFlags.json();
    assert.equal(flags.revision, true);
    assert.equal(flags.contests, true);
    assert.equal(flags.badges, true);

    // 2. Unauthenticated calls to protected POST endpoints return 401
    const postRevision = await fetch(`${baseUrl}/api/revision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problemSlug: "two-sum" }) });
    assert.equal(postRevision.status, 401);

    const postMock = await fetch(`${baseUrl}/api/mock/sessions`, { method: "POST" });
    assert.equal(postMock.status, 401);

    const postNotes = await fetch(`${baseUrl}/api/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problemSlug: "two-sum" }) });
    assert.equal(postNotes.status, 401);

    // 3. Public GET endpoints respond with 200
    const getRevision = await fetch(`${baseUrl}/api/revision`);
    assert.equal(getRevision.status, 200);

    const getContests = await fetch(`${baseUrl}/api/contests`);
    assert.equal(getContests.status, 200);

    const getBadges = await fetch(`${baseUrl}/api/badges`);
    assert.equal(getBadges.status, 200);

    const postHints = await fetch(`${baseUrl}/api/hints`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problemSlug: "two-sum", level: "nudge" }) });
    assert.equal(postHints.status, 200);
    const hintData = await postHints.json();
    assert.equal(hintData.level, "nudge");
    assert.equal(hintData.safetyVerified, true);
  } finally {
    server.close();
    process.env = savedEnv;
  }
});
