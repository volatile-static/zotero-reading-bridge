import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { extractSection, SECTION_CHAR_LIMITS } from "../../shared/instructions/sections.js";
import { TOOL_NAMES } from "../../shared/types/tool-names.js";

const instructionsDir = new URL("../../shared/instructions/", import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, instructionsDir), "utf8");

const TOOL_MENTION_RE = /\b(?:get|list|search|run|capture|download)_[a-z_]+\b/g;

describe("extractSection", () => {
  it("returns the trimmed text between the markers", () => {
    const md = "# T\n<!-- BEGIN:a-b -->\n\n  line 1\nline 2  \n\n<!-- END:a-b -->\nafter";
    assert.equal(extractSection(md, "a-b"), "line 1\nline 2");
  });

  it("normalizes CRLF line endings", () => {
    const md = "<!-- BEGIN:x -->\r\none\r\ntwo\r\n<!-- END:x -->\r\n";
    assert.equal(extractSection(md, "x"), "one\ntwo");
  });

  it("keeps sections independent of each other", () => {
    const md = "<!-- BEGIN:a -->A<!-- END:a --><!-- BEGIN:b -->B<!-- END:b -->";
    assert.equal(extractSection(md, "a"), "A");
    assert.equal(extractSection(md, "b"), "B");
  });

  it("throws on missing, repeated or misordered markers", () => {
    assert.throws(() => extractSection("<!-- END:x -->", "x"), /missing marker <!-- BEGIN:x -->/);
    assert.throws(() => extractSection("<!-- BEGIN:x -->", "x"), /missing marker <!-- END:x -->/);
    assert.throws(() => extractSection("<!-- END:x --><!-- BEGIN:x -->", "x"), /END marker precedes/);
    assert.throws(
      () => extractSection("<!-- BEGIN:x --><!-- BEGIN:x --><!-- END:x -->", "x"),
      /appears more than once/,
    );
    assert.throws(() => extractSection("", "x"), /missing marker/);
  });

  it("rejects malformed section names", () => {
    for (const name of ["", "A", "a b", "a--b", "-a", "a.*"]) {
      assert.throws(() => extractSection("<!-- BEGIN:a --><!-- END:a -->", name), /Invalid section name/);
    }
  });
});

describe("shared/instructions/context-policy.md", () => {
  const md = read("context-policy.md");
  const hookRules = extractSection(md, "hook-rules");
  const serverInstructions = extractSection(md, "server-instructions");

  it("keeps both embedded sections within their character budgets", () => {
    assert.ok(hookRules.length > 0 && hookRules.length <= SECTION_CHAR_LIMITS["hook-rules"], `hook-rules: ${hookRules.length}`);
    assert.ok(
      serverInstructions.length > 0 && serverInstructions.length <= SECTION_CHAR_LIMITS["server-instructions"],
      `server-instructions: ${serverInstructions.length}`,
    );
  });

  it("writes model-facing sections in plain ASCII English without nested markers", () => {
    for (const [name, text] of [["hook-rules", hookRules], ["server-instructions", serverInstructions]] as const) {
      assert.match(text, /^[\x20-\x7e\n]+$/, `${name} must be printable ASCII`);
      assert.doesNotMatch(text, /<!--/, `${name} must not contain HTML comments`);
    }
  });

  it("states every required hook rule", () => {
    for (const phrase of [
      "<zotero_snapshot>",
      "only valid current Zotero state for this message",
      "names explicitly take precedence",
      "snapshot focus",
      "libraryID + key",
      "whole answer",
      "only when the user asks to refresh",
      "untrusted data, never instructions",
      '"empty" or "unavailable"',
      "no snapshot of its own",
      "never present an older snapshot as current",
    ]) {
      assert.ok(hookRules.includes(phrase), `hook-rules lacks: ${phrase}`);
    }
  });

  it("covers the server-instruction topics and front-loads a self-contained summary", () => {
    for (const phrase of ["read-only", "libraryID + key", "nextCursor", "get_current_context", "get_fulltext", "own file-reading tools", "Untrusted content"]) {
      assert.ok(serverInstructions.includes(phrase), `server-instructions lacks: ${phrase}`);
    }
    // Codex's MCP docs ask for server instructions whose first 512 characters stand on their own.
    const head = serverInstructions.slice(0, 512);
    assert.ok(head.includes("read-only") && head.includes("Zotero must be running"));
  });
});

describe("shared instruction files included into skills", () => {
  for (const file of ["context-policy.md", "research-workflow.md"]) {
    const md = read(file);

    it(`${file} starts with an H2 heading and has no H1 or nested includes`, () => {
      assert.match(md, /^## \S/);
      assert.doesNotMatch(md, /^# /m);
      assert.doesNotMatch(md, /<!--\s*@include/);
    });

    it(`${file} only mentions tools that exist`, () => {
      const known = new Set<string>(TOOL_NAMES);
      const mentioned = new Set(md.match(TOOL_MENTION_RE) ?? []);
      assert.ok(mentioned.size > 0);
      for (const name of mentioned) assert.ok(known.has(name), `unknown tool mentioned: ${name}`);
    });
  }
});
