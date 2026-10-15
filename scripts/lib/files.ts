/**
 * File-tree helpers for the build: ignore rules (a strict .gitignore subset), deterministic walking
 * that keeps dotfiles, and path guards for the directories the build is allowed to delete.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_IGNORE_PATTERNS, GITIGNORE } from "./layout.js";

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Code-unit order: stable across platforms and locales (unlike localeCompare). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface IgnoreRule {
  pattern: string;
  /** Trailing "/": matches directories only. */
  dirOnly: boolean;
  /** Contains a non-trailing "/": matched against the whole repo-relative path, else against the basename. */
  anchored: boolean;
  regex: RegExp;
}

const UNSUPPORTED_IGNORE_SYNTAX = /^!|\*\*|[[\]\\]/;

function globToRegex(glob: string): RegExp {
  let source = "";
  for (const ch of glob) {
    if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += "[^/]";
    else source += ch.replace(/[.+^${}()|]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/**
 * Parse .gitignore-style patterns. Only the forms this repo uses are accepted (plain names, "*" and "?"
 * globs, trailing "/" for directories, a leading or inner "/" for root-anchored paths); negation, "**",
 * character classes and escapes throw, so a future .gitignore edit cannot silently change what ships.
 */
export function parseIgnorePatterns(text: string, source: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (UNSUPPORTED_IGNORE_SYNTAX.test(line)) {
      throw new Error(`${source}:${index + 1}: unsupported ignore syntax "${line}"`);
    }
    const dirOnly = line.endsWith("/");
    let body = dirOnly ? line.slice(0, -1) : line;
    const anchored = body.includes("/");
    if (body.startsWith("/")) body = body.slice(1);
    if (!body) throw new Error(`${source}:${index + 1}: empty ignore pattern "${line}"`);
    rules.push({ pattern: line, dirOnly, anchored, regex: globToRegex(body) });
  }
  return rules;
}

/** Built-in packaging excludes plus the repository's .gitignore (when present). */
export function loadPackagingIgnoreRules(root: string): IgnoreRule[] {
  const rules = parseIgnorePatterns(BUILTIN_IGNORE_PATTERNS.join("\n"), "built-in excludes");
  const gitignore = path.join(root, GITIGNORE);
  if (fs.existsSync(gitignore)) rules.push(...parseIgnorePatterns(fs.readFileSync(gitignore, "utf8"), GITIGNORE));
  return rules;
}

/** `relPath` is repo-relative with forward slashes. Ancestors are not consulted: walkFiles prunes ignored dirs. */
export function isIgnored(relPath: string, isDir: boolean, rules: readonly IgnoreRule[]): boolean {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  return rules.some((rule) => (!rule.dirOnly || isDir) && rule.regex.test(rule.anchored ? relPath : base));
}

/** Whether a file path or any of its ancestor directories is ignored. */
export function isPathIgnored(relPath: string, rules: readonly IgnoreRule[]): boolean {
  const segments = relPath.split("/");
  for (let i = 1; i < segments.length; i++) {
    if (isIgnored(segments.slice(0, i).join("/"), true, rules)) return true;
  }
  return isIgnored(relPath, false, rules);
}

/**
 * List regular files under `root/startRel` (dotfiles included), returned as root-relative POSIX paths in
 * code-unit order. Symlinks (including Windows junctions, which Node reports as links) and special files throw:
 * packaging must never follow links out of the tree. An ignored link is skipped like any ignored entry, since it
 * is never packaged (e.g. node_modules or work/ as a junction to another drive, .env linked to a shared file);
 * a link is not followed to learn whether it is a directory, so it is skipped when a file or a directory rule
 * matches its name.
 */
export function walkFiles(root: string, startRel: string, rules: readonly IgnoreRule[]): string[] {
  const files: string[] = [];
  const visit = (rel: string): void => {
    const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        if (isIgnored(childRel, true, rules) || isIgnored(childRel, false, rules)) continue;
        throw new Error(`refusing to package symbolic link: ${childRel}`);
      }
      if (entry.isDirectory()) {
        if (!isIgnored(childRel, true, rules)) visit(childRel);
      } else if (entry.isFile()) {
        if (!isIgnored(childRel, false, rules)) files.push(childRel);
      } else {
        throw new Error(`refusing to package special file: ${childRel}`);
      }
    }
  };
  visit(toPosix(startRel).replace(/\/+$/, ""));
  return files.sort(compareStrings);
}

/** Strip `prefix/` from root-relative paths produced by walkFiles. */
export function relativeTo(prefix: string, relPath: string): string {
  if (!prefix) return relPath;
  if (!relPath.startsWith(`${prefix}/`)) throw new Error(`${relPath} is not inside ${prefix}`);
  return relPath.slice(prefix.length + 1);
}

/**
 * Absolute path of `rel` under `root`, refusing anything that is the root itself or escapes it.
 * Used for every directory the build deletes.
 */
export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const fromRoot = path.relative(path.resolve(root), abs);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new Error(`path ${rel} must stay strictly inside ${root}`);
  }
  return abs;
}

export function removeTree(abs: string): void {
  fs.rmSync(abs, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function writeFileEnsured(abs: string, data: Buffer | string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
}
