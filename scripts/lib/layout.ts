/**
 * Repository layout and output names shared by the build and the package verifier.
 * Every path is repo-relative with forward slashes so the same constants work on Windows and POSIX.
 */
import { BRIDGE_NAME } from "../../shared/types/bridge.js";

export const PACKAGE_JSON = "package.json";
export const GITIGNORE = ".gitignore";

/** tsconfig projects checked before anything is bundled (same set as `npm run typecheck`). */
export const TYPECHECK_PROJECTS = [
  "packages/zotero/tsconfig.json",
  "packages/zotero/content/tsconfig.json",
  "scripts/tsconfig.json",
  "tests/tsconfig.json",
  "tests/zotero/seed-plugin/tsconfig.json",
  "packages/claude-desktop/tsconfig.json",
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
  codex: `${BRIDGE_NAME}-desktop.zip`,
  claudeDesktop: `${BRIDGE_NAME}-claude-desktop.mcpb`,
  scienceDir: "claude-science-zotero-skill",
  source: "source.zip",
  buildInfo: "BUILD-INFO.json",
} as const;

export interface ClientPackageSpec {
  id: "codex" | "claude-code";
  sourceDir: string;
  /** Plugin manifest inside the plugin root; its `version` is replaced by package.json's. */
  manifest: string;
  archive: string;
}

export const CLIENT_PACKAGES: readonly ClientPackageSpec[] = [
  { id: "codex", sourceDir: "packages/codex", manifest: ".codex-plugin/plugin.json", archive: OUTPUT_NAMES.codex },
];

/** Marketplace manifests whose plugin entries may carry a `version` that must match the plugin's. */
export const MARKETPLACE_MANIFESTS = [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"] as const;

/**
 * Claude Desktop extension (.mcpb): manifest.json with the version injected, the relay bundled from TypeScript into one
 * CommonJS file, and the remaining non-TypeScript files (README.md) copied as they are.
 */
export const DESKTOP_SOURCE_DIR = "packages/claude-desktop";
export const DESKTOP_MANIFEST = "manifest.json";
export const DESKTOP_RELAY_ENTRY = "packages/claude-desktop/src/main.ts";
/** Path of the bundled relay inside the .mcpb (manifest server.entry_point). */
export const DESKTOP_RELAY_OUT = "server/zotero-relay.js";
export const DESKTOP_REQUIRED_FILES = [DESKTOP_MANIFEST, DESKTOP_RELAY_OUT, "README.md", "LICENSE"] as const;
/** Oldest Node the relay bundle targets (manifest compatibility.runtimes.node). */
export const DESKTOP_NODE_TARGET = "node18";

export const SCIENCE_SOURCE_DIR = "integrations/claude-science";
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
