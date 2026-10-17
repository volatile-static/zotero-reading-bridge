/**
 * Pure manifest transforms used while staging. package.json is the single source of truth for the metadata every
 * plugin shares (name, version, author, license, keywords): the source manifests leave those fields out and staging
 * fills them in, so a release only ever bumps one file.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict SemVer core with optional pre-release/build, as Codex uses it for cache dirs. */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface PackageMetadata {
  name: string;
  version: string;
  author: string;
  license: string;
  keywords: string[];
}

export function readPackageMetadata(packageJsonText: string): PackageMetadata {
  const pkg = parseJsonObject(packageJsonText, "package.json");
  const text = (key: string): string => {
    const value = pkg[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`package.json "${key}" must be a non-empty string`);
    return value;
  };
  const version = text("version");
  if (!SEMVER_RE.test(version)) throw new Error(`package.json "version" must be a SemVer string (got ${JSON.stringify(version)})`);
  const keywords = pkg["keywords"];
  if (!Array.isArray(keywords) || !keywords.every((k): k is string => typeof k === "string")) {
    throw new Error(`package.json "keywords" must be an array of strings`);
  }
  return { name: text("name"), version, author: text("author"), license: text("license"), keywords };
}

export function parseJsonObject(jsonText: string, file: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(jsonText.replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(value)) throw new Error(`${file}: top-level value must be a JSON object`);
  return value;
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Which shared fields a manifest format takes, and how it spells the author. */
export type ManifestKind = "zotero" | "client";

/**
 * Fill the shared fields into a source manifest. The source must not set them itself: a value there would silently
 * disagree with package.json after the next release.
 *  - zotero (XPI manifest.json): version, author as a string; `name` stays the display name.
 *  - client (Codex plugin.json, MCPB manifest.json): name and version right after manifest_version, then the source
 *    fields, then author { name }, license, keywords.
 */
export function injectMetadata(jsonText: string, meta: PackageMetadata, kind: ManifestKind, file: string): Record<string, unknown> {
  const source = parseJsonObject(jsonText, file);
  const owned = kind === "zotero" ? ["version", "author"] : ["name", "version", "author", "license", "keywords"];
  const set = owned.filter((key) => key in source);
  if (set.length > 0) throw new Error(`${file}: ${set.join(", ")} must not be set (filled in from package.json)`);
  if (kind === "zotero") return { ...source, version: meta.version, author: meta.author };
  const { manifest_version: manifestVersion, ...rest } = source;
  return {
    ...(manifestVersion === undefined ? {} : { manifest_version: manifestVersion }),
    name: meta.name,
    version: meta.version,
    ...rest,
    author: { name: meta.author },
    license: meta.license,
    keywords: meta.keywords,
  };
}

export const PORTABLE_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const PORTABLE_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
/** Codex manifest fields that only exist in .codex-plugin/plugin.json; the portable copy nests them under extensions. */
const CODEX_ONLY_KEYS = ["skills", "mcpServers", "hooks", "interface", "requires_local_executor"] as const;

/**
 * The portable (agent-plugins.org) plugin.json shipped beside .codex-plugin/plugin.json: the shared fields as they are,
 * Codex's interface and local-executor flag under extensions["com.openai"], and no component paths (default locations).
 */
export function portableCodexManifest(codexManifest: Record<string, unknown>): Record<string, unknown> {
  const shared = Object.fromEntries(Object.entries(codexManifest).filter(([key]) => !(CODEX_ONLY_KEYS as readonly string[]).includes(key)));
  const openai: Record<string, unknown> = {};
  if ("interface" in codexManifest) openai["interface"] = codexManifest["interface"];
  if ("requires_local_executor" in codexManifest) openai["requires_local_executor"] = codexManifest["requires_local_executor"];
  return { $schema: PORTABLE_PLUGIN_SCHEMA, ...shared, extensions: { "com.openai": openai } };
}

/** The portable mcp.json shipped beside .mcp.json: the same servers with the schema declared. */
export function portableMcpConfig(mcpConfig: Record<string, unknown>): Record<string, unknown> {
  return { $schema: PORTABLE_MCP_SCHEMA, ...mcpConfig };
}
/** YAML double-quoted scalars share JSON's common escapes; anything JSON rejects is kept verbatim. */
function unquoteDouble(raw: string): string {
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw.slice(1, -1);
  }
}

/**
 * Minimal YAML front-matter reader for SKILL.md: top-level `key: value` pairs with plain, quoted or
 * block (`>` / `|`) scalars. Nested mappings are skipped. Returns null when there is no front matter.
 */
export function parseFrontmatter(markdown: string): Record<string, string> | null {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match) return null;
  const lines = (match[1] ?? "").split(/\r?\n/);
  const result: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const keyMatch = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/.exec(lines[i] ?? "");
    if (!keyMatch || keyMatch[1] === undefined) continue;
    const raw = (keyMatch[2] ?? "").trim();
    const block: string[] = [];
    while (i + 1 < lines.length && /^(?:[ \t]+\S|[ \t]*$)/.test(lines[i + 1] ?? "")) {
      block.push((lines[++i] ?? "").trim());
    }
    let value: string;
    if (/^[>|][+-]?$/.test(raw)) {
      value = block.filter(Boolean).join(raw.startsWith(">") ? " " : "\n");
    } else if (raw === "") {
      value = ""; // nested mapping or empty value
    } else if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      value = unquoteDouble(raw);
    } else if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
      value = raw.slice(1, -1).replace(/''/g, "'");
    } else {
      value = [raw, ...block.filter(Boolean)].join(" ");
    }
    result[keyMatch[1]] = value;
  }
  return result;
}
