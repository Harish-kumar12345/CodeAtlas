const assert = require("node:assert/strict");
const { TtlCache } = require("./cache");

const cache = new TtlCache({ ttlMs: 10, maxEntries: 2 });
cache.set("one", 1);
assert.equal(cache.get("one"), 1);
cache.set("two", 2);
cache.set("three", 3);
assert.equal(cache.get("one"), undefined);
setTimeout(() => {
  assert.equal(cache.get("two"), undefined);
  console.log("cache tests passed");
}, 15);
