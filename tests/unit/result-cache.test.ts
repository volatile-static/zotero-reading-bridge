import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResultCache } from "../../packages/zotero/src/tools/result-cache.js";

function clock(start = 1000): { now: () => number; advance: (ms: number) => void } {
  let time = start;
  return { now: () => time, advance: (ms) => (time += ms) };
}

describe("ResultCache", () => {
  it("never caches while disabled (the default), so every call recomputes", async () => {
    const cache = new ResultCache<number>(4, 60_000);
    let runs = 0;
    for (let i = 0; i < 3; i++) await cache.getOrCompute("k", () => ++runs);
    assert.equal(runs, 3);
    assert.equal(cache.size, 0);
  });

  it("serves a cached value until it expires", async () => {
    const time = clock();
    const cache = new ResultCache<string>(4, 100, time.now);
    cache.enable();
    let runs = 0;
    const compute = () => `v${++runs}`;
    assert.equal(await cache.getOrCompute("k", compute), "v1");
    time.advance(99);
    assert.equal(await cache.getOrCompute("k", compute), "v1");
    time.advance(1);
    assert.equal(await cache.getOrCompute("k", compute), "v2");
  });

  it("evicts the least recently used entry beyond maxEntries", async () => {
    const cache = new ResultCache<string>(2, 60_000);
    cache.enable();
    await cache.getOrCompute("a", () => "A");
    await cache.getOrCompute("b", () => "B");
    assert.equal(cache.get("a"), "A"); // a is now the most recent
    await cache.getOrCompute("c", () => "C");
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), "A");
    assert.equal(cache.get("c"), "C");
  });

  it("clear() drops everything and a computation that overlapped it is not stored", async () => {
    const cache = new ResultCache<string>(4, 60_000);
    cache.enable();
    await cache.getOrCompute("k", () => "old");
    cache.clear();
    assert.equal(cache.get("k"), undefined);
    const value = await cache.getOrCompute("k", async () => {
      cache.clear(); // a library change arrives while the search runs
      return "stale";
    });
    assert.equal(value, "stale");
    assert.equal(cache.get("k"), undefined, "a result computed across a change must not be cached");
  });

  it("does not store failures, and disable() empties the cache", async () => {
    const cache = new ResultCache<string>(4, 60_000);
    cache.enable();
    await assert.rejects(cache.getOrCompute("k", () => Promise.reject(new Error("boom"))));
    assert.equal(cache.size, 0);
    await cache.getOrCompute("k", () => "v");
    cache.disable();
    assert.equal(cache.enabled, false);
    assert.equal(cache.size, 0);
  });
});
