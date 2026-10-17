import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sliceEnd } from "../../packages/zotero/src/tools/fulltext-slice.js";
import { ImageBudget } from "../../packages/zotero/src/tools/image-budget.js";
import { base64Encode } from "../../packages/zotero/src/util/base64.js";
import { ANNOTATION_IMAGE_LIMITS, FULLTEXT_LIMITS } from "../../shared/types/tools.js";

describe("base64Encode", () => {
  it("matches Node's encoder for every padding case", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 6, 255, 256, 257]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 255);
      assert.equal(base64Encode(bytes), Buffer.from(bytes).toString("base64"), `length ${length}`);
    }
  });

  it("handles inputs larger than one flush chunk", () => {
    const bytes = Uint8Array.from({ length: 200_003 }, (_, i) => (i * 7) & 255);
    assert.equal(base64Encode(bytes), Buffer.from(bytes).toString("base64"));
  });
});

describe("ImageBudget", () => {
  it("admits images until the per-call budget is spent", () => {
    const budget = new ImageBudget({ perImageBytes: 100, perCallBytes: 150 });
    assert.equal(budget.admit(100), null);
    assert.match(budget.admit(60) ?? "", /already carries 100 bytes/);
    assert.equal(budget.admit(50), null);
  });

  it("refuses a single image over the per-image cap without spending budget", () => {
    const budget = new ImageBudget({ perImageBytes: 100, perCallBytes: 150 });
    assert.match(budget.admit(101) ?? "", /over the 100-byte limit/);
    assert.equal(budget.admit(100), null);
  });

  it("defaults to the shared limits", () => {
    const budget = new ImageBudget();
    assert.equal(budget.admit(ANNOTATION_IMAGE_LIMITS.perImageBytes), null);
    assert.notEqual(budget.admit(ANNOTATION_IMAGE_LIMITS.perImageBytes + 1), null);
  });
});

describe("sliceEnd", () => {
  const tokens = (maxTokens: number) => ({ maxChars: null, maxTokens });

  it("returns a whole text that fits the budget", () => {
    const text = "word ".repeat(1000);
    assert.equal(sliceEnd(text, 0, tokens(FULLTEXT_LIMITS.defaultTokenBudget)), text.length);
  });

  it("fits about four ASCII characters per token and one CJK character per token", () => {
    assert.equal(sliceEnd("a".repeat(1000), 0, tokens(100)), 400);
    assert.equal(sliceEnd("文".repeat(1000), 0, tokens(100)), 100);
  });

  it("ends after a line break near the cut", () => {
    const text = `${"a".repeat(90)}\n${"b".repeat(100)}`;
    assert.equal(sliceEnd(text, 0, { maxChars: 100, maxTokens: 0 }), 91);
  });

  it("ignores a line break far from the cut", () => {
    const text = `${"a".repeat(10)}\n${"b".repeat(200)}`;
    assert.equal(sliceEnd(text, 0, { maxChars: 100, maxTokens: 0 }), 100);
  });

  it("never splits a surrogate pair", () => {
    const text = `${"a".repeat(99)}😀${"b".repeat(50)}`;
    assert.equal(sliceEnd(text, 0, { maxChars: 100, maxTokens: 0 }), 99);
  });

  it("continues from an offset and always makes progress", () => {
    const text = "abcdef";
    assert.equal(sliceEnd(text, 2, { maxChars: 2, maxTokens: 0 }), 4);
    assert.equal(sliceEnd(text, 2, tokens(0)), 3);
    assert.equal(sliceEnd(text, 6, tokens(10)), 6);
  });
});
