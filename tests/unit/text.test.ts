import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  htmlToPlainTextFallback,
  normalizeWhitespace,
  sanitizeIdentifier,
  stripBidiIsolates,
  truncateText,
} from "../../packages/zotero/src/util/text.js";

describe("truncateText", () => {
  it("keeps short text untouched", () => {
    assert.deepEqual(truncateText("abc", 3), { text: "abc", length: 3, truncated: false });
  });

  it("truncates and reports the original length", () => {
    assert.deepEqual(truncateText("中文文本", 2), { text: "中文", length: 4, truncated: true });
  });

  it("never splits a surrogate pair", () => {
    const value = "a😀b";
    const cut = truncateText(value, 2);
    assert.equal(cut.text, "a");
    assert.equal(cut.truncated, true);
    assert.equal(truncateText(value, 3).text, "a😀");
  });

  it("handles a zero or negative budget", () => {
    assert.deepEqual(truncateText("abc", 0), { text: "", length: 3, truncated: true });
    assert.equal(truncateText("abc", -5).text, "");
  });
});

describe("normalizeWhitespace", () => {
  it("collapses runs, normalizes newlines and keeps paragraph breaks", () => {
    assert.equal(normalizeWhitespace("  a \t b\r\nc\r\r\n\n\n\nd  "), "a b\nc\n\nd");
  });

  it("treats non-breaking spaces as spaces", () => {
    assert.equal(normalizeWhitespace("a  b"), "a b");
  });
});

describe("htmlToPlainTextFallback", () => {
  it("turns block elements and breaks into newlines", () => {
    assert.equal(htmlToPlainTextFallback("<h1>Title</h1><p>One<br/>Two</p><ul><li>x</li><li>y</li></ul>"), "Title\nOne\nTwo\n- x\n- y");
  });

  it("drops script and style content", () => {
    assert.equal(htmlToPlainTextFallback("<style>p{}</style><p>Text</p><script>alert(1)</script>"), "Text");
  });

  it("decodes named and numeric entities", () => {
    assert.equal(htmlToPlainTextFallback("&lt;a&gt; &amp; &quot;q&quot; &#20013;&#x6587; &#x1F600;"), '<a> & "q" 中文 😀');
  });

  it("leaves unknown or out-of-range entities alone", () => {
    assert.equal(htmlToPlainTextFallback("&bogus; &#x110000;"), "&bogus; &#x110000;");
  });
});

describe("sanitizeIdentifier", () => {
  it("maps absent and blank values to null", () => {
    assert.equal(sanitizeIdentifier(undefined), null);
    assert.equal(sanitizeIdentifier(null), null);
    assert.equal(sanitizeIdentifier(""), null);
    assert.equal(sanitizeIdentifier(" \u0000 "), null);
  });

  it("strips control characters and caps the length", () => {
    assert.equal(sanitizeIdentifier("ab\u0007c\nd\u007f"), "abcd");
    assert.equal(sanitizeIdentifier("x".repeat(300))?.length, 128);
    assert.equal(sanitizeIdentifier("abcdef", 3), "abc");
  });
});

describe("stripBidiIsolates", () => {
  it("removes the isolates Zotero wraps two-creator summaries in and nothing else", () => {
    assert.equal(stripBidiIsolates("⁨张⁩ and ⁨李⁩"), "张 and 李");
    assert.equal(stripBidiIsolates("Smith et al."), "Smith et al.");
    assert.equal(stripBidiIsolates("‏⁧x⁩"), "‏⁧x");
  });
});
