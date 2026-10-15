import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boolArg,
  enumSet,
  hasSearchFilters,
  intArg,
  keyList,
  normalizeSearchArgs,
  optionalKey,
  requireKey,
  textArg,
} from "../../packages/zotero/src/tools/data-args.js";
import { ToolError } from "../../packages/zotero/src/tools/types.js";

const invalid = (code = "INVALID_ARGUMENT") => (error: unknown) =>
  error instanceof ToolError && error.code === code;

describe("key arguments", () => {
  it("accepts Zotero keys and rejects anything else", () => {
    assert.equal(requireKey({ key: "ABCD2345" }), "ABCD2345");
    for (const key of ["abcd2345", "ABCD234", "ABCD23450", "ABCD0345", "ABCDO345", "ABCD1345", 12345678, undefined]) {
      assert.throws(() => requireKey({ key }), invalid());
    }
    assert.equal(optionalKey({}, "parentKey"), null);
    assert.throws(() => optionalKey({ parentKey: "x" }, "parentKey"), invalid());
  });

  it("de-duplicates key lists in request order and enforces bounds", () => {
    assert.deepEqual(keyList({ keys: ["BBBB2222", "AAAA2222", "BBBB2222"] }, "keys", 50), ["BBBB2222", "AAAA2222"]);
    assert.throws(() => keyList({ keys: [] }, "keys", 50), invalid());
    assert.throws(() => keyList({ keys: ["AAAA2222", "AAAA2223", "AAAA2224"] }, "keys", 2), invalid());
    assert.throws(() => keyList({ keys: ["AAAA2222", 3] }, "keys", 50), invalid());
    assert.throws(() => keyList({ keys: "AAAA2222" }, "keys", 50), invalid());
  });
});

describe("scalar arguments", () => {
  it("falls back to defaults for missing or mistyped values", () => {
    assert.equal(boolArg({}, "x", true), true);
    assert.equal(boolArg({ x: "false" }, "x", true), true);
    assert.equal(boolArg({ x: false }, "x", true), false);
    assert.equal(intArg({}, "n", 20, 1, 100), 20);
    assert.equal(intArg({ n: 2.5 }, "n", 20, 1, 100), 20);
    assert.equal(intArg({ n: 500 }, "n", 20, 1, 100), 100);
    assert.equal(intArg({ n: -3 }, "n", 20, 1, 100), 1);
    assert.equal(textArg({ q: "  x  " }, "q"), "x");
    assert.equal(textArg({ q: "   " }, "q"), null);
    assert.equal(textArg({ q: 3 }, "q"), null);
  });

  it("reads enum lists as sets and rejects unknown members", () => {
    const allowed = ["note", "attachment"] as const;
    assert.equal(enumSet({}, "types", allowed), null);
    assert.deepEqual([...(enumSet({ types: ["note", "note"] }, "types", allowed) ?? [])], ["note"]);
    assert.throws(() => enumSet({ types: ["other"] }, "types", allowed), invalid());
    assert.throws(() => enumSet({ types: "note" }, "types", allowed), invalid());
  });
});

describe("normalizeSearchArgs", () => {
  it("applies defaults", () => {
    assert.deepEqual(normalizeSearchArgs({ query: " 深度 学习 " }), {
      query: "深度 学习",
      mode: "titleCreatorYear",
      tags: [],
      creator: null,
      itemType: null,
      collectionKey: null,
      includeChildItems: false,
      sort: "dateModified",
      direction: "desc",
    });
  });

  it("keeps explicit options and cleans tags", () => {
    const request = normalizeSearchArgs({
      mode: "fulltext",
      tags: [" to read ", "to read", "", "方法"],
      creator: "Smith",
      itemType: "journalArticle",
      collectionKey: "ABCD2345",
      includeChildItems: true,
      sort: "title",
      direction: "asc",
    });
    assert.deepEqual(request.tags, ["to read", "方法"]);
    assert.equal(request.query, null);
    assert.equal(request.mode, "fulltext");
    assert.equal(request.sort, "title");
    assert.equal(request.direction, "asc");
    assert.equal(request.includeChildItems, true);
  });

  it("ignores unknown enum values instead of passing them to Zotero", () => {
    const request = normalizeSearchArgs({ query: "x", mode: "regexp", sort: "creator", direction: "up" });
    assert.equal(request.mode, "titleCreatorYear");
    assert.equal(request.sort, "dateModified");
    assert.equal(request.direction, "desc");
  });

  it("requires a query or a filter", () => {
    assert.throws(() => normalizeSearchArgs({}), invalid());
    assert.throws(() => normalizeSearchArgs({ query: "   ", tags: ["  "] }), invalid());
    assert.throws(() => normalizeSearchArgs({ mode: "fields", includeChildItems: true }), invalid());
    assert.equal(normalizeSearchArgs({ itemType: "book" }).itemType, "book");
    assert.equal(normalizeSearchArgs({ collectionKey: "ABCD2345" }).collectionKey, "ABCD2345");
  });

  it("validates the collection key", () => {
    assert.throws(() => normalizeSearchArgs({ collectionKey: "nope" }), invalid());
  });

  it("strips the invisible bidi isolates of Zotero creator summaries from creator and query text", () => {
    const request = normalizeSearchArgs({ creator: "⁨Smith⁩", query: " ⁨Smith⁩ and ⁨Jones⁩ " });
    assert.equal(request.creator, "Smith");
    assert.equal(request.query, "Smith and Jones");
    assert.throws(() => normalizeSearchArgs({ creator: "⁨⁩" }), invalid());
  });

  it("reports whether any filter is set", () => {
    assert.equal(hasSearchFilters(normalizeSearchArgs({ query: "x" })), false);
    assert.equal(hasSearchFilters(normalizeSearchArgs({ query: "x", creator: "Lee" })), true);
    assert.equal(hasSearchFilters(normalizeSearchArgs({ tags: ["a"] })), true);
  });
});
