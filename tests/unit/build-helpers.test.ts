/**
 * Unit tests for the build/verify helpers in scripts/lib.
 * Credential and absolute-path samples are assembled from fragments so this file never matches the
 * scanners itself (it ships inside source.zip, which the verifier scans).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { bundleClassicScript, bundleForInspection, bundleNodeScript } from "../../scripts/lib/bundle.js";
import {
  type FileMap,
  bundleContractProblems,
  claudeCodePackageChecks,
  claudeDesktopPackageChecks,
  codexPackageChecks,
  desktopManifestProblems,
  endpointInitProblems,
  endpointRegistrationProblems,
  ftlMessageIds,
  hookFileProblems,
  markupResourceRefs,
  restartProblems,
  scriptResourceRefs,
  xpiPackageChecks,
  zoteroManifestProblems,
} from "../../scripts/lib/checks.js";
import { formatTable } from "../../scripts/lib/cli.js";
import {
  isIgnored,
  isPathIgnored,
  loadPackagingIgnoreRules,
  parseIgnorePatterns,
  relativeTo,
  resolveInside,
  walkFiles,
} from "../../scripts/lib/files.js";
import { IncludeError, expandIncludes, findIncludeMarkers } from "../../scripts/lib/includes.js";
import { MAIN_GLOBAL_NAME, ZIP_ENTRY_DATE } from "../../scripts/lib/layout.js";
import {
  injectMarketplaceVersion,
  injectVersion,
  parseFrontmatter,
  readPackageVersion,
} from "../../scripts/lib/manifests.js";
import {
  ABSOLUTE_PATH_RULES,
  SECRET_RULES,
  forbiddenFileName,
  homeDirectoryRules,
  nodeRequireProblems,
  relayBundleProblems,
  scanBundle,
  scanContent,
} from "../../scripts/lib/scan.js";
import { createSandbox, evaluateScripts, inertStub, missingFunctions } from "../../scripts/lib/script-globals.js";
import {
  type ZipReadEntry,
  prepareEntries,
  readZip,
  writeZipAtomic,
  zipEntryProblems,
} from "../../scripts/lib/zip.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const join = (...parts: string[]): string => parts.join("");

let tmpRoot = "";
before(() => {
  const workDir = path.join(REPO_ROOT, "work");
  fs.mkdirSync(workDir, { recursive: true });
  tmpRoot = fs.mkdtempSync(path.join(workDir, "tmp-build-helpers-"));
});
after(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5 });
});

function tmpDir(name: string): string {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function fileMap(files: Record<string, string | object>): FileMap {
  return new Map(
    Object.entries(files).map(([name, value]) => [
      name,
      Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
    ]),
  );
}

describe("expandIncludes", () => {
  const sources: Record<string, string> = {
    "shared/a.md": "# A\nline a\n\n",
    "shared/b.md": "B start\n<!-- @include shared/a.md -->\nB end\n",
    "shared/c.md": "<!-- @include shared/a.md -->\n",
    "shared/loop1.md": "<!-- @include shared/loop2.md -->\n",
    "shared/loop2.md": "<!-- @include shared/loop1.md -->\n",
    "shared/crlf.md": "x\r\ny\r\n",
  };
  const load = (rel: string): string | null => sources[rel] ?? null;

  it("replaces marker lines recursively and drops the included file's trailing newlines", () => {
    const out = expandIncludes("top\n  <!-- @include shared/b.md -->  \nbottom\n", "skill.md", load);
    assert.equal(out, "top\nB start\n# A\nline a\nB end\nbottom\n");
  });

  it("returns files without markers unchanged (CRLF kept)", () => {
    const text = "no markers\r\nhere\r\n";
    assert.equal(expandIncludes(text, "x.md", load), text);
  });

  it("normalizes expanded output to LF", () => {
    assert.equal(expandIncludes("a\r\n<!-- @include shared/crlf.md -->\r\nb", "x.md", load), "a\nx\ny\nb");
  });

  it("allows the same file twice when there is no cycle", () => {
    const out = expandIncludes("<!-- @include shared/a.md -->\n<!-- @include shared/c.md -->", "x.md", load);
    assert.equal(out, "# A\nline a\n# A\nline a");
  });

  it("reports cycles with the include chain", () => {
    assert.throws(
      () => expandIncludes("<!-- @include shared/loop1.md -->", "x.md", load),
      (error: unknown) =>
        error instanceof IncludeError && error.message.includes("x.md -> shared/loop1.md -> shared/loop2.md -> shared/loop1.md"),
    );
    assert.throws(() => expandIncludes("<!-- @include x.md -->", "x.md", load), /include cycle/);
  });

  it("rejects missing targets, inline markers and paths outside the repo", () => {
    assert.throws(() => expandIncludes("<!-- @include shared/none.md -->", "x.md", load), /not found: shared\/none\.md/);
    assert.throws(() => expandIncludes("text <!-- @include shared/a.md -->", "x.md", load), /malformed include marker/);
    assert.throws(() => expandIncludes("<!-- @include -->", "x.md", load), /malformed include marker/);
    assert.throws(() => expandIncludes("<!-- @include ../secret.md -->", "x.md", load), /escapes the repository/);
    assert.throws(() => expandIncludes("<!-- @include /etc/passwd -->", "x.md", load), /repo-relative/);
    assert.throws(() => expandIncludes("<!-- @include D:/x.md -->", "x.md", load), /repo-relative/);
    assert.throws(() => expandIncludes("<!-- @include shared\\a.md -->", "x.md", load), /separators/);
  });

  it("normalizes ./ and inner .. segments that stay inside the repo", () => {
    assert.equal(expandIncludes("<!-- @include ./shared/x/../a.md -->", "x.md", load), "# A\nline a");
  });

  it("finds leftover markers by line", () => {
    assert.deepEqual(findIncludeMarkers("a\n<!-- @include x -->\nb\n<!--@include y-->"), [2, 4]);
    assert.deepEqual(findIncludeMarkers("plain text"), []);
  });

  it("leaves markers inside inline code and fenced blocks alone (documentation of the syntax)", () => {
    const doc = [
      "The build expands `<!-- @include ... -->` markers.",
      "```markdown",
      "<!-- @include shared/none.md -->",
      "```",
      "~~~~",
      "<!-- @include shared/none.md -->",
      "~~~ not a closing fence",
      "~~~~",
      "<!-- @include shared/a.md -->",
    ].join("\r\n");
    assert.deepEqual(findIncludeMarkers(doc), [9]);
    const expanded = expandIncludes(doc, "x.md", load);
    assert.equal(expanded, [...doc.split("\r\n").slice(0, 8), "# A", "line a"].join("\n"));
    const onlyDocs = "Use `<!-- @include path -->`.\r\n";
    assert.equal(expandIncludes(onlyDocs, "x.md", load), onlyDocs, "no directives: returned byte-for-byte");
    assert.deepEqual(findIncludeMarkers("text `code` <!-- @include x -->"), [1], "a marker after a code span still counts");
  });
});

describe("ignore rules", () => {
  const rules = parseIgnorePatterns(
    ["# comment", "", "node_modules/", "/work/", "*.local.json", ".env", ".env.*", ".claude/settings.local.json", ".git"].join("\n"),
    "test",
  );

  it("matches the .gitignore subset semantics", () => {
    assert.equal(isIgnored("node_modules", true, rules), true);
    assert.equal(isIgnored("packages/x/node_modules", true, rules), true);
    assert.equal(isIgnored("node_modules", false, rules), false, "dir-only rule must not match files");
    assert.equal(isIgnored("work", true, rules), true);
    assert.equal(isIgnored("packages/work", true, rules), false, "leading / anchors to the root");
    assert.equal(isIgnored("a/settings.local.json", false, rules), true);
    assert.equal(isIgnored(".env.production", false, rules), true);
    assert.equal(isIgnored(".env", false, rules), true);
    assert.equal(isIgnored(".envrc", false, rules), false);
    assert.equal(isIgnored(".claude/settings.local.json", false, rules), true);
    assert.equal(isIgnored("x/.claude/settings.local.json", false, rules), true, "basename rule *.local.json");
    assert.equal(isIgnored(".claude/settings.json", false, rules), false);
    assert.equal(isIgnored(".git", false, rules), true);
    assert.equal(isPathIgnored("node_modules/pkg/index.js", rules), true);
    assert.equal(isPathIgnored("work/stage/zotero/bootstrap.js", rules), true);
    assert.equal(isPathIgnored("scripts/work.ts", rules), false);
  });

  it("rejects syntax it does not implement", () => {
    for (const pattern of ["!keep.json", "**/dist", "[ab].txt", "a\\ b"]) {
      assert.throws(() => parseIgnorePatterns(pattern, "t"), /unsupported ignore syntax/, pattern);
    }
    assert.throws(() => parseIgnorePatterns("/", "t"), /empty ignore pattern/);
  });

  it("parses the repository .gitignore and excludes build output and local config", () => {
    const repoRules = loadPackagingIgnoreRules(REPO_ROOT);
    for (const rel of [
      "node_modules/esbuild/package.json",
      "outputs/source.zip",
      "work/stage/zotero/bootstrap.js",
      ".git/HEAD",
      "tsconfig.tsbuildinfo",
      ".env",
      ".claude/settings.local.json",
      "auth.json",
      ".codex/config.toml",
      // Local client config and helpers that may hold credentials never reach source.zip.
      ".mcp.json",
      "tests/zotero/fixtures/web-api.local.ts",
      "examples/settings.local.toml",
    ]) {
      assert.equal(isPathIgnored(rel, repoRules), true, rel);
    }
    for (const rel of [
      "package.json",
      "scripts/build.ts",
      "packages/codex/.codex-plugin/plugin.json",
      "packages/codex/.mcp.json",
      "packages/claude-code/.mcp.json",
      ".gitignore",
    ]) {
      assert.equal(isPathIgnored(rel, repoRules), false, rel);
    }
  });
});

describe("walkFiles and path guards", () => {
  it("lists dotfiles and non-ASCII/space names in code-unit order and prunes ignored dirs", () => {
    const root = tmpDir("walk");
    writeTree(root, {
      "b.txt": "b",
      "a.txt": "a",
      ".hidden/.dotfile": "d",
      "中文 目录/文件 名.md": "zh",
      "node_modules/x.js": "x",
      "sub/.mcp.json": "{}",
    });
    const rules = parseIgnorePatterns("node_modules/", "t");
    assert.deepEqual(walkFiles(root, "", rules), [
      ".hidden/.dotfile",
      "a.txt",
      "b.txt",
      "sub/.mcp.json",
      "中文 目录/文件 名.md",
    ]);
    assert.deepEqual(walkFiles(root, "sub", rules), ["sub/.mcp.json"]);
    assert.equal(relativeTo("sub", "sub/.mcp.json"), ".mcp.json");
    assert.throws(() => relativeTo("sub", "other/x"), /not inside/);
  });

  it("skips ignored symbolic links and junctions but refuses links that would be packaged", () => {
    const root = tmpDir("links");
    const outside = tmpDir("links-target");
    writeTree(root, { "src/a.ts": "a", "keep/b.txt": "b" });
    writeTree(outside, { "pkg/index.js": "x", "secret.env": "s" });
    // Junctions need no privileges on Windows and are what Node reports as links there; plain links elsewhere.
    const dirLink = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(path.join(outside, "pkg"), path.join(root, "node_modules"), dirLink);
    fs.symlinkSync(path.join(outside, "pkg"), path.join(root, "keep", "linked-dir"), dirLink);
    const rules = parseIgnorePatterns("node_modules/\n/work/\n.env", "t");
    assert.throws(() => walkFiles(root, "", rules), /refusing to package symbolic link: keep\/linked-dir/);
    fs.unlinkSync(path.join(root, "keep", "linked-dir"));
    assert.deepEqual(walkFiles(root, "", rules), ["keep/b.txt", "src/a.ts"]);
    fs.symlinkSync(path.join(outside, "pkg"), path.join(root, "work"), dirLink);
    assert.deepEqual(walkFiles(root, "", rules), ["keep/b.txt", "src/a.ts"]);
    // A file-like link name matched by a file rule is skipped too, without following the link.
    let fileLink = true;
    try {
      fs.symlinkSync(path.join(outside, "secret.env"), path.join(root, ".env"), "file");
    } catch {
      fileLink = false; // file symlinks need Developer Mode or admin rights on Windows
    }
    if (fileLink) assert.deepEqual(walkFiles(root, "", rules), ["keep/b.txt", "src/a.ts"]);
  });

  it("refuses to resolve the root itself or paths escaping it", () => {
    const root = tmpDir("guard");
    assert.equal(resolveInside(root, "outputs"), path.join(root, "outputs"));
    assert.throws(() => resolveInside(root, "."), /strictly inside/);
    assert.throws(() => resolveInside(root, "../x"), /strictly inside/);
    assert.throws(() => resolveInside(root, path.parse(root).root), /strictly inside/);
  });
});

describe("deterministic zip", () => {
  const entries = [
    { name: "中文 文件夹/说明 文档.md", data: Buffer.from("# 标题\n中文内容\n") },
    { name: ".codex-plugin/plugin.json", data: Buffer.from('{"name":"x"}\n') },
    { name: "a b/c.txt", data: Buffer.from("space") },
    { name: ".mcp.json", data: Buffer.from("{}") },
  ];

  it("writes byte-identical archives regardless of input order and reads them back strictly", async () => {
    const dir = tmpDir("zip");
    const first = path.join(dir, "one.zip");
    const second = path.join(dir, "two.zip");
    await writeZipAtomic(first, entries);
    await writeZipAtomic(second, [...entries].reverse());
    assert.ok(fs.readFileSync(first).equals(fs.readFileSync(second)));
    assert.deepEqual(fs.readdirSync(dir).sort(), ["one.zip", "two.zip"], "no .partial leftovers");

    const read = await readZip(first);
    assert.deepEqual(
      read.map((e) => e.name),
      [".codex-plugin/plugin.json", ".mcp.json", "a b/c.txt", "中文 文件夹/说明 文档.md"],
    );
    const chinese = read.find((e) => e.name.startsWith("中文"));
    assert.equal(chinese?.utf8Name, true);
    assert.equal(chinese?.data.toString("utf8"), "# 标题\n中文内容\n");
    for (const entry of read) {
      assert.equal(entry.crcOk, true);
      assert.equal(entry.modified.getTime(), ZIP_ENTRY_DATE.getTime());
    }
    assert.deepEqual(zipEntryProblems(read), []);
  });

  it("rejects unsafe or duplicate names before writing anything", () => {
    for (const name of ["", "a\\b.txt", "/abs.txt", "C:/x.txt", "../up.txt", "a//b.txt", "a/./b", "dir/", "x\u0001y"]) {
      assert.throws(() => prepareEntries([{ name, data: Buffer.alloc(0) }]), Error, JSON.stringify(name));
    }
    assert.throws(
      () => prepareEntries([{ name: "README.md", data: Buffer.alloc(0) }, { name: "readme.md", data: Buffer.alloc(0) }]),
      /duplicate entry name/,
    );
  });

  it("removes the partial file when archiving fails", async () => {
    const dir = tmpDir("zip-fail");
    const target = path.join(dir, "bad.zip");
    await assert.rejects(writeZipAtomic(target, [{ name: "x.txt", data: 42 as unknown as Buffer }]));
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it("flags structural problems in read entries", () => {
    const base: ZipReadEntry = {
      name: "b.txt",
      data: Buffer.alloc(0),
      isDirectory: false,
      crcOk: true,
      utf8Name: false,
      modified: ZIP_ENTRY_DATE,
    };
    const problems = zipEntryProblems([
      base,
      { ...base, name: "a.txt", crcOk: false, modified: new Date(0) },
      { ...base, name: "中.txt" },
      { ...base, name: "dir/", isDirectory: true },
    ]);
    assert.ok(problems.some((p) => p.includes("out of order")));
    assert.ok(problems.some((p) => p.includes("CRC-32 mismatch")));
    assert.ok(problems.some((p) => p.includes("non-fixed mtime")));
    assert.ok(problems.some((p) => p.includes("without UTF-8 flag")));
    assert.ok(problems.some((p) => p.includes("directory entry")));
    assert.deepEqual(zipEntryProblems([]), ["archive is empty"]);
  });
});

describe("content scanners", () => {
  const secretSamples: Record<string, string> = {
    "private-key": join("-----BEGIN ", "OPENSSH PRIVATE", " KEY-----"),
    "anthropic-api-key": join("sk-", "ant-", "api03-", "a1B2c3D4e5F6g7H8i9J0"),
    "sk-api-key": join("sk-", "proj-", "Ab12Cd34Ef56Gh78Ij90Kl"),
    "github-token": join("gh", "p_", "A1".repeat(18)),
    "slack-token": join("xo", "xb-", "123456789012-abcdef"),
    "aws-access-key-id": join("AK", "IA", "ABCDEFGHIJ234567"),
    "aws-secret-access-key": join("aws_secret_", "access_key = ", "a".repeat(40)),
    "bearer-token": join("Authorization: Bear", "er ", "abc123def456ghi"),
    "basic-auth": join("Authorization: Ba", "sic ", "dXNlcjpwYXNzd29yZA=="),
    "json-credential-value": join('{"to', 'ken": "abc"}'),
    "zotero-api-key": join("const zotero", "Key = ", '"', "Ab3dEf6hIj9kLm2nOp5qRs8t", '"'),
    "credential-assignment": join('"X-Api', '-Key": "', "k3y", "Value12345", '"'),
  };

  it("finds credentials in the shapes local config and helpers use (one finding per credential)", () => {
    const samples = [
      join('"env": { "ZOTERO_API', '_KEY": "', "Ab3dEf6hIj9kLm2nOp5qRs8t", '" }'),
      join("ZOTERO_API", "_KEY=", "Ab3dEf6hIj9kLm2nOp5qRs8t"),
      join("bearer_to", 'ken = "', "s3cr3t-value-123", '"'),
      join("passw", 'ord = "', "hunter2hunter2", '"'),
      join("pass", "word: '", "Tr0ub4dor&3", "'"),
      join('"api', 'Secret": "', "abc123def456", '"'),
      join('"sec', 'ret": "', "z9y8x7w6v5", '"'),
      join("const apiSec", 'ret = "', "q1w2e3r4t5y6", '";'),
      join('headers: { "X-Api', '-Key": "', "k3yValue12345", '" }'),
    ];
    for (const sample of samples) {
      const findings = scanContent("f", sample, SECRET_RULES);
      assert.equal(findings.length, 1, `${sample}: ${JSON.stringify(findings)}`);
    }
  });

  it("does not flag placeholders, environment variable names or pref names", () => {
    const benign = [
      join('"session_id": "$', '{session_id}"'),
      join("bearer_to", 'ken_env_var = "', 'ZOTERO_BRIDGE_TOKEN"'),
      join('SEED_PREF_TO', 'KEN = "', 'extensions.zab-test.token"'),
      join('"api', 'Key": "<your', ' key>"'),
      join("passw", 'ord = "', 'changeme123"'),
      join("TO", 'KEN = "%TO', 'KEN%"'),
      join('"apiTo', 'ken": "', 'example-token-1234"'),
      join("auth", ' = "', 'short1"'),
    ].join("\n");
    assert.deepEqual(scanContent("f", benign, SECRET_RULES), []);
  });

  it("detects each credential shape and reports rule and line only", () => {
    for (const [rule, sample] of Object.entries(secretSamples)) {
      const findings = scanContent("f.txt", `first line\n${sample}\n`, SECRET_RULES);
      assert.deepEqual(findings, [{ file: "f.txt", line: 2, rule }], rule);
    }
    const pat = join("github_", "pat_", "11ABCDEFG0", "abcdefghij_klmnop");
    assert.equal(scanContent("f", pat, SECRET_RULES)[0]?.rule, "github-token");
  });

  it("does not flag ordinary prose or schemas", () => {
    const benign = [
      "Bearer tokens are never sent by this bridge.",
      "a risk-free change; sk-learn-compatible-models",
      '{"token": {"type": "string"}, "password": ""}',
      "BEGIN PUBLIC KEY",
    ].join("\n");
    assert.deepEqual(scanContent("f", benign, SECRET_RULES), []);
  });

  it("flags user-profile paths but not placeholders or URLs", () => {
    const flagged = [
      join("C:", "\\Users\\alice\\Zotero"),
      join("C:", "\\\\Users\\\\alice"),
      join("D:/Us", "ers/bob/x"),
      join("/ho", "me/alice/.codex"),
      join("/Us", "ers/alice/Zotero"),
      join("file:///ho", "me/bob/x"),
    ];
    for (const sample of flagged) {
      assert.equal(scanContent("f", sample, ABSOLUTE_PATH_RULES).length, 1, sample);
    }
    const allowed = [
      "C:\\Users\\<用户名>\\Zotero",
      "%USERPROFILE%\\Zotero",
      "C:\\Users\\%USERNAME%\\x",
      "/home/<user>/Zotero",
      "/Users/{user}/x",
      "https://example.com/home/page",
      "~/Zotero and $HOME/.codex",
    ];
    assert.deepEqual(scanContent("f", allowed.join("\n"), ABSOLUTE_PATH_RULES), []);
  });

  it("matches the build machine's home in every separator spelling", () => {
    const rules = homeDirectoryRules(join("C:", "\\", "Users", "\\", "zabtester"));
    for (const sample of [
      join("C:/", "Users/", "zabtester/x"),
      join("c:\\\\", "users\\\\", "ZABTESTER"),
      join("/c/", "Users/", "zabtester"),
    ]) {
      assert.equal(scanContent("f", sample, rules).length, 1, sample);
    }
    assert.deepEqual(scanContent("f", join("Users/", "zabtester2"), rules), []);
    assert.deepEqual(homeDirectoryRules("/root"), []);
  });

  it("recognizes credential file names", () => {
    for (const name of [".env", "a/.env.local", "auth.json", "x/.credentials.json", "id_ed25519", "k.pem", ".npmrc"]) {
      assert.ok(forbiddenFileName(name), name);
    }
    for (const name of ["envelope.md", "author.json", "keys.ts", ".mcp.json"]) {
      assert.equal(forbiddenFileName(name), null, name);
    }
  });

  it("accepts a plain IIFE and rejects module, CommonJS and Node constructs", () => {
    assert.deepEqual(scanBundle('(() => {\n  Zotero.require("x");\n  const s = "required (x)";\n})();\n'), []);
    const cases: Record<string, string> = {
      "require() call": 'const fs = require("fs");',
      "esbuild __require shim (a dependency uses require)": "var __require = 1;",
      "static import statement": 'import fs from "fs";',
      "import.meta": "const u = import.meta.url;",
      "dynamic import()": 'await import("./x.js");',
      "export statement": "export const x = 1;",
      "node: module specifier": 'const x = "node:fs";',
      "process.env access": "const v = process.env.HOME;",
    };
    for (const [description, code] of Object.entries(cases)) {
      assert.ok(scanBundle(code).includes(description), description);
    }
  });
});

describe("manifest transforms", () => {
  it("reads a SemVer package version", () => {
    assert.equal(readPackageVersion('{"version":"1.2.3-beta.1"}'), "1.2.3-beta.1");
    assert.throws(() => readPackageVersion('{"version":"1.2"}'), /SemVer/);
    assert.throws(() => readPackageVersion("{}"), /SemVer/);
  });

  it("injects the version, keeps key order and reports the previous value", () => {
    const { text, previous } = injectVersion('{"name":"x","version":"0.0.0","description":"d"}', "1.0.0", "m.json");
    assert.equal(previous, "0.0.0");
    assert.equal(text, '{\n  "name": "x",\n  "version": "1.0.0",\n  "description": "d"\n}\n');
    assert.equal(JSON.parse(injectVersion('{"name":"x"}', "1.0.0", "m.json").text).version, "1.0.0");
    assert.throws(() => injectVersion("[]", "1.0.0", "m.json"), /must be a JSON object/);
    assert.throws(() => injectVersion("{", "1.0.0", "m.json"), /m\.json: invalid JSON/);
  });

  it("updates only marketplace entries that pin a version for this plugin", () => {
    const source = JSON.stringify({
      name: "m",
      plugins: [
        { name: "zotero-ai-bridge", source: "./", version: "0.0.1" },
        { name: "other", version: "0.0.1" },
      ],
    });
    const updated = JSON.parse(injectMarketplaceVersion(source, "zotero-ai-bridge", "2.0.0", "m.json"));
    assert.equal(updated.plugins[0].version, "2.0.0");
    assert.equal(updated.plugins[1].version, "0.0.1");
    const unpinned = JSON.stringify({ plugins: [{ name: "zotero-ai-bridge", source: "./" }] });
    assert.equal(injectMarketplaceVersion(unpinned, "zotero-ai-bridge", "2.0.0", "m.json"), unpinned);
  });

  it("parses SKILL.md front matter", () => {
    const md = [
      "---",
      "name: zotero",
      'description: "Use for Zotero: papers, notes"',
      "metadata:",
      "  short-description: nested",
      "summary: >",
      "  folded",
      "  text",
      "---",
      "# Body",
    ].join("\n");
    assert.deepEqual(parseFrontmatter(md), {
      name: "zotero",
      description: "Use for Zotero: papers, notes",
      metadata: "",
      summary: "folded text",
    });
    assert.equal(parseFrontmatter("# no front matter"), null);
    assert.deepEqual(parseFrontmatter("---\r\nname: 'it''s'\r\n---\r\n"), { name: "it's" });
  });
});

const HOOK_BASE = { type: "mcp_tool", tool: "capture_prompt_context", timeout: 5, statusMessage: "Reading Zotero context" };
const SKILL_MD = "---\nname: zotero\ndescription: Read the Zotero library.\n---\n# Zotero\n";
const MCP_URL = "http://127.0.0.1:23119/bridge/mcp";

function codexFiles(overrides: Record<string, string | object> = {}): FileMap {
  return fileMap({
    ".codex-plugin/plugin.json": {
      name: "zotero-ai-bridge",
      version: "1.0.0",
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      hooks: "./hooks/hooks.json",
    },
    ".mcp.json": { mcpServers: { zotero_bridge: { type: "http", url: MCP_URL, startup_timeout_sec: 10, tool_timeout_sec: 30 } } },
    "hooks/hooks.json": {
      description: "Zotero context",
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              { ...HOOK_BASE, server: "zotero_bridge", input: { client: "codex", session_id: "${session_id}", turn_id: "${turn_id}" } },
            ],
          },
        ],
      },
    },
    "skills/zotero/SKILL.md": SKILL_MD,
    ...overrides,
  });
}

function claudeFiles(overrides: Record<string, string | object> = {}): FileMap {
  return fileMap({
    ".claude-plugin/plugin.json": { name: "zotero-ai-bridge", version: "1.0.0", description: "d" },
    ".mcp.json": { mcpServers: { zotero: { type: "http", url: MCP_URL } } },
    "hooks/hooks.json": {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                ...HOOK_BASE,
                server: "plugin:zotero-ai-bridge:zotero",
                input: { client: "claude-code", session_id: "${session_id}", prompt_id: "${prompt_id}" },
              },
            ],
          },
        ],
      },
    },
    "skills/zotero/SKILL.md": SKILL_MD,
    ...overrides,
  });
}

const failures = (results: readonly { ok: boolean; name: string; detail?: string }[]): string[] =>
  results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail ?? ""}`);

describe("client plugin checks", () => {
  it("accept well-formed Codex and Claude Code packages", () => {
    assert.deepEqual(failures(codexPackageChecks(codexFiles(), "1.0.0")), []);
    assert.deepEqual(failures(claudeCodePackageChecks(claudeFiles(), "1.0.0")), []);
  });

  it("reject version drift, wrong server keys and Claude manifest component keys", () => {
    assert.match(failures(codexPackageChecks(codexFiles(), "1.0.1")).join("\n"), /version must be 1\.0\.1/);
    const wrongServer = codexFiles({ ".mcp.json": { mcpServers: { zotero: { type: "http", url: MCP_URL } } } });
    assert.match(failures(codexPackageChecks(wrongServer, "1.0.0")).join("\n"), /exactly "zotero_bridge"/);
    const relaxed = codexFiles({
      ".mcp.json": { mcpServers: { zotero_bridge: { type: "http", url: MCP_URL, default_tools_approval_mode: "approve" } } },
    });
    assert.match(failures(codexPackageChecks(relaxed, "1.0.0")).join("\n"), /default_tools_approval_mode must not be set/);
    const withHooksKey = claudeFiles({ ".claude-plugin/plugin.json": { name: "zotero-ai-bridge", version: "1.0.0", hooks: "./hooks/hooks.json" } });
    assert.match(failures(claudeCodePackageChecks(withHooksKey, "1.0.0")).join("\n"), /must not declare "hooks"/);
    const badPath = codexFiles({
      ".codex-plugin/plugin.json": { name: "zotero-ai-bridge", version: "1.0.0", hooks: "hooks/hooks.json", skills: "./missing/" },
    });
    const detail = failures(codexPackageChecks(badPath, "1.0.0")).join("\n");
    assert.match(detail, /hooks must start with "\.\/"/);
    assert.match(detail, /skills points at \.\/missing\//);
  });

  it("pin the exact hook shape", () => {
    const expected = { server: "s", input: { client: "codex", session_id: "${session_id}", turn_id: "${turn_id}" }, requireDescription: true };
    const handler = { ...HOOK_BASE, server: "s", input: { ...expected.input } };
    const file = (h: object, extra: object = {}, group: object = {}) => ({
      description: "d",
      hooks: { UserPromptSubmit: [{ ...group, hooks: [h] }] },
      ...extra,
    });
    assert.deepEqual(hookFileProblems(file(handler), expected), []);
    const cases: [object, RegExp][] = [
      [file({ ...handler, timeout: 5.5 }), /timeout must be the integer 5/],
      [file({ ...handler, timeout: "5" }), /timeout must be the integer 5/],
      [file({ ...handler, input: { ...expected.input, prompt: "${prompt}" } }), /input keys must be exactly/],
      [file({ ...handler, input: { ...expected.input, turn_id: "x" } }), /input\.turn_id must be/],
      [file({ ...handler, server: "zotero" }), /server must be "s"/],
      [file({ ...handler, onFailure: "ignore" }), /unexpected handler key "onFailure"/],
      [file(handler, {}, { matcher: "*" }), /unexpected group key "matcher"/],
      [file(handler, { extra: 1 }), /unexpected top-level key "extra"/],
      [{ hooks: { UserPromptSubmit: [{ hooks: [handler] }] } }, /"description" string is required/],
      [{ description: "d", hooks: { Stop: [] } }, /unexpected hook event "Stop"/],
      [file({ ...handler, statusMessage: "x" }), /statusMessage must be/],
    ];
    for (const [hooksFile, pattern] of cases) {
      assert.match(hookFileProblems(hooksFile as Record<string, unknown>, expected).join("\n"), pattern);
    }
  });
});

const BOOTSTRAP_OK = [
  "(() => {",
  "  function install() {}",
  "  function uninstall() {}",
  "  function onMainWindowLoad() {}",
  "  function onMainWindowUnload() {}",
  "  function startup({ rootURI }, reason) {",
  `    const previous = globalThis.${MAIN_GLOBAL_NAME};`,
  `    if (previous) { delete globalThis.${MAIN_GLOBAL_NAME}; previous.shutdown(reason); }`,
  "    Services.scriptloader.loadSubScriptWithOptions(`${rootURI}content/bridge.js`, { target: globalThis });",
  `    return globalThis.${MAIN_GLOBAL_NAME}.startup({ rootURI });`,
  "  }",
  `  function shutdown() { globalThis.${MAIN_GLOBAL_NAME}?.shutdown(); delete globalThis.${MAIN_GLOBAL_NAME}; }`,
  "  Object.assign(globalThis, { install, uninstall, startup, shutdown, onMainWindowLoad, onMainWindowUnload });",
  "})();",
].join("\n");
const BRIDGE_OK = [
  "(() => {",
  '  const l10n = new Localization(["zotero-ai-bridge.ftl"]);',
  "  const port = Zotero.Server.port;",
  "  const pane = (root) => ({ src: `${root}content/preferences.xhtml`, image: `${root}content/icons/icon.svg` });",
  "  function registerEndpoints() {",
  "    class Endpoint {",
  '      supportedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];',
  '      supportedDataTypes = "*";',
  "      init(request) {",
  "        return Promise.resolve(request);",
  "      }",
  "    }",
  '    Zotero.Server.Endpoints["/bridge/mcp"] = Endpoint;',
  "  }",
  `  globalThis.${MAIN_GLOBAL_NAME} = { startup() { registerEndpoints(); return [l10n, port, pane("")]; }, shutdown() {} };`,
  "})();",
].join("\n");

function xpiFiles(overrides: Record<string, string | object> = {}): FileMap {
  return fileMap({
    "manifest.json": {
      manifest_version: 2,
      name: "Zotero AI Bridge",
      version: "1.0.0",
      icons: { "48": "content/icons/icon.svg" },
      applications: {
        zotero: {
          id: "zotero-ai-bridge@zotero-ai-bridge.local",
          update_url: "https://zotero-ai-bridge.invalid/update.json",
          strict_min_version: "10.999",
          strict_max_version: "11.*",
        },
      },
    },
    "bootstrap.js": BOOTSTRAP_OK,
    "content/bridge.js": BRIDGE_OK,
    "content/preferences.js": "(() => { window.addEventListener('load', () => {}); })();\n",
    "content/preferences.xhtml":
      '<vbox xmlns:html="http://www.w3.org/1999/xhtml"><linkset><html:link rel="localization" href="zotero-ai-bridge.ftl"/></linkset><html:img src="chrome://zotero/skin/x.svg"/></vbox>',
    "content/icons/icon.svg": "<svg/>",
    "locale/en-US/zotero-ai-bridge.ftl": "zotero-ai-bridge-title = Zotero AI Bridge\n    .label = x\n",
    "locale/zh-CN/zotero-ai-bridge.ftl": "zotero-ai-bridge-title = Zotero AI 桥接\n",
    ...overrides,
  });
}

describe("XPI checks", () => {
  it("accept a well-formed XPI", () => {
    assert.deepEqual(failures(xpiPackageChecks(xpiFiles(), "1.0.0")), []);
  });

  it("detect hooks hidden inside the IIFE, a missing main global and broken references", () => {
    const hidden = xpiFiles({ "bootstrap.js": '(() => { function startup() {} function shutdown() {} "content/bridge.js"; })();' });
    assert.match(failures(xpiPackageChecks(hidden, "1.0.0")).join("\n"), /install is not a global function/);
    const noGlobal = xpiFiles({ "content/bridge.js": "(() => { const startup = () => {}; })();" });
    assert.match(failures(xpiPackageChecks(noGlobal, "1.0.0")).join("\n"), new RegExp(`${MAIN_GLOBAL_NAME}\\.startup is not a function`));
    const brokenRef = xpiFiles({ "content/preferences.js": 'const x = rootURI + "content/missing.css";' });
    assert.match(failures(xpiPackageChecks(brokenRef, "1.0.0")).join("\n"), /content\/preferences\.js -> content\/missing\.css \(missing\)/);
    const relative = xpiFiles({ "content/preferences.xhtml": '<html:img src="icons/icon.svg"/>' });
    assert.match(failures(xpiPackageChecks(relative, "1.0.0")).join("\n"), /resolves outside the plugin/);
    const unprefixed = xpiFiles({ "locale/zh-CN/zotero-ai-bridge.ftl": "title = x\n" });
    const ftl = failures(xpiPackageChecks(unprefixed, "1.0.0")).join("\n");
    assert.match(ftl, /lacks the zotero-ai-bridge- prefix/);
    assert.match(ftl, /"zotero-ai-bridge-title" is in en-US but not in zh-CN/);
    const ts = xpiFiles({ "content/preferences.ts": "x", "content/tsconfig.json": "{}" });
    assert.match(failures(xpiPackageChecks(ts, "1.0.0")).join("\n"), /unexpected content\/preferences\.ts/);
    const noIcon = new Map(xpiFiles());
    noIcon.delete("content/icons/icon.svg");
    assert.match(failures(xpiPackageChecks(noIcon, "1.0.0")).join("\n"), /content\/bridge\.js -> content\/icons\/icon\.svg \(missing\)/);
  });

  it("pin the bootstrap/bridge global contract of the shared sandbox", () => {
    const api = "{ startup() {}, shutdown() {} }";
    const cases: [string, RegExp][] = [
      // A top-level var survives bootstrap's `delete globalThis.ZoteroAIBridgeMain`.
      [`var ${MAIN_GLOBAL_NAME} = ${api};`, /cannot be deleted by bootstrap\.js shutdown/],
      [`globalThis.${MAIN_GLOBAL_NAME} = ${api}; globalThis.helper = 1;`, /must add exactly the global ZoteroAIBridgeMain \(added: \[ZoteroAIBridgeMain, helper\]\)/],
      [`globalThis.${MAIN_GLOBAL_NAME} = ${api}; globalThis.startup = () => {};`, /replaced the bootstrap hook startup/],
      [`globalThis.${MAIN_GLOBAL_NAME} = { startup() {} };`, /ZoteroAIBridgeMain\.shutdown is not a function/],
      // A vm-realm Error is not `instanceof Error` here, so the message keeps its "Error: " prefix.
      ["throw new Error('boom');", /content\/bridge\.js threw while loading: Error: boom/],
    ];
    for (const [bridge, pattern] of cases) {
      assert.match(bundleContractProblems(BOOTSTRAP_OK, bridge).join("\n"), pattern, bridge);
    }
    assert.deepEqual(bundleContractProblems(BOOTSTRAP_OK, BRIDGE_OK), []);
  });

  it("require startup() to stop a runtime that was never shut down before loading the bundle again", () => {
    assert.deepEqual(restartProblems(BOOTSTRAP_OK), []);
    // The pre-fix bootstrap: a second startup leaves the first runtime (and its observers) running.
    const unguarded = BOOTSTRAP_OK.replace(
      `    if (previous) { delete globalThis.${MAIN_GLOBAL_NAME}; previous.shutdown(reason); }\n`,
      "",
    );
    assert.notEqual(unguarded, BOOTSTRAP_OK);
    assert.match(restartProblems(unguarded).join("\n"), /must stop the previous runtime first \(expected startup 1, shutdown 1, startup 2, shutdown 2; got startup 1, startup 2, shutdown 2\)/);
    assert.match(bundleContractProblems(unguarded, BRIDGE_OK).join("\n"), /must stop the previous runtime first/);
  });

  it("check the shipped endpoint init() arity statically", () => {
    assert.deepEqual(endpointInitProblems(BRIDGE_OK), []);
    assert.match(endpointInitProblems(BRIDGE_OK.replace("init(request)", "init(data, send)")).join(), /exactly one plain parameter/);
    assert.match(endpointInitProblems(BRIDGE_OK.replace("init(request)", "init(request = {})")).join(), /exactly one plain parameter/);
    assert.match(endpointInitProblems("(() => {})();").join(), /no endpoint class/);
  });

  it("validate manifest fields", () => {
    const manifest = {
      manifest_version: 3,
      name: "",
      version: "0.9.0",
      applications: { zotero: { id: "x", update_url: "http://a", strict_min_version: "11.*" } },
    };
    const problems = zoteroManifestProblems(manifest, "1.0.0").join("\n");
    for (const pattern of [/manifest_version must be 2/, /name must be/, /version must be 1\.0\.0/, /id must be/, /update_url/, /must not contain "\*"/, /strict_max_version is missing/]) {
      assert.match(problems, pattern);
    }
  });

  it("extract resource references from scripts, markup and Fluent", () => {
    const code = 'a(rootURI + "content/x.js"); b(`${this.rootURI}locale/y.ftl?q`); c("content/icons/i.png"); d("content/"); e("zotero-ai-bridge.ftl")';
    assert.deepEqual(scriptResourceRefs(code), ["content/icons/i.png", "content/x.js", "locale/y.ftl"]);
    assert.deepEqual(markupResourceRefs('<a href="#x"/><img src="content/a.svg"/><link href="b.ftl"/><img src="rel.png"/><img src="data:x"/>'), {
      files: ["content/a.svg"],
      ftl: ["b.ftl"],
      unresolvable: ["rel.png"],
    });
    assert.deepEqual(ftlMessageIds("a-b = x\n  .attr = y\n-term = z\n# c = d\n"), ["a-b", "-term"]);
  });
});

describe("script sandbox evaluation", () => {
  it("resolves hooks like plugins.js: own properties and top-level lexical bindings", () => {
    const sandbox = evaluateScripts([
      { code: "const install = () => {}; function startup() {} Object.assign(globalThis, { shutdown() {} });", filename: "b.js" },
    ]);
    assert.deepEqual(missingFunctions(sandbox, ["install", "startup", "shutdown", "uninstall"]), ["uninstall"]);
    assert.deepEqual(missingFunctions(sandbox, ["startup"], "Nope"), ["Nope.startup"]);
  });

  it("absorbs Zotero API use at load time and exposes reason constants", () => {
    const sandbox = evaluateScripts([
      { code: "var seen = [APP_SHUTDOWN, String(Zotero.Prefs.get('x')), typeof new Services.foo()];", filename: "x.js" },
    ]);
    // The array comes from the vm realm (different Array.prototype); copy it before a strict deep comparison.
    assert.deepEqual([...(sandbox.lookup("seen") as unknown[])], [2, "", "function"]);
    assert.throws(() => sandbox.lookup("not an identifier"), /not an identifier/);
  });

  it("lets a check override one stubbed API and tells deletable globals from top-level vars", () => {
    const recorded: Record<string, unknown> = {};
    const sandbox = createSandbox({ Zotero: inertStub({ Server: inertStub({ Endpoints: recorded }) }) });
    sandbox.run("Zotero.Server.Endpoints['/x'] = 1; Zotero.debug('ignored'); globalThis.A = 1; var B = 2;", "x.js");
    assert.deepEqual(recorded, { "/x": 1 });
    assert.ok(sandbox.globalNames().includes("A"));
    assert.equal(sandbox.deleteGlobal("A"), true);
    assert.equal(sandbox.lookup("A"), undefined);
    assert.equal(sandbox.deleteGlobal("B"), false);
  });
});

describe("esbuild bundling", () => {
  it("bundles main as a plain IIFE that publishes its global, inlines Markdown as UTF-8 text", async () => {
    const root = tmpDir("bundle-main");
    writeTree(root, {
      "src/main.ts": [
        'import text from "./policy.md";',
        "declare global { var ZoteroAIBridgeMain: { startup(): string; shutdown(): void } | undefined; }",
        "globalThis.ZoteroAIBridgeMain = { startup: () => text, shutdown() {} };",
      ].join("\n"),
      "src/policy.md": "# 规则\nUse Zotero.\n",
      "src/md.d.ts": 'declare module "*.md" { const text: string; export default text; }\n',
    });
    const code = await bundleClassicScript(root, { id: "main", entry: "src/main.ts", out: "content/bridge.js" });
    assert.ok(code.startsWith("(() => {"));
    assert.ok(code.includes("# 规则\\nUse Zotero.\\n"));
    assert.deepEqual(scanBundle(code), []);
    assert.deepEqual(bundleContractProblems(BOOTSTRAP_OK, code), []);
  });

  it("keeps globalThis-assigned bootstrap hooks and refuses exports or Node built-ins", async () => {
    const root = tmpDir("bundle-bootstrap");
    writeTree(root, {
      "ok.ts": "function startup(): void {}\nObject.assign(globalThis, { startup });\nexport {};\n",
      "exports.ts": "export function startup(): void {}\n",
      "node.ts": 'import fs from "node:fs";\nObject.assign(globalThis, { fs });\n',
    });
    const ok = await bundleClassicScript(root, { id: "bootstrap", entry: "ok.ts", out: "bootstrap.js" });
    assert.deepEqual(missingFunctions(evaluateScripts([{ code: ok, filename: "bootstrap.js" }]), ["startup"]), []);
    await assert.rejects(bundleClassicScript(root, { id: "bootstrap", entry: "exports.ts", out: "bootstrap.js" }), /has ESM exports \(startup\)/);
    await assert.rejects(bundleClassicScript(root, { id: "main", entry: "exports.ts", out: "content/bridge.js" }), /has ESM exports/);
    await assert.rejects(bundleClassicScript(root, { id: "bootstrap", entry: "node.ts", out: "bootstrap.js" }), /Could not resolve "node:fs"/);
  });

  it("exercises endpoint registration from a check-only bundle", async () => {
    const root = tmpDir("bundle-endpoint");
    const endpointModule = (initParams: string, methods: string): string =>
      [
        'const PATHS = ["/bridge/mcp", "/codex/mcp"];',
        "export function registerEndpoints(options: { port: number }) {",
        "  class Endpoint {",
        `    supportedMethods = ${methods};`,
        '    supportedDataTypes = "*";',
        `    init(${initParams}) { return Promise.resolve([200, {}, String(options.port)]); }`,
        "  }",
        "  const endpoints = (Zotero as any).Server.Endpoints;",
        "  for (const path of PATHS) endpoints[path] = Endpoint;",
        "  return { paths: PATHS, unregister() { for (const path of PATHS) if (endpoints[path] === Endpoint) delete endpoints[path]; } };",
        "}",
        "declare const Zotero: unknown;",
      ].join("\n");
    const allMethods = '["GET", "POST", "PUT", "PATCH", "DELETE"]';
    writeTree(root, {
      "good.ts": endpointModule("request: unknown", allMethods),
      "two-args.ts": endpointModule("data: unknown, send: unknown", '["POST"]'),
      "default.ts": endpointModule("request: unknown = {}", allMethods),
    });
    const check = async (entry: string): Promise<string> =>
      endpointRegistrationProblems(await bundleForInspection(root, entry, "__inspect"), "__inspect").join("\n");
    assert.equal(await check("good.ts"), "");
    const twoArgs = await check("two-args.ts");
    assert.match(twoArgs, /init\.length is 2/);
    assert.match(twoArgs, /supportedMethods lacks GET, PUT, PATCH, DELETE/);
    assert.match(await check("default.ts"), /init\.length is 0/);
  });
});

describe("Claude Desktop extension", () => {
  const RELAY_OK = 'const http = require("node:http");\nhttp.request({ host: "127.0.0.1", port: 23119 });\nconst v = "0.1.0";\n';
  const manifest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    manifest_version: "0.2",
    name: "zotero-ai-bridge",
    display_name: "Zotero AI Bridge",
    version: "0.1.0",
    description: "Read-only Zotero.",
    author: { name: "Contributors" },
    server: {
      type: "node",
      entry_point: "server/zotero-relay.js",
      mcp_config: { command: "node", args: ["${__dirname}/server/zotero-relay.js", "--port", "${user_config.port}"] },
    },
    user_config: { port: { type: "number", default: 23119, min: 1, max: 65535, required: false } },
    ...overrides,
  });
  const desktopFiles = (overrides: Record<string, string | object> = {}): FileMap =>
    fileMap({ "manifest.json": manifest(), "server/zotero-relay.js": RELAY_OK, "README.md": "# 说明\n", ...overrides });

  it("accepts a well-formed package", () => {
    assert.deepEqual(failures(claudeDesktopPackageChecks(desktopFiles(), "0.1.0")), []);
  });

  it("rejects host arguments, extra environment, wrong entry points and a required or unbounded port", () => {
    const problems = (m: Record<string, unknown>): string => desktopManifestProblems(m, desktopFiles(), "0.1.0").join("\n");
    const server = (mcpConfig: Record<string, unknown>) => ({ server: { type: "node", entry_point: "server/zotero-relay.js", mcp_config: mcpConfig } });
    assert.match(
      problems(manifest(server({ command: "node", args: ["${__dirname}/server/zotero-relay.js", "--port", "${user_config.port}", "--host", "0.0.0.0"] }))),
      /mcp_config\.args must be/,
    );
    assert.match(
      problems(manifest(server({ command: "node", args: ["${__dirname}/server/zotero-relay.js", "--port", "${user_config.port}"], env: { X: "1" } }))),
      /mcp_config\.env must not be set/,
    );
    assert.match(problems(manifest({ server: { type: "python", entry_point: "x.py", mcp_config: {} } })), /server\.type must be "node"[\s\S]*entry_point/);
    assert.match(problems(manifest({ user_config: { port: { type: "string", default: 1, required: true } } })), /type must be "number"[\s\S]*default must be 23119[\s\S]*1-65535[\s\S]*optional/);
    assert.match(problems(manifest({ user_config: { port: {}, host: {} } })), /exactly "port"/);
    assert.match(problems(manifest({ version: "0.0.9" })), /version must be 0\.1\.0/);
  });

  it("flags extra files and relay bundles that listen, set Origin, require packages or lack the loopback target", () => {
    assert.match(failures(claudeDesktopPackageChecks(desktopFiles({ "icon.png": "x" }), "0.1.0")).join("\n"), /unexpected icon\.png/);
    assert.deepEqual(relayBundleProblems(RELAY_OK), []);
    assert.match(relayBundleProblems(`${RELAY_OK}http.createServer(() => {});`).join(), /listening socket/);
    assert.match(relayBundleProblems(`${RELAY_OK}server.listen(0);`).join(), /listening socket/);
    assert.match(relayBundleProblems(`${RELAY_OK}headers = { "Origin": "x" };`).join(), /Origin/);
    assert.match(relayBundleProblems(`${RELAY_OK}require("undici");`).join(), /undici.*not a node: built-in/);
    assert.match(relayBundleProblems('require("node:http").request({ host: "localhost" });').join(), /127\.0\.0\.1/);
    assert.deepEqual(nodeRequireProblems('require("node:fs"); require(name);'), ["dynamic require()"]);
  });

  it("bundles the relay as one CommonJS file with the version injected and refuses package imports", async () => {
    const root = tmpDir("bundle-relay");
    writeTree(root, {
      "main.ts": 'import http from "node:http";\ndeclare const __RELAY_VERSION__: string;\nconsole.log(__RELAY_VERSION__, typeof http.request);\n',
      "dep.ts": 'import x from "some-package";\nconsole.log(x);\n',
    });
    const code = await bundleNodeScript(root, "main.ts", "node18", "1.2.3");
    assert.match(code, /require\("node:http"\)/);
    assert.ok(code.includes('"1.2.3"'));
    assert.deepEqual(nodeRequireProblems(code), []);
    await assert.rejects(bundleNodeScript(root, "dep.ts", "node18", "1.2.3"), /some-package is not a node: built-in/);
  });

  it("the real relay sources bundle cleanly and pass the shipped-bundle checks", async () => {
    const code = await bundleNodeScript(REPO_ROOT, "packages/claude-desktop/src/main.ts", "node18", "0.1.0");
    assert.deepEqual(relayBundleProblems(code), []);
  });
});

describe("formatTable", () => {
  it("aligns columns without trailing spaces", () => {
    assert.equal(
      formatTable(["A", "BB", "C"], [["xxx", "y", "z"], ["1", "", ""]]),
      ["A    BB  C", "---  --  -", "xxx  y   z", "1"].join("\n"),
    );
  });
});
