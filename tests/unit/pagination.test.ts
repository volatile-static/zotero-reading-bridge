import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from "../../shared/types/bridge.js";
import { encodeCursor, paginate, paginateMapped, parsePageArgs } from "../../packages/zotero/src/tools/pagination.js";
import { ToolError } from "../../packages/zotero/src/tools/types.js";

describe("parsePageArgs", () => {
  it("defaults to the first page of PAGE_LIMIT_DEFAULT", () => {
    assert.deepEqual(parsePageArgs({}), { offset: 0, limit: PAGE_LIMIT_DEFAULT });
  });

  it("clamps limits into [1, PAGE_LIMIT_MAX] and ignores non-integers", () => {
    assert.equal(parsePageArgs({ limit: 0 }).limit, 1);
    assert.equal(parsePageArgs({ limit: 10_000 }).limit, PAGE_LIMIT_MAX);
    assert.equal(parsePageArgs({ limit: 2.5 }).limit, PAGE_LIMIT_DEFAULT);
    assert.equal(parsePageArgs({ limit: "7" }).limit, PAGE_LIMIT_DEFAULT);
  });

  it("round-trips cursors produced by encodeCursor", () => {
    for (const offset of [0, 1, 50, 123456789]) {
      assert.equal(parsePageArgs({ cursor: encodeCursor(offset) }).offset, offset);
    }
  });

  it("rejects malformed cursors with INVALID_ARGUMENT and clips the echoed value", () => {
    for (const cursor of ["", "o", "o-1", "o01", "x5", "o1234567890", "o1 ", 5, null]) {
      assert.throws(
        () => parsePageArgs({ cursor }),
        (error: unknown) => error instanceof ToolError && error.code === "INVALID_ARGUMENT",
        String(cursor),
      );
    }
    try {
      parsePageArgs({ cursor: "z".repeat(1000) });
      assert.fail("expected ToolError");
    } catch (error) {
      assert.ok(error instanceof ToolError);
      assert.equal((error.details?.["cursor"] as string).length, 64);
    }
  });
});

describe("paginate", () => {
  const all = Array.from({ length: 5 }, (_, i) => i);

  it("returns a page with an opaque next cursor", () => {
    assert.deepEqual(paginate(all, { offset: 0, limit: 2 }), { items: [0, 1], total: 5, offset: 0, limit: 2, nextCursor: "o2" });
    assert.deepEqual(paginate(all, { offset: 4, limit: 2 }), { items: [4], total: 5, offset: 4, limit: 2, nextCursor: null });
  });

  it("returns an empty last page past the end", () => {
    assert.deepEqual(paginate(all, { offset: 10, limit: 2 }), { items: [], total: 5, offset: 10, limit: 2, nextCursor: null });
    assert.equal(paginate([], { offset: 0, limit: 50 }).nextCursor, null);
  });

  it("walks the whole list exactly once", () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const page = paginate(all, parsePageArgs({ limit: 2, cursor }));
      seen.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(seen, all);
  });
});

describe("paginateMapped", () => {
  it("materializes only the requested slice", async () => {
    const mapped: number[] = [];
    const page = await paginateMapped([10, 11, 12, 13], { offset: 1, limit: 2 }, (key) => {
      mapped.push(key);
      return `item${key}`;
    });
    assert.deepEqual(mapped, [11, 12]);
    assert.deepEqual(page, { items: ["item11", "item12"], total: 4, offset: 1, limit: 2, nextCursor: "o3" });
  });

  it("drops null mappings but keeps totals and cursors based on the key list", async () => {
    const page = await paginateMapped([1, 2, 3], { offset: 0, limit: 2 }, async (key) => (key === 1 ? null : key));
    assert.deepEqual(page, { items: [2], total: 3, offset: 0, limit: 2, nextCursor: "o2" });
  });
});
