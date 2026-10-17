/**
 * Repository layout and output names shared by the build and the package verifier.
 * Every path is repo-relative with forward slashes so the same constants work on Windows and POSIX.
 */
import { BRIDGE_NAME } from "../../shared/types/bridge.js";

export const PACKAGE_JSON = "package.json";
export const GITIGNORE = ".gitignore";

/** tsconfig projects checked by `npm run typecheck` and before anything is bundled. */
export const TYPECHECK_PROJECTS = [
  "packages/zotero/tsconfig.json",
  "packages/zotero/content/tsconfig.json",
  "shared/relay/tsconfig.json",
  "scripts/tsconfig.json",
  "tests/tsconfig.json",
  "tests/zotero/seed-plugin/tsconfig.json",
] as const;
export const TSC_ENTRY = "node_modules/typescript/bin/tsc";

export const ZOTERO_SOURCE_DIR = "packages/zotero";
/** Copied into the XPI root with the package version injected. */
export const ZOTERO_MANIFEST = "manifest.json";
/** Copied recursively, minus TypeScript sources and tsconfig files. */
export const ZOTERO_COPY_DIRS = ["content", "locale"] as const;

/**
 * The one global content/bridge.js publishes on the bootstrap sandbox it shares with bootstrap.js: src/main.ts
 * assigns `globalThis.ZoteroReadingBridgeMain`, bootstrap.ts calls it and deletes it on shutdown.
 */
export const MAIN_GLOBAL_NAME = "ZoteroReadingBridgeMain";

export interface BundleSpec {
  id: "bootstrap" | "main" | "preferences";
  /** Repo-relative entry point. */
  entry: string;
  /** Path inside the XPI. */
  out: string;
}

export const ZOTERO_BUNDLES: readonly BundleSpec[] = [
  { id: "bootstrap", entry: "packages/zotero/bootstrap.ts", out: "bootstrap.js" },
  { id: "main", entry: "packages/zotero/src/main.ts", out: "content/bridge.js" },
  { id: "preferences", entry: "packages/zotero/content/preferences.ts", out: "content/preferences.js" },
];

/** Lifecycle hooks Zotero's plugins.js looks up on the bootstrap sandbox (it warns when one is missing). */
export const REQUIRED_BOOTSTRAP_HOOKS = [
  "install",
  "startup",
  "shutdown",
  "uninstall",
  "onMainWindowLoad",
  "onMainWindowUnload",
] as const;
/** Methods bootstrap.js calls on the main bundle's global. */
export const REQUIRED_MAIN_METHODS = ["startup", "shutdown"] as const;

/**
 * Module whose `registerEndpoints` the build exercises from a check-only bundle (same esbuild options as
 * content/bridge.js), because the endpoint class it registers is private to the release bundle.
 */
export const ENDPOINT_MODULE = "packages/zotero/src/server/endpoint.ts";
/** Methods the endpoint class must accept itself (design decision 12), so Zotero never answers 400 for them. */
export const ENDPOINT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Files every XPI must contain at its root. */
export const XPI_REQUIRED_FILES = [
  "manifest.json",
  "bootstrap.js",
  "content/bridge.js",
  "content/preferences.js",
  "content/preferences.xhtml",
  "locale/en-US/zotero-reading-bridge.ftl",
  "locale/zh-CN/zotero-reading-bridge.ftl",
] as const;
export const XPI_LOCALES = ["en-US", "zh-CN"] as const;

export const OUTPUT_NAMES = {
  xpi: `${BRIDGE_NAME}.xpi`,
  codex: `${BRIDGE_NAME}-codex.zip`,
  claudeDesktop: `${BRIDGE_NAME}-claude-desktop.mcpb`,
  claudeSkill: "SKILL.md",
  source: "source.zip",
  buildInfo: "BUILD-INFO.json",
  updates: "updates.json",
} as const;

/**
 * The stdio <-> HTTP relay both desktop plugins ship: bundled once from TypeScript into one CommonJS file and added
 * to the Codex ZIP and the Claude Desktop MCPB at the same path.
 */
export const RELAY_ENTRY = "shared/relay/main.ts";
export const RELAY_OUT = "server/zotero-relay.js";
/** Oldest Node the relay bundle targets (MCPB compatibility.runtimes.node; Codex uses the system Node). */
export const RELAY_NODE_TARGET = "node18";

/** Every staged plugin: source directory, manifest inside it (shared metadata filled in), and archive name. */
export interface PluginSpec {
  id: "zotero" | "codex" | "claude-desktop";
  sourceDir: string;
  manifest: string;
  archive: string;
}

export const ZOTERO_PLUGIN: PluginSpec = { id: "zotero", sourceDir: ZOTERO_SOURCE_DIR, manifest: ZOTERO_MANIFEST, archive: OUTPUT_NAMES.xpi };
/** Codex plugin: the package directory as it is (its .mcp.json already launches the relay) plus derived portable copies. */
export const CODEX_PLUGIN: PluginSpec = { id: "codex", sourceDir: "packages/codex", manifest: ".codex-plugin/plugin.json", archive: OUTPUT_NAMES.codex };
/** Claude Desktop extension (.mcpb): manifest.json, README.md and the relay. */
export const DESKTOP_PLUGIN: PluginSpec = { id: "claude-desktop", sourceDir: "packages/claude-desktop", manifest: "manifest.json", archive: OUTPUT_NAMES.claudeDesktop };

export const CODEX_MCP_CONFIG = ".mcp.json";
/** agent-plugins.org copies derived from the Codex files at build time (the source tree has only Codex's own). */
export const CODEX_PORTABLE_MANIFEST = "plugin.json";
export const CODEX_PORTABLE_MCP_CONFIG = "mcp.json";

export const DESKTOP_REQUIRED_FILES = [DESKTOP_PLUGIN.manifest, RELAY_OUT, "README.md", "LICENSE"] as const;

/**
 * Claude Desktop skill (Settings -> Capabilities -> Skills -> Upload skill): an .mcpb cannot carry skills, so the
 * skill ships as a plain SKILL.md (includes expanded) in outputs/, uploaded as it is.
 */
export const CLAUDE_SKILL_SOURCE = "packages/claude-skill/zotero/SKILL.md";

export const SKILL_FILE = "skills/zotero/SKILL.md";
export const SKILL_NAME = "zotero";

export const STAGE_DIR = "work/stage";
export const OUTPUTS_DIR = "outputs";

/** Suffix of in-progress outputs; renamed into place only after they were written completely. */
export const PARTIAL_SUFFIX = ".partial";

/**
 * Always excluded from source.zip and staged trees, on top of the repo's .gitignore
 * (same subset syntax, see parseIgnorePatterns).
 */
export const BUILTIN_IGNORE_PATTERNS = ["node_modules/", ".git", "/work/", "/outputs/", "*.tsbuildinfo"] as const;

/** Fixed entry mtime (UTC) so identical inputs give byte-identical archives. */
export const ZIP_ENTRY_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

export function sourceArchivePrefix(version: string): string {
  return `${BRIDGE_NAME}-${version}/`;
}
