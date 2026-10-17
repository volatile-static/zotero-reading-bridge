/**
 * Release build: typecheck -> bundle + stage (work/stage) -> archives (outputs/) -> BUILD-INFO.json -> verify.
 *
 *   npm run build      (tsx scripts/build.ts)
 *
 * One run packages all three plugins: the Zotero XPI, the Codex ZIP and the Claude Desktop MCPB (the last two carry
 * the same relay bundle), plus source.zip. package.json supplies the metadata every manifest shares.
 *
 * Only work/stage and outputs/ are ever deleted. Any failure (including a failed package check) removes outputs/
 * entirely, so a failed build never leaves a complete-looking package behind; archives are written as *.partial and
 * renamed when done. Node fs/path/child_process only (no shell), so Chinese and space-containing paths work everywhere.
 */
import fs from "node:fs";
import path from "node:path";
import { BRIDGE_NAME } from "../shared/types/bridge.js";
import { bundleClassicScript, bundleForInspection, bundleNodeScript } from "./lib/bundle.js";
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
  CODEX_MCP_CONFIG,
  CODEX_PLUGIN,
  CODEX_PORTABLE_MANIFEST,
  CODEX_PORTABLE_MCP_CONFIG,
  DESKTOP_PLUGIN,
  ENDPOINT_MODULE,
  OUTPUTS_DIR,
  OUTPUT_NAMES,
  PACKAGE_JSON,
  type PluginSpec,
  RELAY_ENTRY,
  RELAY_NODE_TARGET,
  RELAY_OUT,
  STAGE_DIR,
  TSC_ENTRY,
  TYPECHECK_PROJECTS,
  ZOTERO_BUNDLES,
  ZOTERO_COPY_DIRS,
  ZOTERO_PLUGIN,
  sourceArchivePrefix,
} from "./lib/layout.js";
import {
  type ManifestKind,
  type PackageMetadata,
  injectMetadata,
  parseJsonObject,
  portableCodexManifest,
  portableMcpConfig,
  readPackageMetadata,
  serializeJson,
} from "./lib/manifests.js";
import { typecheck } from "./lib/typecheck.js";
import { type ZipInputEntry, writeZipAtomic } from "./lib/zip.js";
import { formatReport, verifyPackage } from "./verify-package.js";

export interface BuildOptions {
  /** Repository root; every input and output path is resolved against it. */
  root: string;
  /** tsconfig projects (root-relative) to typecheck first; an empty list skips the step. */
  typecheckProjects?: readonly string[];
  /** TypeScript CLI script run with this Node binary; defaults to <root>/node_modules/typescript/bin/tsc. */
  tscPath?: string;
  /** Run the package verifier on the outputs (default true). */
  verify?: boolean;
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
  meta: PackageMetadata;
  rules: readonly IgnoreRule[];
  stageDir: string;
  outputsDir: string;
  log: (line: string) => void;
}

const PLUGINS = [ZOTERO_PLUGIN, CODEX_PLUGIN, DESKTOP_PLUGIN] as const;

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

function stage(ctx: BuildContext, plugin: PluginSpec, rel: string, data: Buffer | string): void {
  writeFileEnsured(abs(path.join(ctx.stageDir, plugin.id), rel), data);
}

function isTypeScriptSource(rel: string): boolean {
  return /\.(?:[cm]?ts|tsx)$/.test(rel) || /(?:^|\/)tsconfig(?:\.[\w-]+)?\.json$/.test(rel);
}

function manifestWithMetadata(ctx: BuildContext, plugin: PluginSpec, kind: ManifestKind): Record<string, unknown> {
  const rel = `${plugin.sourceDir}/${plugin.manifest}`;
  return injectMetadata(requireFile(ctx, rel).toString("utf8"), ctx.meta, kind, rel);
}

// ------------------------------------------------------------------------------------------------ Zotero

async function stageZotero(ctx: BuildContext): Promise<void> {
  const bundled = new Map<string, string>();
  for (const spec of ZOTERO_BUNDLES) {
    requireFile(ctx, spec.entry);
    const code = await bundleClassicScript(ctx.root, spec);
    bundled.set(spec.out, code);
    stage(ctx, ZOTERO_PLUGIN, spec.out, code);
    ctx.log(`bundled ${spec.entry} -> ${spec.out}`);
  }
  await assertBundleContracts(ctx, bundled);

  stage(ctx, ZOTERO_PLUGIN, ZOTERO_PLUGIN.manifest, serializeJson(manifestWithMetadata(ctx, ZOTERO_PLUGIN, "zotero")));
  for (const dir of ZOTERO_COPY_DIRS) {
    const base = `${ZOTERO_PLUGIN.sourceDir}/${dir}`;
    requireDirectory(ctx, base);
    for (const rel of walkFiles(ctx.root, base, ctx.rules)) {
      if (isTypeScriptSource(rel)) continue;
      const inner = relativeTo(ZOTERO_PLUGIN.sourceDir, rel);
      if (bundled.has(inner)) throw new Error(`${rel} would overwrite the bundle ${inner}; delete the stale file`);
      stage(ctx, ZOTERO_PLUGIN, inner, requireFile(ctx, rel));
    }
  }
}

/** Global name of the check-only endpoint bundle; it only ever exists inside a stub sandbox. */
const INSPECTION_GLOBAL = "__zoteroReadingBridgeEndpointModule";

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
  ctx.log("bundle contracts ok (bootstrap hooks, ZoteroReadingBridgeMain, endpoint init arity)");
}

// ------------------------------------------------------------------------------------- desktop plugins

function includeLoader(ctx: BuildContext): (target: string) => string | null {
  return (target) => {
    // Never let an include pull ignored files (local config, credentials, build output) into a package.
    if (isPathIgnored(target, ctx.rules)) throw new Error(`include target ${target} is excluded by ignore rules`);
    const file = abs(ctx.root, target);
    return isFile(file) ? fs.readFileSync(file, "utf8") : null;
  };
}

/**
 * Stage a desktop plugin directory (dotfiles included): the manifest with the shared metadata filled in, Markdown
 * with includes expanded, the shared relay, everything else as it is. Returns the staged manifest.
 */
function stageDesktopPlugin(ctx: BuildContext, plugin: PluginSpec, relay: string): Record<string, unknown> {
  requireDirectory(ctx, plugin.sourceDir);
  const manifest = manifestWithMetadata(ctx, plugin, "client");
  stage(ctx, plugin, plugin.manifest, serializeJson(manifest));
  stage(ctx, plugin, RELAY_OUT, relay);
  const load = includeLoader(ctx);
  const files = walkFiles(ctx.root, plugin.sourceDir, ctx.rules);
  for (const rel of files) {
    const inner = relativeTo(plugin.sourceDir, rel);
    if (inner === plugin.manifest || isTypeScriptSource(rel)) continue;
    if (inner === RELAY_OUT) throw new Error(`${rel} would overwrite the relay bundle; delete the stale file`);
    let data: Buffer | string = requireFile(ctx, rel);
    if (inner.toLowerCase().endsWith(".md")) {
      const expanded = expandIncludes(data.toString("utf8"), rel, load);
      const leftover = findIncludeMarkers(expanded);
      if (leftover.length > 0) throw new Error(`${rel}: unresolved include markers at lines ${leftover.join(", ")}`);
      data = expanded;
    }
    stage(ctx, plugin, inner, data);
  }
  ctx.log(`staged ${plugin.sourceDir} (${files.length} files + ${RELAY_OUT})`);
  return manifest;
}

/** Codex also ships agent-plugins.org copies of its manifest and MCP config, derived from its own. */
function stageCodex(ctx: BuildContext, relay: string): void {
  const manifest = stageDesktopPlugin(ctx, CODEX_PLUGIN, relay);
  const mcpRel = `${CODEX_PLUGIN.sourceDir}/${CODEX_MCP_CONFIG}`;
  const mcp = parseJsonObject(requireFile(ctx, mcpRel).toString("utf8"), mcpRel);
  for (const derived of [CODEX_PORTABLE_MANIFEST, CODEX_PORTABLE_MCP_CONFIG]) {
    if (isFile(abs(ctx.root, `${CODEX_PLUGIN.sourceDir}/${derived}`))) {
      throw new Error(`${CODEX_PLUGIN.sourceDir}/${derived} is generated by the build; delete the source file`);
    }
  }
  stage(ctx, CODEX_PLUGIN, CODEX_PORTABLE_MANIFEST, serializeJson(portableCodexManifest(manifest)));
  stage(ctx, CODEX_PLUGIN, CODEX_PORTABLE_MCP_CONFIG, serializeJson(portableMcpConfig(mcp)));
}

// ---------------------------------------------------------------------------------------------- packaging

function stagedEntries(ctx: BuildContext, plugin: PluginSpec): ZipInputEntry[] {
  return walkFiles(ctx.stageDir, plugin.id, []).map((rel) => ({
    name: relativeTo(plugin.id, rel),
    data: fs.readFileSync(abs(ctx.stageDir, rel)),
  }));
}

async function writeArchive(ctx: BuildContext, name: string, entries: ZipInputEntry[]): Promise<void> {
  await writeZipAtomic(path.join(ctx.outputsDir, name), entries);
  ctx.log(`wrote ${OUTPUTS_DIR}/${name} (${entries.length} entries)`);
}

function sourceEntries(ctx: BuildContext): ZipInputEntry[] {
  const prefix = sourceArchivePrefix(ctx.meta.version);
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
    const meta = readPackageMetadata(fs.readFileSync(abs(root, PACKAGE_JSON), "utf8"));
    const ctx: BuildContext = { root, meta, rules: loadPackagingIgnoreRules(root), stageDir, outputsDir, log };
    log(`${BRIDGE_NAME} ${meta.version}`);

    await typecheck(root, options.typecheckProjects ?? TYPECHECK_PROJECTS, options.tscPath ?? abs(root, TSC_ENTRY), log);

    removeTree(stageDir);
    removeTree(outputsDir);
    fs.mkdirSync(outputsDir, { recursive: true });

    await stageZotero(ctx);
    requireFile(ctx, RELAY_ENTRY);
    const relay = await bundleNodeScript(root, RELAY_ENTRY, RELAY_NODE_TARGET, meta.version);
    log(`bundled ${RELAY_ENTRY} -> ${RELAY_OUT}`);
    stageCodex(ctx, relay);
    stageDesktopPlugin(ctx, DESKTOP_PLUGIN, relay);

    const license = requireFile(ctx, "LICENSE");
    for (const plugin of PLUGINS) {
      // Every distributable carries the project's license and attribution.
      stage(ctx, plugin, "LICENSE", license);
      await writeArchive(ctx, plugin.archive, stagedEntries(ctx, plugin));
    }
    await writeArchive(ctx, OUTPUT_NAMES.source, sourceEntries(ctx));

    const info: BuildInfo = {
      name: BRIDGE_NAME,
      version: meta.version,
      builtAt: new Date().toISOString(),
      files: outputInventory(outputsDir),
    };
    fs.writeFileSync(path.join(outputsDir, OUTPUT_NAMES.buildInfo), `${JSON.stringify(info, null, 2)}\n`);
    log(`wrote ${OUTPUTS_DIR}/${OUTPUT_NAMES.buildInfo}`);

    if (options.verify ?? true) {
      const rows = await verifyPackage({ root });
      const failed = rows.filter((row) => !row.ok);
      if (failed.length > 0) throw new Error(`package checks failed:\n${formatReport(failed)}`);
      log(`verify: ${rows.length} package checks passed`);
    }
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
