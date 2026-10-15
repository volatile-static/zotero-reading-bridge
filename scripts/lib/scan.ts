/**
 * Content scanners for packaged files: credentials, machine-specific absolute paths, files that must
 * never ship, and constructs that cannot run in Zotero's subscript sandboxes.
 * Findings carry a rule id and a line number only, never the matched text, so reports cannot leak secrets.
 */

export interface ScanRule {
  id: string;
  re: RegExp;
}

export interface ScanFinding {
  file: string;
  line: number;
  rule: string;
}

/**
 * Credential shapes. Generic ones require a digit or a minimum length so prose such as
 * "Bearer tokens" or "sk-learn" does not trip them.
 */
export const SECRET_RULES: readonly ScanRule[] = [
  { id: "private-key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  { id: "anthropic-api-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  // sk-ant- keys belong to the rule above; one credential must yield one finding.
  { id: "sk-api-key", re: /\bsk-(?!ant-)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g },
  { id: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { id: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: "aws-access-key-id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "aws-secret-access-key", re: /aws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/gi },
  { id: "bearer-token", re: /\bBearer\s+(?=[A-Za-z0-9._~+/-]*\d)[A-Za-z0-9._~+/-]{12,}/g },
  { id: "basic-auth", re: /\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/]{8,}={0,2}/gi },
  {
    id: "json-credential-value",
    re: /"(?:token|access_token|refresh_token|id_token|api_key|apiKey|client_secret|password)"\s*:\s*"[^"\s]+"/g,
  },
  // Zotero Web API keys are 24 alphanumerics; catch them next to a zotero...key name in any quoting.
  { id: "zotero-api-key", re: /zotero[\w.-]*key["']?\s*[:=]\s*["']?[A-Za-z0-9]{24}(?![A-Za-z0-9])/gi },
  {
    // Any key/token/secret/password/auth name assigned a quoted literal of 8+ characters with a letter and a digit,
    // in JSON, TOML, YAML, env or code ("X-Api-Key": "...", bearer_token = "...", password: '...',
    // const apiSecret = "..."). Placeholders ("${VAR}", "<your key>", "%TOKEN%", "example", "changeme"...) and
    // digit-free identifiers such as pref names are documentation, not credentials.
    id: "credential-assignment",
    re: /["']?[\w.-]*(?:api[_-]?key|secret|passw(?:or)?d|token|auth)["']?\s*[:=]\s*["'](?![$<%{*]|[^"'\n]*(?:example|placeholder|your|xxx|changeme|dummy|redacted|fake))(?=[^"'\s]*\d)(?=[^"'\s]*[A-Za-z])[^"'\s]{8,}["']/gi,
  },
];

/**
 * User-profile paths. Placeholders such as `<user>`, `%USERNAME%`, `{user}`, `$USER` or `*` right after
 * the profile root are documentation, not leaks. The Unix rule ignores URL path segments ("host/home/") and
 * Windows drive-letter paths, which the Windows rule already reports.
 */
export const ABSOLUTE_PATH_RULES: readonly ScanRule[] = [
  { id: "windows-user-path", re: /[A-Za-z]:[\\/]+Users[\\/]+(?![<%{$*])[^\\/\s"'`<>|]+/gi },
  { id: "unix-home-path", re: /(?<![\w.~-]|[A-Za-z]:)\/(?:Users|home)\/(?![<%{$*])[^/\s"'`<>|]+/g },
];

/**
 * Rule for the build machine's own home directory in any separator spelling (native, JSON-escaped,
 * MSYS "/c/..."); the drive letter is dropped so every spelling matches.
 */
export function homeDirectoryRules(homeDir: string): ScanRule[] {
  const parts = homeDir.split(/[\\/]+/).filter((part) => part && !/^[A-Za-z]:$/.test(part));
  if (parts.length < 2) return [];
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return [{ id: "build-machine-home", re: new RegExp(`(?<![\\w-])${escaped.join("[\\\\/]+")}(?![\\w-])`, "gi") }];
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) line++;
  return line;
}

/**
 * Run `rules` over `data` decoded as latin1 (every rule is ASCII; binary files stay scannable). One credential
 * yields one finding: a match overlapping an earlier rule's match (rules are ordered specific to generic) is dropped.
 */
export function scanContent(file: string, data: Buffer | string, rules: readonly ScanRule[]): ScanFinding[] {
  const text = typeof data === "string" ? data : data.toString("latin1");
  const findings: Array<ScanFinding & { start: number; end: number }> = [];
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    for (const match of text.matchAll(rule.re)) {
      const start = match.index;
      const end = start + match[0].length;
      if (findings.some((f) => start < f.end && f.start < end)) continue;
      findings.push({ file, line: lineAt(text, start), rule: rule.id, start, end });
    }
  }
  return findings.map(({ file: f, line, rule }) => ({ file: f, line, rule }));
}

const FORBIDDEN_NAME_RES: readonly RegExp[] = [
  /^\.env(?:\..*)?$/,
  /^auth\.json$/,
  /^\.credentials\.json$/,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/,
  /\.(?:pem|key|p12|pfx)$/i,
];

/** Reason a file must not be packaged based on its name alone (credential stores), or null. */
export function forbiddenFileName(relPath: string): string | null {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  return FORBIDDEN_NAME_RES.some((re) => re.test(base)) ? `credential-like file name: ${relPath}` : null;
}

const BUNDLE_RULES: readonly { description: string; re: RegExp }[] = [
  { description: "require() call", re: /(?<![\w$.])require\s*\(/ },
  { description: "esbuild __require shim (a dependency uses require)", re: /\b__require\b/ },
  { description: "static import statement", re: /^[ \t]*import\s*(?:[\w$*{]|["'`])/m },
  { description: "import.meta", re: /(?<![\w$.])import\s*\.\s*meta\b/ },
  { description: "dynamic import()", re: /(?<![\w$.])import\s*\(/ },
  { description: "export statement", re: /^[ \t]*export\s+(?:default\b|[{*]|const\b|let\b|var\b|function\b|class\b|async\b)/m },
  { description: "node: module specifier", re: /["'`]node:[a-z_/]+["'`]/ },
  { description: "process.env access", re: /\bprocess\.env\b/ },
];

/**
 * Constructs that break when Zotero evaluates the bundle with loadSubScriptWithOptions (a classic
 * script in a sandbox: no module syntax, no CommonJS, no Node globals). Returns descriptions of violations.
 */
export function scanBundle(code: string): string[] {
  return BUNDLE_RULES.filter((rule) => rule.re.test(code)).map((rule) => rule.description);
}
