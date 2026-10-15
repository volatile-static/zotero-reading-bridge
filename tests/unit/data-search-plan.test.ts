import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSearchArgs } from "../../packages/zotero/src/tools/data-args.js";
import {
  contentTermProblem,
  dateSortValue,
  filterConditions,
  queryConditions,
  sortEntries,
  type SearchTerm,
} from "../../packages/zotero/src/tools/search-plan.js";
import { ToolError } from "../../packages/zotero/src/tools/types.js";

const words = (...texts: string[]): SearchTerm[] => texts.map((text) => ({ text, inQuotes: false }));
const always = (): boolean => true;
const never = (): boolean => false;

describe("filterConditions", () => {
  it("restricts results to top-level items and ANDs every filter", () => {
    const request = normalizeSearchArgs({
      tags: ["a", "b"],
      creator: "Smith",
      itemType: "book",
      collectionKey: "ABCD2345",
    });
    assert.deepEqual(filterConditions(request, false), [
      { condition: "resultLevel", operator: "item" },
      { condition: "tag", operator: "is", value: "a" },
      { condition: "tag", operator: "is", value: "b" },
      { condition: "creator", operator: "contains", value: "Smith" },
      { condition: "itemType", operator: "is", value: "book" },
      { condition: "collection", operator: "is", value: "ABCD2345" },
    ]);
  });

  it("includes subcollections only when Zotero's recursiveCollections pref is on", () => {
    const request = normalizeSearchArgs({ collectionKey: "ABCD2345" });
    assert.deepEqual(filterConditions(request, true).slice(-2), [
      { condition: "collection", operator: "is", value: "ABCD2345" },
      { condition: "recursive", operator: "true" },
    ]);
    assert.deepEqual(filterConditions(request, false).slice(-1), [
      { condition: "collection", operator: "is", value: "ABCD2345" },
    ]);
  });

  it("never adds the recursive flag without a collection filter", () => {
    assert.deepEqual(filterConditions(normalizeSearchArgs({ tags: ["方法"] }), true), [
      { condition: "resultLevel", operator: "item" },
      { condition: "tag", operator: "is", value: "方法" },
    ]);
  });
});

describe("queryConditions", () => {
  it("passes the raw query to the quick-search expansion of each mode", () => {
    for (const mode of ["titleCreatorYear", "fields", "everything"] as const) {
      assert.deepEqual(queryConditions(mode, 'deep "neural net"', words("deep", "neural net"), never), [
        { condition: `quicksearch-${mode}`, operator: "contains", value: 'deep "neural net"' },
      ]);
    }
  });

  it("returns no condition when every term is empty", () => {
    assert.deepEqual(queryConditions("fields", '""', [{ text: "", inQuotes: true }], always), []);
    assert.deepEqual(queryConditions("fulltext", '""', [{ text: " ", inQuotes: true }], always), []);
  });

  it("adds one full-text condition per term when the index can answer every term", () => {
    const terms: SearchTerm[] = [
      { text: "climate", inQuotes: false },
      { text: "sea level", inQuotes: true },
      { text: "气候变化", inQuotes: false },
    ];
    assert.deepEqual(queryConditions("fulltext", 'climate "sea level" 气候变化', terms, always), [
      { condition: "fulltextContent", operator: "contains", value: "climate" },
      { condition: "fulltextContent", operator: "contains", value: "sea level" },
      { condition: "fulltextContent", operator: "contains", value: "气候变化" },
    ]);
  });

  const indexable = (text: string): boolean => contentTermProblem(text) === null;
  const rejection = (run: () => unknown): ToolError => {
    try {
      run();
    } catch (error) {
      assert.ok(error instanceof ToolError && error.code === "INVALID_ARGUMENT", String(error));
      return error;
    }
    assert.fail("expected INVALID_ARGUMENT");
  };

  it("fulltext: names every term the index cannot answer instead of silently searching the rest", () => {
    const error = rejection(() => queryConditions("fulltext", "AI ethics", words("AI", "ethics"), indexable));
    assert.match(error.message, /"AI" is a single word shorter than 3 letters/);
    assert.match(error.message, /nothing was searched/);
    assert.deepEqual(error.details, {
      mode: "fulltext",
      unsearchableTerms: [{ term: "AI", quoted: false, reason: "is a single word shorter than 3 letters" }],
    });
    rejection(() => queryConditions("fulltext", "ab cd", words("ab", "cd"), never));
  });

  it("fulltext: quoting no longer forces a term the index cannot answer (Zotero would scan every attachment)", () => {
    for (const text of ["AI模型", "COVID-19疫情", "5G网络", "模", "++", "co"]) {
      const error = rejection(() => queryConditions("fulltext", `"${text}"`, [{ text, inQuotes: true }], indexable));
      assert.equal((error.details?.["unsearchableTerms"] as Array<{ quoted: boolean }>)[0]?.quoted, true, text);
    }
    const mixed = rejection(() => queryConditions("fulltext", '"AI模型"', [{ text: "AI模型", inQuotes: true }], indexable));
    assert.match(mixed.message, /mixes CJK characters with Latin letters or digits/);
  });

  it("everything: rejects quoted terms the index cannot answer, keeps unquoted short or mixed words", () => {
    const quoted = rejection(() =>
      queryConditions("everything", 'deep "AI模型"', [{ text: "deep", inQuotes: false }, { text: "AI模型", inQuotes: true }], indexable),
    );
    assert.match(quoted.message, /Remove the double quotes/);
    assert.deepEqual(queryConditions("everything", "AI模型 ML", words("AI模型", "ML"), indexable), [
      { condition: "quicksearch-everything", operator: "contains", value: "AI模型 ML" },
    ]);
    // titleCreatorYear and fields never touch the content index.
    for (const mode of ["titleCreatorYear", "fields"] as const) {
      assert.equal(queryConditions(mode, '"AI模型"', [{ text: "AI模型", inQuotes: true }], never).length, 1);
    }
  });
});

describe("contentTermProblem (mirror of Zotero's content-index rules)", () => {
  it("accepts words of 3+ letters, multi-word phrases and 2+ CJK characters", () => {
    for (const text of ["climate", "sea level", "in AI", "气候", "深度学习", "Ünïcödé", "c++ code", "2023"]) {
      assert.equal(contentTermProblem(text), null, text);
    }
  });

  it("explains each kind of term the index cannot answer", () => {
    assert.match(contentTermProblem("AI模型") ?? "", /mixes CJK/);
    assert.match(contentTermProblem("模") ?? "", /fewer than 2 adjacent CJK/);
    assert.match(contentTermProblem("模 型") ?? "", /fewer than 2 adjacent CJK/);
    assert.match(contentTermProblem("--") ?? "", /no letters or digits/);
    assert.match(contentTermProblem("AI") ?? "", /shorter than 3 letters/);
    assert.match(contentTermProblem("é") ?? "", /shorter than 3 letters/);
  });
});

describe("sortEntries", () => {
  const entries = [
    { value: "2024-01-02 00:00:00", key: "CCCC2222", data: "c" },
    { value: "", key: "AAAA2222", data: "empty-a" },
    { value: "2023-05-01 00:00:00", key: "BBBB2222", data: "b" },
    { value: "2024-01-02 00:00:00", key: "AAAA3333", data: "a-tie" },
    { value: "", key: "0000ZZZZ", data: "empty-0" },
  ];

  it("orders descending with key tie-breaks and unknown values last", () => {
    assert.deepEqual(sortEntries(entries, "desc"), ["a-tie", "c", "b", "empty-0", "empty-a"]);
  });

  it("orders ascending with the same tie-break and unknown values still last", () => {
    assert.deepEqual(sortEntries(entries, "asc"), ["b", "a-tie", "c", "empty-0", "empty-a"]);
  });

  it("uses the supplied comparator and leaves the input untouched", () => {
    const titles = [
      { value: "b", key: "K2", data: 2 },
      { value: "A", key: "K1", data: 1 },
      { value: "a", key: "K3", data: 3 },
    ];
    const folded = (x: string, y: string): number => x.toLowerCase().localeCompare(y.toLowerCase());
    assert.deepEqual(sortEntries(titles, "asc", folded), [1, 3, 2]);
    assert.deepEqual(
      titles.map((t) => t.data),
      [2, 1, 3],
    );
  });
});

describe("dateSortValue", () => {
  it("treats missing and unparsable dates as unknown", () => {
    assert.equal(dateSortValue(""), "");
    assert.equal(dateSortValue("0000-00-00"), "");
    assert.equal(dateSortValue("2020-00-00"), "2020-00-00");
    assert.equal(dateSortValue("1999-12-31"), "1999-12-31");
  });
});
