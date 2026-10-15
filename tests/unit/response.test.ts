import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyResponse, escapeNonAscii, jsonResponse } from "../../packages/zotero/src/server/response.js";

describe("escapeNonAscii", () => {
  it("escapes every non-ASCII code unit and round-trips through JSON.parse", () => {
    const value = { title: "中文标题 — café 😀", line: "a b c", ctrl: "\u0001\u007f" };
    const escaped = escapeNonAscii(JSON.stringify(value));
    assert.match(escaped, /^[\x00-\x7f]*$/);
    assert.ok(escaped.includes("\\u4e2d\\u6587"));
    assert.ok(escaped.includes("\\ud83d\\ude00"), "astral characters become a surrogate-pair escape");
    assert.deepEqual(JSON.parse(escaped), value);
  });

  it("keeps lone surrogates valid (JSON.stringify already escapes them)", () => {
    const value = { broken: "x\ud800y\udc00z" };
    const escaped = escapeNonAscii(JSON.stringify(value));
    assert.match(escaped, /^[\x00-\x7f]*$/);
    assert.equal(Buffer.from(escaped, "utf8").toString("utf8"), escaped, "survives a UTF-8 round trip unchanged");
    assert.deepEqual(JSON.parse(escaped), value);
  });

  it("leaves ASCII JSON untouched", () => {
    const json = JSON.stringify({ a: [1, "b", null, true] });
    assert.equal(escapeNonAscii(json), json);
  });
});

describe("jsonResponse", () => {
  it("sets lowercase application/json, an exact byte Content-Length and Connection: close", () => {
    const response = jsonResponse(200, { text: "注释 annotation 😀" });
    assert.equal(response.status, 200);
    assert.equal(response.headers["Content-Type"], "application/json");
    assert.equal(response.headers["Content-Length"], String(Buffer.byteLength(response.body, "utf8")));
    assert.equal(response.headers["Connection"], "close");
    assert.deepEqual(JSON.parse(response.body), { text: "注释 annotation 😀" });
  });

  it("keeps extra headers but never lets them override framing headers", () => {
    const response = jsonResponse(405, { error: 1 }, { Allow: "POST", "Content-Type": "text/html", "Content-Length": "1" });
    assert.equal(response.headers["Allow"], "POST");
    assert.equal(response.headers["Content-Type"], "application/json");
    assert.equal(response.headers["Content-Length"], String(response.body.length));
  });

  it("never emits session or CORS headers", () => {
    const names = Object.keys(jsonResponse(200, {}).headers).map((name) => name.toLowerCase());
    assert.ok(!names.includes("mcp-session-id"));
    assert.ok(!names.some((name) => name.startsWith("access-control-")));
  });
});

describe("emptyResponse", () => {
  it("has no body and no Content-Length (Zotero adds Content-Length: 0 itself)", () => {
    const response = emptyResponse(202);
    assert.deepEqual(response, { status: 202, headers: { Connection: "close" }, body: "" });
  });

  it("passes extra headers through", () => {
    assert.equal(emptyResponse(202, { "X-Test": "1" }).headers["X-Test"], "1");
  });
});
