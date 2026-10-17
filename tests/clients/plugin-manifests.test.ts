/**
 * Static checks of the client plugin sources (packages/codex, packages/claude-code, integrations/claude-science),
 * the manual-configuration examples and the acceptance checklist. Neither client validates hook server names or
 * hook input placeholders before runtime (`claude plugin validate` accepts a nonexistent server), and Codex rejects
 * unknown hook keys or unknown placeholders only when a prompt is submitted, so these invariants are pinned here.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import { endpointUrl } from "../../shared/types/bridge.js";
import { CLIENT_SERVER_NAMES, PLUGIN_NAME } from "../../shared/types/hook.js";
import { TOOL_NAMES } from "../../shared/types/tool-names.js";

const repoRoot = new URL("../../", import.meta.url);
const repoPath = (rel: string): URL => new URL(rel, repoRoot);
const readText = (rel: string): string => readFileSync(repoPath(rel), "utf8");
const readJson = (rel: string): Record<string, any> => {
  const value: unknown = JSON.parse(readText(rel));
  assert.ok(isObject(value), `${rel} must contain a JSON object`);
  return value;
};

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedKeys(value: unknown): string[] {
  assert.ok(isObject(value), "expected a JSON object");
  return Object.keys(value).sort();
}

const PACKAGE_VERSION: string = readJson("package.json").version;
const CANONICAL_URL = endpointUrl();
const HOOK_TOOL = "capture_prompt_context";
const STATUS_MESSAGE = "Reading Zotero context";
const PLACEHOLDER_RE = /\$\{([^{}]*)\}/g;
/** Event fields that must never leave the client through the hook: prompt text, working directory, transcript. */
const FORBIDDEN_PLACEHOLDERS = ["prompt", "cwd", "transcript_path"];

const captureSchema = (() => {
  const contract = readJson("shared/contracts/tools.json");
  const tool = (contract.tools as Array<Record<string, any>>).find((t) => t.name === HOOK_TOOL);
  assert.ok(tool, `${HOOK_TOOL} missing from shared/contracts/tools.json`);
  return tool.inputSchema as { properties: Record<string, { pattern?: string }>; required?: string[]; additionalProperties?: boolean };
})();

interface ClientSpec {
  label: string;
  root: string;
  manifest: string;
  mcpKey: string;
  hookServer: string;
  client: string;
  /** Placeholders the client's UserPromptSubmit event provides and the hook is allowed to send. */
  placeholders: readonly string[];
  /** Exact hook input keys. */
  inputKeys: readonly string[];
  mcpServerKeys: readonly string[];
}

const CLIENTS: readonly ClientSpec[] = [
  {
    label: "Codex",
    root: "packages/codex/",
    manifest: ".codex-plugin/plugin.json",
    mcpKey: CLIENT_SERVER_NAMES.codex,
    hookServer: CLIENT_SERVER_NAMES.codex,
    client: "codex",
    placeholders: ["session_id", "turn_id"],
    inputKeys: ["client", "session_id", "turn_id"],
    mcpServerKeys: ["startup_timeout_sec", "tool_timeout_sec", "type", "url"],
  },
  {
    label: "Claude Code",
    root: "packages/claude-code/",
    manifest: ".claude-plugin/plugin.json",
    mcpKey: CLIENT_SERVER_NAMES.claudeCode,
    hookServer: CLIENT_SERVER_NAMES.claudeCodeHookServer,
    client: "claude-code",
    placeholders: ["session_id", "prompt_id"],
    inputKeys: ["client", "prompt_id", "session_id"],
    mcpServerKeys: ["type", "url"],
  },
];

/** Assert that a parsed hooks file has exactly the shape both clients accept (Codex: deny_unknown_fields). */
function checkHooksFile(hooks: Record<string, any>, spec: ClientSpec, serverKey: string): void {
  assert.deepEqual(sortedKeys(hooks), ["description", "hooks"]);
  assert.equal(typeof hooks.description, "string");
  assert.deepEqual(sortedKeys(hooks.hooks), ["UserPromptSubmit"]);
  const groups = hooks.hooks.UserPromptSubmit;
  assert.ok(Array.isArray(groups) && groups.length === 1, "exactly one UserPromptSubmit group");
  assert.deepEqual(sortedKeys(groups[0]), ["hooks"], "no matcher on UserPromptSubmit");
  const handlers = groups[0].hooks;
  assert.ok(Array.isArray(handlers) && handlers.length === 1, "exactly one handler");
  const handler = handlers[0];
  assert.deepEqual(sortedKeys(handler), ["input", "server", "statusMessage", "timeout", "tool", "type"]);
  assert.equal(handler.type, "mcp_tool");
  assert.equal(handler.server, serverKey);
  assert.equal(handler.tool, HOOK_TOOL);
  assert.ok(Number.isInteger(handler.timeout) && handler.timeout === 5, "timeout must be the integer 5 (seconds)");
  assert.equal(handler.statusMessage, STATUS_MESSAGE);

  const input = handler.input;
  assert.deepEqual(sortedKeys(input), [...spec.inputKeys].sort());
  assert.equal(input.client, spec.client);
  for (const key of spec.placeholders) assert.equal(input[key], `\${${key}}`, `input.${key}`);

  // The input must satisfy the tool's own argument schema, or every hook call would come back isError.
  for (const key of Object.keys(input)) assert.ok(key in captureSchema.properties, `input.${key} not in schema`);
  for (const key of captureSchema.required ?? []) assert.ok(key in input, `required input.${key} missing`);
  assert.equal(captureSchema.additionalProperties, false);
  const clientPattern = captureSchema.properties.client?.pattern;
  assert.ok(clientPattern && new RegExp(clientPattern).test(input.client));
}

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? "");
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  assert.ok(match?.[1], "SKILL.md must start with YAML frontmatter");
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z][a-z0-9_-]*):\s*(.*)$/.exec(line);
    assert.ok(field?.[1] !== undefined && field[2] !== undefined, `unsupported frontmatter line: ${line}`);
    const raw = field[2].trim();
    fields[field[1]] = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
  }
  return fields;
}

function checkSkill(rel: string, expectedIncludes: readonly string[]): void {
  const md = readText(rel);
  const front = parseFrontmatter(md);
  assert.equal(front.name, "zotero");
  assert.ok(front.description && front.description.length >= 40 && front.description.length <= 1024);
  const includes = [...md.matchAll(/<!--\s*@include\s+(\S+)\s*-->/g)].map((m) => m[1]);
  assert.deepEqual(includes, [...expectedIncludes]);
  for (const inc of includes) assert.ok(inc && existsSync(repoPath(inc)), `include target missing: ${inc}`);
}

for (const spec of CLIENTS) {
  describe(`${spec.label} plugin (${spec.root})`, () => {
    const manifest = readJson(spec.root + spec.manifest);
    const mcp = readJson(`${spec.root}.mcp.json`);
    const hooksText = readText(`${spec.root}hooks/hooks.json`);
    const hooks = readJson(`${spec.root}hooks/hooks.json`);

    it("manifest names the plugin and matches the package version", () => {
      assert.equal(manifest.name, PLUGIN_NAME);
      assert.equal(manifest.version, PACKAGE_VERSION);
      assert.equal(manifest.license, "GPL-3.0-or-later");
      assert.ok(typeof manifest.description === "string" && manifest.description.length > 0);
    });

    it(".mcp.json declares exactly one HTTP server on the canonical loopback URL", () => {
      assert.deepEqual(sortedKeys(mcp), ["mcpServers"]);
      assert.deepEqual(sortedKeys(mcp.mcpServers), [spec.mcpKey]);
      const server = mcp.mcpServers[spec.mcpKey];
      assert.deepEqual(sortedKeys(server), [...spec.mcpServerKeys]);
      assert.equal(server.type, "http");
      assert.equal(server.url, CANONICAL_URL);
    });

    it("hooks.json has the exact mcp_tool hook shape and targets the plugin's own server", () => {
      checkHooksFile(hooks, spec, spec.hookServer);
    });

    it("hook placeholders are limited to the client's identifiers", () => {
      const used = placeholdersIn(hooksText);
      assert.deepEqual([...new Set(used)].sort(), [...spec.placeholders].sort());
      for (const name of FORBIDDEN_PLACEHOLDERS) assert.equal(used.includes(name), false, `\${${name}} must not be sent`);
    });

    it("skill has the zotero frontmatter and expands both shared instruction files", () => {
      checkSkill(`${spec.root}skills/zotero/SKILL.md`, [
        "shared/instructions/research-workflow.md",
        "shared/instructions/context-policy.md",
      ]);
    });

    it("ships a Chinese README", () => {
      assert.match(readText(`${spec.root}README.md`), /[一-鿿]/);
    });
  });
}

describe("Codex specifics", () => {
  const root = "packages/codex/";
  const manifest = readJson(`${root}.codex-plugin/plugin.json`);
  const server = readJson(`${root}.mcp.json`).mcpServers[CLIENT_SERVER_NAMES.codex];

  it("manifest paths are ./-relative and exist inside the plugin root", () => {
    assert.equal(manifest.skills, "./skills/");
    assert.equal(manifest.mcpServers, "./.mcp.json");
    assert.equal(manifest.hooks, "./hooks/hooks.json");
    for (const rel of [manifest.skills, manifest.mcpServers, manifest.hooks, manifest.interface.composerIcon, manifest.interface.logo]) {
      assert.ok(typeof rel === "string" && rel.startsWith("./") && !rel.includes(".."), `bad path ${rel}`);
      assert.ok(existsSync(repoPath(root + rel.slice(2))), `missing ${rel}`);
    }
    assert.ok(statSync(repoPath(`${root}skills`)).isDirectory());
  });

  it("interface stays read-only and within Codex limits", () => {
    const ui = manifest.interface;
    assert.equal(ui.category, "Productivity");
    assert.deepEqual(ui.capabilities, ["Read"]);
    assert.ok(Array.isArray(ui.defaultPrompt) && ui.defaultPrompt.length >= 1 && ui.defaultPrompt.length <= 3);
    for (const prompt of ui.defaultPrompt) assert.ok(typeof prompt === "string" && prompt.length > 0 && prompt.length <= 128);
    for (const key of ["displayName", "shortDescription", "longDescription", "developerName"]) {
      assert.ok(typeof ui[key] === "string" && ui[key].length > 0, `interface.${key}`);
    }
  });

  it("server keeps Codex defaults for approvals and uses integer-valued timeouts", () => {
    assert.equal(server.startup_timeout_sec, 10);
    assert.equal(server.tool_timeout_sec, 30);
    assert.equal("default_tools_approval_mode" in server, false);
  });

  it("bundled marketplace points at the plugin root itself", () => {
    const market = readJson(`${root}.agents/plugins/marketplace.json`);
    assert.equal(market.name, "zotero-reading-bridge-local");
    assert.equal(market.plugins.length, 1);
    const entry = market.plugins[0];
    assert.equal(entry.name, PLUGIN_NAME);
    assert.deepEqual(entry.source, { source: "local", path: "./" });
    assert.deepEqual(entry.policy, { installation: "AVAILABLE", authentication: "ON_INSTALL" });
    assert.equal(entry.category, "Productivity");
  });
});

describe("Claude Code specifics", () => {
  const root = "packages/claude-code/";
  const manifest = readJson(`${root}.claude-plugin/plugin.json`);

  it("manifest does not redeclare default component paths (they would merge with the defaults)", () => {
    for (const key of ["hooks", "mcpServers", "skills"]) assert.equal(key in manifest, false, key);
  });

  it("hook server is plugin:<plugin name>:<server key>", () => {
    assert.equal(CLIENT_SERVER_NAMES.claudeCodeHookServer, `plugin:${manifest.name}:${CLIENT_SERVER_NAMES.claudeCode}`);
  });

  it("bundled marketplace points at the plugin root itself", () => {
    const market = readJson(`${root}.claude-plugin/marketplace.json`);
    assert.equal(market.name, "zotero-reading-bridge-local");
    assert.ok(isObject(market.owner) && typeof market.owner.name === "string");
    assert.equal(market.plugins.length, 1);
    const entry = market.plugins[0];
    assert.equal(entry.name, PLUGIN_NAME);
    assert.equal(entry.source, "./");
    assert.equal(entry.version, PACKAGE_VERSION);
  });
});

describe("cross-client consistency", () => {
  it("both plugins use the same canonical endpoint and the hook tool exists", () => {
    const urls = CLIENTS.map((spec) => {
      const mcp = readJson(`${spec.root}.mcp.json`);
      return mcp.mcpServers[spec.mcpKey].url as string;
    });
    assert.deepEqual(urls, [CANONICAL_URL, CANONICAL_URL]);
    assert.ok((TOOL_NAMES as readonly string[]).includes(HOOK_TOOL));
  });

  it("plugin sources contain no absolute local paths", () => {
    for (const spec of CLIENTS) {
      for (const rel of [spec.manifest, ".mcp.json", "hooks/hooks.json", "skills/zotero/SKILL.md", "README.md"]) {
        assert.doesNotMatch(readText(spec.root + rel), /[A-Za-z]:[\\/]+Users[\\/]|\/home\/[a-z]|\/Users\/[A-Za-z]/, spec.root + rel);
      }
    }
  });
});

describe("Claude Science integration", () => {
  it("ships a no-hook skill that includes only the generic research workflow", () => {
    const rel = "integrations/claude-science/skills/zotero/SKILL.md";
    checkSkill(rel, ["shared/instructions/research-workflow.md"]);
    const md = readText(rel);
    assert.ok(md.includes("get_current_context"));
    assert.equal(placeholdersIn(md).length, 0);
    assert.match(readText("integrations/claude-science/README.md"), /未验证/);
  });
});

describe("Claude Desktop extension (packages/claude-desktop)", () => {
  const manifest = readJson("packages/claude-desktop/manifest.json");

  it("manifest matches the package version and launches the relay with only a port", () => {
    assert.equal(manifest.name, PLUGIN_NAME);
    assert.equal(manifest.version, PACKAGE_VERSION);
    assert.equal(manifest.server.type, "node");
    assert.equal(manifest.server.entry_point, "server/zotero-relay.js");
    assert.deepEqual(manifest.server.mcp_config, {
      command: "node",
      args: ["${__dirname}/server/zotero-relay.js", "--port", "${user_config.port}"],
    });
    assert.deepEqual(sortedKeys(manifest.user_config), ["port"]);
    assert.equal(manifest.user_config.port.default, 23119);
  });

  it("ships a Chinese README and no prebuilt relay (the build bundles src/)", () => {
    assert.match(readText("packages/claude-desktop/README.md"), /[一-鿿]/);
    assert.equal(existsSync(repoPath("packages/claude-desktop/server/zotero-relay.js")), false);
  });

  it("docs link the Claude Desktop guide and the acceptance checklist has its section", () => {
    assert.ok(readText("README.md").includes("docs/install-claude-desktop.md"));
    assert.match(readText("docs/acceptance.md"), /^## 17\. Claude 桌面应用/m);
    assert.match(readText("docs/architecture.md"), /^22\. \*\*Claude 桌面应用经 stdio 子进程中继接入/m);
  });
});

describe("acceptance checklist (docs/acceptance.md)", () => {
  const md = readText("docs/acceptance.md");
  /** Every acceptance area of the original plan, as the section headings name them. */
  const PLAN_AREAS = [
    "构建与类型检查",
    "协议",
    "本机访问边界",
    "数据",
    "附件",
    "生命周期",
    "安装（双端）",
    "端到端（双端）",
    "每轮刷新（双端）",
    "一致性（双端）",
    "失败继续（双端）",
    "输入最小化（双端）",
    "无 Hook 通用 MCP 客户端 / Claude Science",
    "无 Hook 工作流",
    "无 Hook PDF 阅读",
    "只读",
  ];
  const STATUSES = new Set([
    "未验证",
    "自动化测试覆盖（待集成后填写结果）",
    "已验证（临时配置）",
    "已验证（静态检查）",
    "未验证 / 静态分析判定不兼容",
    "通过",
    "失败",
  ]);
  // Checklist rows: | ID | item | status | client version | where | date | evidence |
  const rows = md
    .split(/\r?\n/)
    .filter((line) => /^\| [A-Z]-[A-Z0-9]+ \|/.test(line))
    .map((line) => line.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim()));

  it("has a section for every plan area", () => {
    const headings = [...md.matchAll(/^## \d+\. (.+)$/gm)].map((m) => m[1]);
    for (const area of PLAN_AREAS) assert.ok(headings.includes(area), `missing section: ${area}`);
  });

  it("rows have unique ids, the five record columns and a known status", () => {
    assert.ok(rows.length >= PLAN_AREAS.length);
    const ids = rows.map((cells) => cells[0]);
    assert.equal(new Set(ids).size, ids.length, "duplicate row id");
    for (const cells of rows) {
      assert.equal(cells.length, 7, `row ${cells[0]} must have 7 cells`);
      assert.ok(STATUSES.has(cells[2] ?? ""), `row ${cells[0]}: unknown status ${cells[2]}`);
    }
  });

  it("every row marked as verified records version, place, date and evidence", () => {
    for (const cells of rows.filter((c) => c[2]?.startsWith("已验证") || c[2] === "通过" || c[2] === "失败")) {
      for (const [index, name] of [[3, "客户端版本"], [4, "执行位置"], [5, "日期"], [6, "证据"]] as const) {
        assert.ok(cells[index], `row ${cells[0]}: ${name} is empty`);
      }
      assert.match(cells[5] ?? "", /^\d{4}-\d{2}-\d{2}$/, `row ${cells[0]}: date must be YYYY-MM-DD`);
    }
  });

  it("manual client scripts exist for both hook clients and the no-hook path", () => {
    for (const dir of ["codex", "claude-code", "generic-no-hook"]) {
      const text = readText(`tests/clients/${dir}/README.md`);
      assert.match(text, /[一-鿿]/, `${dir} README must be Chinese`);
      assert.ok(text.includes("docs/acceptance.md"), `${dir} README must point to the checklist`);
    }
  });
});
