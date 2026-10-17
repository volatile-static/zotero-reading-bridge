/**
 * esbuild configuration for the three Zotero-side classic scripts. Zotero evaluates them with
 * Services.scriptloader.loadSubScriptWithOptions (bootstrap.js into the plugin sandbox, content/bridge.js into
 * that same sandbox, preferences.js into the pane window), so every bundle is a self-contained IIFE with no
 * module syntax, no require() and no Node built-ins, and publishes what Zotero needs on globalThis itself.
 */
import * as esbuild from "esbuild";
import type { BundleSpec } from "./layout.js";
import { nodeRequireProblems, scanBundle } from "./scan.js";

function baseOptions(root: string, entry: string): esbuild.BuildOptions {
  return {
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    platform: "neutral",
    // Zotero 11 runs Firefox 153 ESR; no down-levelling helpers or polyfills (sandbox built-ins are frozen).
    target: "firefox140",
    // "neutral" has no default main fields/conditions; mirror bundler resolution for any ESM dependency.
    mainFields: ["module", "main"],
    conditions: ["module"],
    loader: { ".md": "text", ".json": "json" },
    charset: "utf8",
    legalComments: "inline",
    minify: false,
    sourcemap: false,
    write: false,
    metafile: true,
    logLevel: "silent",
  };
}

async function formatMessages(messages: esbuild.Message[], kind: "error" | "warning"): Promise<string> {
  const formatted = await esbuild.formatMessages(messages, { kind, color: false });
  return formatted.join("").trimEnd();
}

function isBuildFailure(error: unknown): error is esbuild.BuildFailure {
  return error instanceof Error && Array.isArray((error as Partial<esbuild.BuildFailure>).errors);
}

/** Warnings are fatal: e.g. an unresolvable Node built-in or a dropped import.meta would only fail inside Zotero. */
async function build(options: esbuild.BuildOptions, entry: string): Promise<esbuild.BuildResult> {
  let result: esbuild.BuildResult;
  try {
    result = await esbuild.build(options);
  } catch (error) {
    if (!isBuildFailure(error)) throw error;
    throw new Error(`esbuild failed for ${entry}:\n${await formatMessages(error.errors, "error")}`);
  }
  if (result.warnings.length > 0) {
    throw new Error(`esbuild reported warnings for ${entry} (treated as errors):\n${await formatMessages(result.warnings, "warning")}`);
  }
  return result;
}

function singleOutput(result: esbuild.BuildResult, entry: string): string {
  const output = result.outputFiles?.[0];
  if (!output || result.outputFiles?.length !== 1) throw new Error(`esbuild produced no single output for ${entry}`);
  return output.text;
}

/**
 * Bundle one release entry as a plain IIFE. An ESM probe build first reveals the entry's exports, which an
 * IIFE drops silently: entries must assign what Zotero needs to globalThis (a `globalName` var would not do,
 * since bootstrap.js deletes ZoteroReadingBridgeMain on shutdown and a top-level var cannot be deleted).
 */
export async function bundleClassicScript(root: string, spec: BundleSpec): Promise<string> {
  const base = baseOptions(root, spec.entry);
  const probe = await build({ ...base, format: "esm" }, spec.entry);
  const exported = Object.values(probe.metafile?.outputs ?? {}).flatMap((output) => output.exports);
  if (exported.length > 0) {
    throw new Error(
      `${spec.entry} has ESM exports (${exported.join(", ")}) that an IIFE bundle would drop; ` +
        "assign what Zotero must see to globalThis instead",
    );
  }
  const code = singleOutput(await build({ ...base, format: "iife" }, spec.entry), spec.entry);
  const violations = scanBundle(code);
  if (violations.length > 0) {
    throw new Error(`${spec.entry} bundle cannot run as a Zotero subscript: ${violations.join(", ")}`);
  }
  return code;
}

/**
 * Bundle a Node command-line program (the Claude Desktop relay) into one self-contained CommonJS file: CommonJS so that
 * `node <file>.js` runs it without a package.json beside it, Node built-ins only (anything else is an error, because the
 * .mcpb ships no node_modules). `version` replaces the `__RELAY_VERSION__` identifier.
 */
export async function bundleNodeScript(root: string, entry: string, target: string, version: string): Promise<string> {
  const code = singleOutput(
    await build(
      {
        absWorkingDir: root,
        entryPoints: [entry],
        bundle: true,
        platform: "node",
        format: "cjs",
        target,
        charset: "utf8",
        legalComments: "inline",
        minify: false,
        sourcemap: false,
        write: false,
        logLevel: "silent",
        define: { __RELAY_VERSION__: JSON.stringify(version) },
        // Resolving a bare package would mean shipping node_modules; make it an error instead of a silent external.
        plugins: [
          {
            name: "builtins-only",
            setup(pluginBuild) {
              pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
                if (args.kind === "entry-point") return undefined;
                return args.path.startsWith("node:")
                  ? { path: args.path, external: true }
                  : { errors: [{ text: `${args.path} is not a node: built-in; the relay must have no dependencies` }] };
              });
            },
          },
        ],
      },
      entry,
    ),
    entry,
  );
  const foreign = nodeRequireProblems(code);
  if (foreign.length > 0) throw new Error(`${entry} bundle: ${foreign.join(", ")}`);
  return code;
}

/**
 * Check-only bundle (never shipped): `entry` built with the release options, its exports exposed as
 * `var <globalName>`, so the build can exercise code the release bundle keeps private.
 */
export async function bundleForInspection(root: string, entry: string, globalName: string): Promise<string> {
  return singleOutput(await build({ ...baseOptions(root, entry), format: "iife", globalName }, entry), entry);
}
