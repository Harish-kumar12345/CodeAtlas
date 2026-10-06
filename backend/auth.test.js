const assert = require("node:assert/strict");
const test = require("node:test");
const { createToken, readToken } = require("./auth");

test("signed session tokens reject tampering and expire", () => {
  const token = createToken({ userId: "user-a" }, 60);
  assert.equal(readToken(token).userId, "user-a");
  assert.equal(readToken(`${token}tampered`), null);
  assert.equal(readToken(createToken({ userId: "expired" }, -1)), null);
});
