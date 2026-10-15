import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANNOTATION_TEXT_MAX,
  annotationPageIndex,
  containsFolded,
  creatorInfos,
  itemFieldsFromJSON,
  relationsFromJSON,
  summarizeSearchConditions,
  tagInfos,
} from "../../packages/zotero/src/tools/data-format.js";

describe("itemFieldsFromJSON", () => {
  it("keeps non-empty scalar fields and drops bookkeeping and bulky keys", () => {
    const json = {
      key: "ABCD2345",
      version: 12,
      itemType: "attachment",
      title: "全文 PDF",
      url: "",
      parentItem: "BBBB2222",
      linkMode: "imported_file",
      contentType: "application/pdf",
      lastRead: 1700000000,
      note: "<p>long html</p>",
      tags: [{ tag: "x" }],
      collections: ["CCCC2222"],
      relations: {},
      dateAdded: "2024-01-01T00:00:00Z",
      dateModified: "2024-01-02T00:00:00Z",
      annotationPosition: '{"pageIndex":0}',
      deleted: true,
      inPublications: true,
      nested: { a: 1 },
    };
    assert.deepEqual(itemFieldsFromJSON(json), {
      title: "全文 PDF",
      linkMode: "imported_file",
      contentType: "application/pdf",
      lastRead: "1700000000",
    });
  });

  it("caps annotation text and comment at ANNOTATION_TEXT_MAX with an ellipsis, other text untouched", () => {
    const huge = "高".repeat(ANNOTATION_TEXT_MAX + 10);
    const fields = itemFieldsFromJSON({
      itemType: "annotation",
      annotationText: huge,
      annotationComment: `${"😀".repeat(ANNOTATION_TEXT_MAX)}`,
      annotationColor: "#ffd400",
      abstractNote: huge,
    });
    assert.equal(fields["annotationText"]?.length, ANNOTATION_TEXT_MAX);
    assert.ok(fields["annotationText"]?.endsWith("…"));
    assert.ok((fields["annotationComment"]?.length ?? 0) <= ANNOTATION_TEXT_MAX);
    assert.match(fields["annotationComment"] ?? "", /^(?:😀)+…$/u, "no split surrogate pair");
    assert.equal(fields["abstractNote"], huge);
    const short = itemFieldsFromJSON({ annotationText: "short", annotationComment: "c" });
    assert.deepEqual(short, { annotationText: "short", annotationComment: "c" });
  });
});

describe("creatorInfos", () => {
  it("maps two-field and single-field creators and skips junk", () => {
    assert.deepEqual(
      creatorInfos([
        { creatorType: "author", firstName: "三", lastName: "张" },
        { creatorType: "editor", name: "WHO" },
        null,
        "x",
        { lastName: "Solo" },
      ]),
      [
        { creatorType: "author", firstName: "三", lastName: "张" },
        { creatorType: "editor", name: "WHO" },
        { creatorType: "author", lastName: "Solo" },
      ],
    );
    assert.deepEqual(creatorInfos(undefined), []);
  });
});

describe("relationsFromJSON", () => {
  it("keeps string and string-array targets only", () => {
    assert.deepEqual(
      relationsFromJSON({
        "dc:relation": ["http://zotero.org/users/1/items/AAAA2222", 5],
        "owl:sameAs": "http://zotero.org/groups/2/items/BBBB2222",
        "dc:replaces": [],
        bad: { x: 1 },
      }),
      {
        "dc:relation": ["http://zotero.org/users/1/items/AAAA2222"],
        "owl:sameAs": "http://zotero.org/groups/2/items/BBBB2222",
      },
    );
    assert.deepEqual(relationsFromJSON(null), {});
    assert.deepEqual(relationsFromJSON(["x"]), {});
  });
});

describe("tagInfos", () => {
  it("normalizes missing and string tag types", () => {
    assert.deepEqual(tagInfos([{ tag: "manual" }, { tag: "auto", type: 1 }, { tag: "auto2", type: "1" }, { tag: "m", type: 0 }]), [
      { tag: "manual", type: 0 },
      { tag: "auto", type: 1 },
      { tag: "auto2", type: 1 },
      { tag: "m", type: 0 },
    ]);
  });
});

describe("annotationPageIndex", () => {
  it("prefers the PDF position's pageIndex", () => {
    assert.equal(annotationPageIndex({ pageIndex: 4, rects: [] }, "00009|000100|00200"), 4);
  });

  it("falls back to a PDF sortIndex", () => {
    assert.equal(annotationPageIndex(null, "00012|000345|00067"), 12);
    assert.equal(annotationPageIndex({ pageIndex: -1 }, "00003|000000|00000"), 3);
  });

  it("returns null for EPUB/snapshot annotations", () => {
    assert.equal(annotationPageIndex({ type: "FragmentSelector", value: "epubcfi(/6/4)" }, "00001|00001234"), null);
    assert.equal(annotationPageIndex({ type: "CssSelector", value: "p" }, "0001234"), null);
    assert.equal(annotationPageIndex(null, null), null);
  });
});

describe("containsFolded", () => {
  it("matches case-insensitively and across Unicode normalization forms", () => {
    assert.ok(containsFolded("Machine Learning", "LEARN"));
    assert.ok(containsFolded("Café", "café"));
    assert.ok(containsFolded("深度学习", "学习"));
    assert.ok(!containsFolded("Graph", "graphs"));
  });
});

describe("summarizeSearchConditions", () => {
  it("joins top-level conditions with the search's join mode and lists flags", () => {
    assert.equal(
      summarizeSearchConditions([
        { condition: "joinMode", operator: "any" },
        { condition: "title", mode: false, operator: "contains", value: "graph" },
        { condition: "tag", mode: false, operator: "is", value: 'say "hi"' },
        { condition: "abstractNote", mode: false, operator: "isEmpty", value: "" },
        { condition: "recursive", operator: "true" },
        { condition: "noChildren", operator: "false" },
      ]),
      'title contains "graph" OR tag is "say \\"hi\\"" OR abstractNote isEmpty [recursive]',
    );
  });

  it("renders Zotero 11 condition groups, modes and result levels", () => {
    assert.equal(
      summarizeSearchConditions([
        { condition: "collection", operator: "is", value: "Reading (ABCD2345)" },
        { condition: "groupStart", operator: "true", value: "" },
        { condition: "joinMode", operator: "any" },
        { condition: "resultLevel", operator: "annotation" },
        { condition: "annotationText", operator: "contains", value: "x" },
        { condition: "annotationColor", operator: "is", value: "#ffd400" },
        { condition: "groupEnd", operator: "true", value: "" },
        { condition: "fulltextContent", mode: "regexp", operator: "contains", value: "a+b" },
      ]),
      'collection is "Reading (ABCD2345)" AND ([annotation level] annotationText contains "x" OR annotationColor is "#ffd400") AND fulltextContent/regexp contains "a+b"',
    );
  });

  it("tolerates unbalanced groups and empty searches", () => {
    assert.equal(
      summarizeSearchConditions([
        { condition: "groupEnd", operator: "true" },
        { condition: "groupStart", operator: "true" },
        { condition: "title", operator: "contains", value: "t" },
      ]),
      'title contains "t"',
    );
    assert.equal(summarizeSearchConditions([]), "(no conditions: matches all items)");
    assert.equal(summarizeSearchConditions([{ condition: "deleted", operator: "true" }]), "(no conditions: matches all items) [deleted]");
  });

  it("caps the summary length without splitting surrogate pairs", () => {
    const long = summarizeSearchConditions([{ condition: "title", operator: "contains", value: "😀".repeat(100) }], 20);
    assert.ok(long.length <= 20);
    assert.ok(long.endsWith("…"));
    assert.ok(!/[\ud800-\udbff]…$/.test(long));
  });
});
