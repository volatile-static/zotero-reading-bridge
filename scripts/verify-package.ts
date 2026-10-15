/**
 * Verify the build outputs before anything is handed out:
 *
 *   npm run verify     (tsx scripts/verify-package.ts)
 *
 * Opens every archive with yauzl and checks structure, manifests, client hook wiring, bundle shape,
 * secrets and machine paths, then prints a PASS/FAIL table. Exit code 1 on any failure.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type CheckResult,
  type FileMap,
  claudeCodePackageChecks,
  codexPackageChecks,
  readText,
  runCheck,
  skillProblems,
  xpiPackageChecks,
} from "./lib/checks.js";
import { errorMessage, formatTable, isMainModule, repoRootFrom } from "./lib/cli.js";
import {
  type IgnoreRule,
  compareStrings,
  isPathIgnored,
  loadPackagingIgnoreRules,
  relativeTo,
  sha256,
  walkFiles,
} from "./lib/files.js";
import { findIncludeMarkers } from "./lib/includes.js";
import {
  OUTPUTS_DIR,
  OUTPUT_NAMES,
  PACKAGE_JSON,
  SKILL_FILE,
  sourceArchivePrefix,
} from "./lib/layout.js";
import { isRecord, readPackageVersion } from "./lib/manifests.js";
import {
  ABSOLUTE_PATH_RULES,
  SECRET_RULES,
  type ScanFinding,
  forbiddenFileName,
  homeDirectoryRules,
  scanContent,
} from "./lib/scan.js";
import { readZip, zipEntryProblems } from "./lib/zip.js";

export interface VerifyOptions {
  root: string;
  /** Home directory whose spelling must not appear in outputs; defaults to os.homedir(). */
  homeDir?: string;
}

export interface VerifyRow extends CheckResult {
  group: string;
}

/** A packaged file set: archive or directory name in outputs/, plus its files. */
interface PackageContent {
  label: string;
  files: FileMap;
}

const ARCHIVES = [OUTPUT_NAMES.xpi, OUTPUT_NAMES.codex, OUTPUT_NAMES.claudeCode, OUTPUT_NAMES.source] as const;
const MAX_LISTED = 12;

function summarize(problems: readonly string[]): string[] {
  if (problems.length <= MAX_LISTED) return [...problems];
  return [...problems.slice(0, MAX_LISTED), `... and ${problems.length - MAX_LISTED} more`];
}

function describeFindings(findings: readonly ScanFinding[]): string[] {
  return summarize(findings.map((f) => `${f.file}:${f.line} [${f.rule}]`));
}

function inventoryProblems(outputsDir: string): string[] {
  if (!fs.existsSync(outputsDir)) return [`${OUTPUTS_DIR}/ does not exist (run npm run build)`];
  const problems: string[] = [];
  const present = new Map(fs.readdirSync(outputsDir, { withFileTypes: true }).map((d) => [d.name, d]));
  const expected: readonly string[] = [...ARCHIVES, OUTPUT_NAMES.scienceDir, OUTPUT_NAMES.buildInfo];
  for (const name of expected) {
    const entry = present.get(name);
    if (!entry) problems.push(`missing ${name}`);
    else if ((name === OUTPUT_NAMES.scienceDir) !== entry.isDirectory()) problems.push(`${name} has the wrong type`);
  }
  for (const name of present.keys()) if (!expected.includes(name)) problems.push(`unexpected ${name}`);
  return problems;
}

async function readArchive(outputsDir: string, name: string, rows: VerifyRow[]): Promise<FileMap | null> {
  const file = path.join(outputsDir, name);
  if (!fs.existsSync(file)) {
    rows.push({ group: name, name: "archive readable", ok: false, detail: "missing" });
    return null;
  }
  try {
    const entries = await readZip(file);
    rows.push({ group: name, ...runCheck("well-formed deterministic ZIP (names, CRC, UTF-8 flag, mtime, order)", () => summarize(zipEntryProblems(entries))) });
    return new Map(entries.filter((e) => !e.isDirectory).map((e) => [e.name, e.data]));
  } catch (error) {
    rows.push({ group: name, name: "archive readable", ok: false, detail: errorMessage(error) });
    return null;
  }
}

function readDirectory(outputsDir: string, name: string): FileMap | null {
  if (!fs.existsSync(path.join(outputsDir, name))) return null;
  return new Map(
    walkFiles(outputsDir, name, []).map((rel) => [
      relativeTo(name, rel),
      fs.readFileSync(path.join(outputsDir, ...rel.split("/"))),
    ]),
  );
}

function sourceProblems(files: FileMap, version: string, rules: readonly IgnoreRule[]): string[] {
  const prefix = sourceArchivePrefix(version);
  const problems: string[] = [];
  for (const name of files.keys()) {
    if (!name.startsWith(prefix)) {
      problems.push(`${name} is outside ${prefix}`);
      continue;
    }
    const rel = name.slice(prefix.length);
    if (isPathIgnored(rel, rules)) problems.push(`${rel} is excluded (node_modules/.git/work/outputs/*.tsbuildinfo/.gitignore)`);
  }
  for (const required of [PACKAGE_JSON, "scripts/build.ts"]) {
    if (!files.has(`${prefix}${required}`)) problems.push(`missing ${required}`);
  }
  return summarize(problems);
}

function buildInfoProblems(outputsDir: string, version: string): string[] {
  const info: unknown = JSON.parse(fs.readFileSync(path.join(outputsDir, OUTPUT_NAMES.buildInfo), "utf8"));
  if (!isRecord(info)) return ["BUILD-INFO.json is not an object"];
  const problems: string[] = [];
  if (info["version"] !== version) problems.push(`version ${JSON.stringify(info["version"])} != ${version}`);
  if (typeof info["builtAt"] !== "string" || Number.isNaN(Date.parse(info["builtAt"]))) problems.push("builtAt is not a timestamp");
  const listed = Array.isArray(info["files"]) ? (info["files"] as unknown[]) : [];
  const actual = walkFiles(outputsDir, "", [])
    .filter((rel) => rel !== OUTPUT_NAMES.buildInfo)
    .sort(compareStrings);
  const listedPaths = listed.map((f) => (isRecord(f) ? String(f["path"]) : "?"));
  if (listedPaths.join("\n") !== actual.join("\n")) problems.push("file list differs from outputs/ contents");
  for (const entry of listed) {
    if (!isRecord(entry) || !actual.includes(String(entry["path"]))) continue;
    const data = fs.readFileSync(path.join(outputsDir, ...String(entry["path"]).split("/")));
    if (entry["size"] !== data.length || entry["sha256"] !== sha256(data)) problems.push(`${String(entry["path"])}: size/sha256 mismatch`);
  }
  return summarize(problems);
}

/** Scans that apply to every shipped byte. source.zip legitimately contains unexpanded include markers. */
function contentScans(contents: readonly PackageContent[], homeDir: string): VerifyRow[] {
  const pathRules = [...ABSOLUTE_PATH_RULES, ...homeDirectoryRules(homeDir)];
  const forbidden: string[] = [];
  const secrets: ScanFinding[] = [];
  const paths: ScanFinding[] = [];
  const markers: string[] = [];
  for (const { label, files } of contents) {
    for (const [name, data] of files) {
      const where = `${label}:${name}`;
      const reason = forbiddenFileName(name);
      if (reason) forbidden.push(`${label}: ${reason}`);
      secrets.push(...scanContent(where, data, SECRET_RULES));
      paths.push(...scanContent(where, data, pathRules));
      if (label !== OUTPUT_NAMES.source) {
        for (const line of findIncludeMarkers(data.toString("utf8"))) markers.push(`${where}:${line}`);
      }
    }
  }
  return [
    { group: "all outputs", ...runCheck("no credential files (.env, auth.json, .credentials.json, keys)", () => summarize(forbidden)) },
    { group: "all outputs", ...runCheck("no secrets (keys, tokens, auth headers, credential assignments)", () => describeFindings(secrets)) },
    { group: "all outputs", ...runCheck("no absolute user paths", () => describeFindings(paths)) },
    { group: "all outputs", ...runCheck("no unresolved <!-- @include --> markers in packages", () => summarize(markers)) },
  ];
}

export async function verifyPackage(options: VerifyOptions): Promise<VerifyRow[]> {
  const root = path.resolve(options.root);
  const outputsDir = path.join(root, OUTPUTS_DIR);
  const rows: VerifyRow[] = [];
  let version: string;
  let rules: IgnoreRule[];
  try {
    version = readPackageVersion(fs.readFileSync(path.join(root, PACKAGE_JSON), "utf8"));
    rules = loadPackagingIgnoreRules(root);
  } catch (error) {
    return [{ group: "setup", name: "read package.json and .gitignore", ok: false, detail: errorMessage(error) }];
  }

  rows.push({ group: "outputs", ...runCheck("expected outputs present, nothing else", () => inventoryProblems(outputsDir)) });

  const contents: PackageContent[] = [];
  const add = (group: string, results: readonly CheckResult[]): void => {
    for (const result of results) rows.push({ group, ...result });
  };

  const xpi = await readArchive(outputsDir, OUTPUT_NAMES.xpi, rows);
  if (xpi) {
    contents.push({ label: OUTPUT_NAMES.xpi, files: xpi });
    add(OUTPUT_NAMES.xpi, xpiPackageChecks(xpi, version));
  }
  const codex = await readArchive(outputsDir, OUTPUT_NAMES.codex, rows);
  if (codex) {
    contents.push({ label: OUTPUT_NAMES.codex, files: codex });
    add(OUTPUT_NAMES.codex, codexPackageChecks(codex, version));
  }
  const claude = await readArchive(outputsDir, OUTPUT_NAMES.claudeCode, rows);
  if (claude) {
    contents.push({ label: OUTPUT_NAMES.claudeCode, files: claude });
    add(OUTPUT_NAMES.claudeCode, claudeCodePackageChecks(claude, version));
  }
  const science = readDirectory(outputsDir, OUTPUT_NAMES.scienceDir);
  if (science) {
    contents.push({ label: OUTPUT_NAMES.scienceDir, files: science });
    add(OUTPUT_NAMES.scienceDir, [
      runCheck(`${SKILL_FILE} front matter`, () => skillProblems(science)),
      runCheck("README.md present", () => (readText(science, "README.md").trim() ? [] : ["README.md is empty"])),
    ]);
  } else {
    rows.push({ group: OUTPUT_NAMES.scienceDir, name: "directory present", ok: false, detail: "missing" });
  }
  const source = await readArchive(outputsDir, OUTPUT_NAMES.source, rows);
  if (source) {
    contents.push({ label: OUTPUT_NAMES.source, files: source });
    add(OUTPUT_NAMES.source, [runCheck("only repository sources (exclusions honoured)", () => sourceProblems(source, version, rules))]);
  }
  const buildInfoPath = path.join(outputsDir, OUTPUT_NAMES.buildInfo);
  if (fs.existsSync(buildInfoPath)) {
    contents.push({ label: OUTPUTS_DIR, files: new Map([[OUTPUT_NAMES.buildInfo, fs.readFileSync(buildInfoPath)]]) });
    add(OUTPUT_NAMES.buildInfo, [runCheck("matches outputs (paths, sizes, sha256)", () => buildInfoProblems(outputsDir, version))]);
  }

  rows.push(...contentScans(contents, options.homeDir ?? os.homedir()));
  return rows;
}

export function formatReport(rows: readonly VerifyRow[]): string {
  const table = formatTable(
    ["STATUS", "PACKAGE", "CHECK", "DETAIL"],
    rows.map((row) => [row.ok ? "PASS" : "FAIL", row.group, row.name, row.detail ?? ""]),
  );
  const failed = rows.filter((row) => !row.ok).length;
  return `${table}\n\n${rows.length - failed} passed, ${failed} failed`;
}

async function main(): Promise<void> {
  try {
    const rows = await verifyPackage({ root: repoRootFrom(import.meta.url) });
    console.log(formatReport(rows));
    if (rows.some((row) => !row.ok)) process.exitCode = 1;
  } catch (error) {
    console.error(`[verify] FAILED: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) await main();
