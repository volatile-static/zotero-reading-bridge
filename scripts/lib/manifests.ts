/**
 * Pure manifest transforms used while staging: package.json is the single source of truth for the
 * version, so staging overwrites `version` in the Zotero manifest, the client plugin manifests and any
 * marketplace entry that pins one. Sources may carry any value (normally the same version, which keeps
 * the unbuilt plugin folders loadable by `claude plugin validate` / `codex plugin marketplace add`).
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict SemVer core with optional pre-release/build, as Codex and Claude Code use it for cache dirs. */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function readPackageVersion(packageJsonText: string): string {
  const pkg: unknown = JSON.parse(packageJsonText);
  const version = isRecord(pkg) ? pkg["version"] : undefined;
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(`package.json "version" must be a SemVer string (got ${JSON.stringify(version)})`);
  }
  return version;
}

function parseObject(jsonText: string, file: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(jsonText.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(value)) throw new Error(`${file}: top-level value must be a JSON object`);
  return value;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface VersionInjection {
  text: string;
  /** The source's own `version` value, to report drift. */
  previous: unknown;
}

/** Set top-level `version` (key order is preserved; a missing key is appended). */
export function injectVersion(jsonText: string, version: string, file: string): VersionInjection {
  const manifest = parseObject(jsonText, file);
  const previous = manifest["version"];
  manifest["version"] = version;
  return { text: serialize(manifest), previous };
}

/** Update `plugins[].version` for entries named `pluginName` that already pin a version. */
export function injectMarketplaceVersion(jsonText: string, pluginName: string, version: string, file: string): string {
  const marketplace = parseObject(jsonText, file);
  const plugins = marketplace["plugins"];
  if (!Array.isArray(plugins)) return jsonText;
  let changed = false;
  for (const entry of plugins) {
    if (isRecord(entry) && entry["name"] === pluginName && "version" in entry && entry["version"] !== version) {
      entry["version"] = version;
      changed = true;
    }
  }
  return changed ? serialize(marketplace) : jsonText;
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
