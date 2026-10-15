/**
 * Release build: typecheck -> bundle + stage (work/stage) -> archives (outputs/) -> BUILD-INFO.json.
 *
 *   npm run build      (tsx scripts/build.ts)
 *
 * Only work/stage and outputs/ are ever deleted. Any failure removes outputs/ entirely, so a failed build
 * never leaves a complete-looking package behind; archives are written as *.partial and renamed when done.
 * Node fs/path/child_process only (no shell), so Chinese and space-containing paths work everywhere.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BRIDGE_NAME } from "../shared/types/bridge.js";
import { PLUGIN_NAME } from "../shared/types/hook.js";
import { bundleClassicScript, bundleForInspection } from "./lib/bundle.js";
import { bundleContractProblems, endpointRegistrationProblems } from "./lib/checks.js";
import { errorMessage, isMainModule, repoRootFrom } from "./lib/cli.js";
import {
  type IgnoreRule,
  compareStrings,
  isPathIgnored,
  loadPackagingIgnoreRules,
  relativeTo,
  removeTree,
  resolveInside,
  sha256,
  walkFiles,
  writeFileEnsured,
} from "./lib/files.js";
import { expandIncludes, findIncludeMarkers } from "./lib/includes.js";
import {
  CLIENT_PACKAGES,
  ENDPOINT_MODULE,
  MARKETPLACE_MANIFESTS,
  OUTPUTS_DIR,
  OUTPUT_NAMES,
  PACKAGE_JSON,
  PARTIAL_SUFFIX,
  SCIENCE_SOURCE_DIR,
  STAGE_DIR,
  TSC_ENTRY,
  TYPECHECK_PROJECTS,
  ZOTERO_BUNDLES,
  ZOTERO_COPY_DIRS,
  ZOTERO_COPY_FILES,
  ZOTERO_MANIFEST,
  ZOTERO_SOURCE_DIR,
  sourceArchivePrefix,
} from "./lib/layout.js";
import { injectMarketplaceVersion, injectVersion, readPackageVersion } from "./lib/manifests.js";
import { type ZipInputEntry, writeZipAtomic } from "./lib/zip.js";

export interface BuildOptions {
  /** Repository root; every input and output path is resolved against it. */
  root: string;
  /** tsconfig projects (root-relative) to typecheck first; an empty list skips the step. */
  typecheckProjects?: readonly string[];
  /** TypeScript CLI script run with this Node binary; defaults to <root>/node_modules/typescript/bin/tsc. */
  tscPath?: string;
  log?: (line: string) => void;
}

export interface OutputFileInfo {
  path: string;
  size: number;
  sha256: string;
}

export interface BuildInfo {
  name: string;
  version: string;
  /** The only non-deterministic field. */
  builtAt: string;
  files: OutputFileInfo[];
}

interface BuildContext {
  root: string;
  version: string;
  rules: readonly IgnoreRule[];
  stageDir: string;
  outputsDir: string;
  log: (line: string) => void;
}

const STAGE_NAMES = { zotero: "zotero", science: "claude-science" } as const;

function abs(root: string, rel: string): string {
  return path.join(root, ...rel.split("/"));
}

function isFile(p: string): boolean {
  return fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
}

function isDirectory(p: string): boolean {
  return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function requireFile(ctx: BuildContext, rel: string): Buffer {
  const file = abs(ctx.root, rel);
  if (!isFile(file)) throw new Error(`missing input file ${rel}`);
  return fs.readFileSync(file);
}

function requireDirectory(ctx: BuildContext, rel: string): void {
  if (!isDirectory(abs(ctx.root, rel))) throw new Error(`missing input directory ${rel}`);
}

function stage(ctx: BuildContext, stageName: string, rel: string, data: Buffer | string): void {
  writeFileEnsured(abs(path.join(ctx.stageDir, stageName), rel), data);
}

// ---------------------------------------------------------------------------------------------- typecheck

interface TscRun {
  project: string;
  code: number;
  output: string;
  ms: number;
}

function runTsc(root: string, tscPath: string, project: string): Promise<TscRun> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [tscPath, "-p", project, "--pretty", "false"], {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const output = Buffer.concat(chunks).toString("utf8") + (signal ? `\n(tsc terminated by ${signal})` : "");
      resolve({ project, code: code ?? 1, output, ms: Date.now() - started });
    });
  });
}

async function typecheck(ctx: BuildContext, projects: readonly string[], tscPath: string): Promise<void> {
  if (projects.length === 0) {
    ctx.log("typecheck skipped (no projects configured)");
    return;
  }
  if (!isFile(tscPath)) throw new Error(`TypeScript compiler not found at ${tscPath} (run npm install)`);
  for (const project of projects) requireFile(ctx, project);
  // Independent projects: run them concurrently, report in a stable order.
  const runs = await Promise.all(projects.map((project) => runTsc(ctx.root, tscPath, project)));
  for (const run of runs) ctx.log(`typecheck ${run.project}: ${run.code === 0 ? "ok" : "FAILED"} (${run.ms} ms)`);
  const failed = runs.filter((run) => run.code !== 0);
  if (failed.length > 0) {
    throw new Error(`typecheck failed:\n${failed.map((run) => `--- ${run.project}\n${run.output.trimEnd()}`).join("\n")}`);
  }
}

// ------------------------------------------------------------------------------------------------ staging

function isTypeScriptSource(rel: string): boolean {
  return /\.(?:[cm]?ts|tsx)$/.test(rel) || /(?:^|\/)tsconfig(?:\.[\w-]+)?\.json$/.test(rel);
}

async function stageZotero(ctx: BuildContext): Promise<void> {
  const bundled = new Map<string, string>();
  for (const spec of ZOTERO_BUNDLES) {
    requireFile(ctx, spec.entry);
    const code = await bundleClassicScript(ctx.root, spec);
    bundled.set(spec.out, code);
    stage(ctx, STAGE_NAMES.zotero, spec.out, code);
    ctx.log(`bundled ${spec.entry} -> ${spec.out}`);
  }
  await assertBundleContracts(ctx, bundled);

  for (const file of ZOTERO_COPY_FILES) {
    const rel = `${ZOTERO_SOURCE_DIR}/${file}`;
    let data: Buffer | string = requireFile(ctx, rel);
    if (file === ZOTERO_MANIFEST) data = withVersion(ctx, rel, data);
    stage(ctx, STAGE_NAMES.zotero, file, data);
  }
  for (const dir of ZOTERO_COPY_DIRS) {
    const base = `${ZOTERO_SOURCE_DIR}/${dir}`;
    requireDirectory(ctx, base);
    for (const rel of walkFiles(ctx.root, base, ctx.rules)) {
      if (isTypeScriptSource(rel)) continue;
      const inner = relativeTo(ZOTERO_SOURCE_DIR, rel);
      if (bundled.has(inner)) throw new Error(`${rel} would overwrite the bundle ${inner}; delete the stale file`);
      stage(ctx, STAGE_NAMES.zotero, inner, requireFile(ctx, rel));
    }
  }
}

/** Global name of the check-only endpoint bundle; it only ever exists inside a stub sandbox. */
const INSPECTION_GLOBAL = "__zoteroAIBridgeEndpointModule";

/**
 * Contracts with Zotero that only fail at runtime inside Zotero, proven on the bundles before anything is
 * packaged: the bootstrap/bridge globals in one stub sandbox, and endpoint registration (init arity).
 */
async function assertBundleContracts(ctx: BuildContext, bundled: ReadonlyMap<string, string>): Promise<void> {
  const problems = bundleContractProblems(bundled.get("bootstrap.js") ?? "", bundled.get("content/bridge.js") ?? "");
  requireFile(ctx, ENDPOINT_MODULE);
  try {
    const inspection = await bundleForInspection(ctx.root, ENDPOINT_MODULE, INSPECTION_GLOBAL);
    problems.push(...endpointRegistrationProblems(inspection, INSPECTION_GLOBAL));
  } catch (error) {
    problems.push(`${ENDPOINT_MODULE}: ${errorMessage(error)}`);
  }
  if (problems.length > 0) throw new Error(`Zotero bundle contract violated:\n  ${problems.join("\n  ")}`);
  ctx.log("bundle contracts ok (bootstrap hooks, ZoteroAIBridgeMain, endpoint init arity)");
}

function withVersion(ctx: BuildContext, rel: string, data: Buffer): string {
  const { text, previous } = injectVersion(data.toString("utf8"), ctx.version, rel);
  if (previous !== ctx.version) ctx.log(`${rel}: version ${JSON.stringify(previous)} -> ${ctx.version}`);
  return text;
}

function includeLoader(ctx: BuildContext): (target: string) => string | null {
  return (target) => {
    // Never let an include pull ignored files (local config, credentials, build output) into a package.
    if (isPathIgnored(target, ctx.rules)) throw new Error(`include target ${target} is excluded by ignore rules`);
    const file = abs(ctx.root, target);
    return isFile(file) ? fs.readFileSync(file, "utf8") : null;
  };
}

/** Copy a plugin/skill tree (dotfiles included), expanding Markdown includes and injecting versions. */
function stageTree(ctx: BuildContext, sourceDir: string, stageName: string, manifest: string | null): void {
  requireDirectory(ctx, sourceDir);
  const files = walkFiles(ctx.root, sourceDir, ctx.rules);
  if (manifest && !files.includes(`${sourceDir}/${manifest}`)) throw new Error(`missing input file ${sourceDir}/${manifest}`);
  const load = includeLoader(ctx);
  for (const rel of files) {
    const inner = relativeTo(sourceDir, rel);
    let data: Buffer | string = requireFile(ctx, rel);
    if (inner === manifest) {
      data = withVersion(ctx, rel, data);
    } else if ((MARKETPLACE_MANIFESTS as readonly string[]).includes(inner)) {
      data = injectMarketplaceVersion(data.toString("utf8"), PLUGIN_NAME, ctx.version, rel);
    } else if (inner.toLowerCase().endsWith(".md")) {
      const expanded = expandIncludes(data.toString("utf8"), rel, load);
      const leftover = findIncludeMarkers(expanded);
      if (leftover.length > 0) throw new Error(`${rel}: unresolved include markers at lines ${leftover.join(", ")}`);
      data = expanded;
    }
    stage(ctx, stageName, inner, data);
  }
  ctx.log(`staged ${sourceDir} (${files.length} files)`);
}

// ---------------------------------------------------------------------------------------------- packaging

function stagedEntries(ctx: BuildContext, stageName: string): ZipInputEntry[] {
  return walkFiles(ctx.stageDir, stageName, []).map((rel) => ({
    name: relativeTo(stageName, rel),
    data: fs.readFileSync(abs(ctx.stageDir, rel)),
  }));
}

async function writeArchive(ctx: BuildContext, name: string, entries: ZipInputEntry[]): Promise<void> {
  await writeZipAtomic(path.join(ctx.outputsDir, name), entries);
  ctx.log(`wrote ${OUTPUTS_DIR}/${name} (${entries.length} entries)`);
}

/** The Claude Science skill ships as a plain directory; copy it via a partial dir and rename. */
function writeScienceDirectory(ctx: BuildContext): void {
  const target = path.join(ctx.outputsDir, OUTPUT_NAMES.scienceDir);
  const partial = `${target}${PARTIAL_SUFFIX}`;
  removeTree(partial);
  const entries = stagedEntries(ctx, STAGE_NAMES.science);
  for (const entry of entries) writeFileEnsured(abs(partial, entry.name), entry.data);
  fs.renameSync(partial, target);
  ctx.log(`wrote ${OUTPUTS_DIR}/${OUTPUT_NAMES.scienceDir}/ (${entries.length} files)`);
}

function sourceEntries(ctx: BuildContext): ZipInputEntry[] {
  const prefix = sourceArchivePrefix(ctx.version);
  return walkFiles(ctx.root, "", ctx.rules).map((rel) => ({
    name: `${prefix}${rel}`,
    data: fs.readFileSync(abs(ctx.root, rel)),
  }));
}

function outputInventory(outputsDir: string): OutputFileInfo[] {
  return walkFiles(outputsDir, "", [])
    .filter((rel) => rel !== OUTPUT_NAMES.buildInfo)
    .map((rel) => {
      const data = fs.readFileSync(abs(outputsDir, rel));
      return { path: rel, size: data.length, sha256: sha256(data) };
    })
    .sort((a, b) => compareStrings(a.path, b.path));
}

// ------------------------------------------------------------------------------------------------- driver

export async function runBuild(options: BuildOptions): Promise<BuildInfo> {
  const root = path.resolve(options.root);
  const outputsDir = resolveInside(root, OUTPUTS_DIR);
  const stageDir = resolveInside(root, STAGE_DIR);
  const log = options.log ?? ((line: string) => console.log(`[build] ${line}`));
  try {
    const version = readPackageVersion(fs.readFileSync(abs(root, PACKAGE_JSON), "utf8"));
    const ctx: BuildContext = { root, version, rules: loadPackagingIgnoreRules(root), stageDir, outputsDir, log };
    log(`${BRIDGE_NAME} ${version}`);

    await typecheck(ctx, options.typecheckProjects ?? TYPECHECK_PROJECTS, options.tscPath ?? abs(root, TSC_ENTRY));

    removeTree(stageDir);
    removeTree(outputsDir);
    fs.mkdirSync(outputsDir, { recursive: true });

    await stageZotero(ctx);
    for (const client of CLIENT_PACKAGES) stageTree(ctx, client.sourceDir, client.id, client.manifest);
    stageTree(ctx, SCIENCE_SOURCE_DIR, STAGE_NAMES.science, null);

    await writeArchive(ctx, OUTPUT_NAMES.xpi, stagedEntries(ctx, STAGE_NAMES.zotero));
    for (const client of CLIENT_PACKAGES) await writeArchive(ctx, client.archive, stagedEntries(ctx, client.id));
    writeScienceDirectory(ctx);
    await writeArchive(ctx, OUTPUT_NAMES.source, sourceEntries(ctx));

    const info: BuildInfo = {
      name: BRIDGE_NAME,
      version,
      builtAt: new Date().toISOString(),
      files: outputInventory(outputsDir),
    };
    fs.writeFileSync(path.join(outputsDir, OUTPUT_NAMES.buildInfo), `${JSON.stringify(info, null, 2)}\n`);
    log(`wrote ${OUTPUTS_DIR}/${OUTPUT_NAMES.buildInfo}`);
    return info;
  } catch (error) {
    removeTree(outputsDir);
    throw error;
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  try {
    const info = await runBuild({ root: repoRootFrom(import.meta.url) });
    console.log(`[build] OK: ${info.files.length} files in ${OUTPUTS_DIR}/ (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } catch (error) {
    console.error(`[build] FAILED: ${errorMessage(error)}`);
    // Expected failures carry a precise message; a stack only helps for bugs in this script.
    if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError) console.error(error.stack);
    console.error(`[build] ${OUTPUTS_DIR}/ was removed; nothing from this run is publishable.`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) await main();
