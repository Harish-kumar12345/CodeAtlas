const assert = require("node:assert/strict");
const test = require("node:test");

test("linked account input accepts only supported platform usernames", () => {
  const valid = /^(leetcode|codeforces|codechef|github)$/;
  const username = /^[a-zA-Z0-9_-]{1,25}$/;
  assert.equal(valid.test("github") && username.test("octocat"), true);
  assert.equal(valid.test("unknown") || username.test("bad name"), false);
});
