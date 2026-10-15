# 验收记录

本页逐项列出原计划的全部验收项，并记录每一项的执行结果。手动步骤见：

- Codex：[tests/clients/codex/README.md](../tests/clients/codex/README.md)
- Claude Code：[tests/clients/claude-code/README.md](../tests/clients/claude-code/README.md)
- 无 Hook 客户端 / Claude Science：[tests/clients/generic-no-hook/README.md](../tests/clients/generic-no-hook/README.md)

## 状态取值

| 状态 | 含义 |
|---|---|
| `未验证` | 还没有人执行过。 |
| `自动化测试覆盖（待集成后填写结果）` | 由仓库中的自动化测试或脚本检查（命令写在“检查项”中）。集成时运行命令，把状态改为 `通过` / `失败`，并在“证据”中写明命令、通过数量和日期。 |
| `已验证（临时配置）` | 用真实客户端程序执行过，但 `HOME`、`USERPROFILE`、`CODEX_HOME`、`CLAUDE_CONFIG_DIR` 全部指向临时目录，只证明客户端能识别插件结构，不代表真实环境中的完整流程。 |
| `已验证（静态检查）` | 通过阅读程序、校验器或代码扫描确认，没有运行完整功能。 |
| `未验证 / 静态分析判定不兼容` | 只用于 Claude Science：静态分析认为当前版本无法连接，尚未做真实连接。 |
| `通过` / `失败` | 真实执行后的结论。失败时在“证据”中写明现象，并在 issue 或 [troubleshooting.md](troubleshooting.md) 中补充。 |

填写规则：

- **客户端版本**：`codex --version`、Codex 桌面版“关于”页、`claude --version`、Claude Science 版本；Zotero 版本见「帮助 → 关于 Zotero」；不涉及客户端时写 Node 与 Zotero 版本。
- **执行位置**：操作系统 + 机器（例如“Windows 11，开发机”“Windows 11，干净虚拟机”），以及是否为临时配置 / 独立测试配置文件。
- **证据**：命令与输出摘要、测试报告文件（如 `work/zotero-test/report.json`）、截图文件名或日志片段。**不要**粘贴文献库内容、令牌或含用户名的本机绝对路径。

## 0. 环境

| 项目 | 值 |
|---|---|
| 被测提交 / 构建（`outputs/BUILD-INFO.json`） | 0.1.0，2026-10-15 构建（移除插件自有的启用开关与 `prefs.js` 之后）。`zotero-ai-bridge.xpi` sha256 `d2c2af6f…e334`，T1、T2 使用这个 XPI；T0 使用更早的 XPI `a17bb462…d840`（修复评审问题之前，仍带启用开关） |
| Zotero 集成测试运行 | T0：手动客户端探测（PowerShell、Claude Code、Codex 连接独立测试实例，见 G-2、G-3、M-2），运行 20261015-103117-8c0161，证据为 `work/zotero-test/20261015-103117-8c0161/logs/zotero-stdout.log`（手动运行，没有 report.json；修复前的 XPI）。T1：`npm run test:zotero`，运行 20261015-125642-ad25b2：74 通过 / 0 失败 / 1 跳过（跳过的是 `harness.debug-log-privacy`，它只在 `--debug-output` 时执行）。T2：`npm run test:zotero -- --debug-output`，运行 20261015-125804-611a4d：75 通过 / 0 失败 / 0 跳过。报告：`work/zotero-test/<运行>/report.json` |
| Zotero 版本 | 11.0-beta.1+b0db83d9d（Gecko 153.3.0），独立测试实例 |
| 操作系统 | Windows 11 Pro |
| Node.js 版本 | 24.15.0 |
| Codex CLI / 桌面版版本 | codex-cli 0.162.0-alpha.17.2（仅临时配置验证） |
| Claude Code 版本 | 2.1.295（仅临时配置验证） |
| Claude Science 版本 | 0.1.62（仅静态分析） |

## 1. 构建与类型检查

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| B-1 | `npm run typecheck`：五个 tsconfig（Zotero 插件、设置页面、脚本、测试、测试用种子插件）均无错误 | 通过 | Node.js 24.15.0，TypeScript 6.0.3 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `npm run typecheck` 退出码 0；`npm run build` 的类型检查步骤对同样五个项目也全部通过。 |
| B-2 | `npm test`：单元测试（`tests/unit`）、协议测试（`tests/protocol`）、客户端清单检查（`tests/clients`）与集成测试工具自检（`tests/zotero/*.test.ts`）全部通过 | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `npm test`：522 通过 / 0 失败（116 个测试组，0 跳过）。 |
| B-3 | `node --import tsx --test tests/clients/plugin-manifests.test.ts`：客户端插件清单、Hook 结构、示例配置的静态检查全部通过 | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | 28 通过 / 0 失败（也包含在 `npm test` 中）。 |
| B-4 | `npm run build`：生成 `zotero-ai-bridge.xpi`、`zotero-ai-bridge-codex.zip`、`zotero-ai-bridge-claude-code.zip`、`claude-science-zotero-skill/`、`source.zip`；任何一步失败时不留下看似成功的产物，退出码非 0 | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `npm run build` 退出码 0，输出 6 项（XPI 8 个条目、Codex 包 7 个、Claude Code 包 6 个、技能目录 2 个文件、`source.zip`、`BUILD-INFO.json`）。失败注入（在路径含空格和中文的仓库副本中）：写出 XPI 与 Codex 包之后抛错、找不到 TypeScript、include 目标缺失，三种情况结束后 `outputs/` 都不存在。 |
| B-5 | `npm run verify`：产物结构、XPI 清单字段、引用资源存在、无未展开的 include 标记、敏感信息与本机绝对路径扫描、`source.zip` 不含 `node_modules` / `work` / `outputs` / `.git` | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `npm run verify`：32 通过 / 0 失败，退出码 0。敏感信息扫描另含 `Authorization: Basic`、Zotero Web API 密钥形状和通用的“key / token / secret / password = 引号字面值”规则；仓库根目录的 `.mcp.json` 与 `*.local.*` 文件不进入 `source.zip`。 |
| B-6 | `claude plugin validate --strict --json` 校验 Claude Code 插件目录（`marketplace.json` 的 `"source": "./"` 与插件内 `.mcp.json`、`hooks/hooks.json`、技能） | 已验证（静态检查） | Claude Code 2.1.295 | Windows 11，开发机，仓库源码目录（只读） | 2026-10-15 | 目录、`plugin.json`、`marketplace.json` 三种目标均 `success: true`，无错误、无警告。反例：把 Hook 类型改成未知值、把服务器类型改成未知值的副本分别报警告 / 错误并失败，说明组件文件确实被检查；把 Hook `server` 改成不存在的名字并加入未知占位符和未知字段的副本仍然通过，所以这些由 B-3 检查。 |

## 2. 协议

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| P-1 | `initialize`：2025-11-25、2025-06-18、2025-03-26 原样回应；不支持的版本回应 2025-11-25；`serverInfo`、`capabilities.tools`、`instructions` ≤ 4000 字符（`tests/protocol/mcp-handler.test.ts`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/protocol/mcp-handler.test.ts`，`npm test`：522 通过 / 0 失败。 |
| P-2 | 官方 `@modelcontextprotocol/sdk` 客户端以 2025-11-25 与 2025-06-18 在 `/bridge/mcp`、`/codex/mcp` 上完成 initialize / tools/list / tools/call / ping（`tests/protocol/sdk-client.test.ts`） | 通过 | Node.js 24.15.0，@modelcontextprotocol/sdk 1.32.1 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/protocol/sdk-client.test.ts` 38 通过 / 0 失败。 |
| P-3 | `server/discover` 探测 → HTTP 400 + `-32601` 并回显 id；带不支持的 `MCP-Protocol-Version` 头的非 initialize 请求 → 400 + `-32600` | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/protocol/mcp-handler.test.ts`、`tests/protocol/zotero-quirks.test.ts`；真实 Zotero 上同样通过（P-9）。 |
| P-4 | 只含通知 / 响应的请求体 → 202 空响应；GET / DELETE / PUT / PATCH → 405 + `Allow: POST`；从不发送 `Mcp-Session-Id`；不使用 SSE | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/protocol/*`（114 通过 / 0 失败）；真实 Zotero 上同样通过（P-9）。 |
| P-5 | 批量请求只在有效版本 2025-03-26 时接受，`initialize` 不能批量 | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/protocol/mcp-handler.test.ts`；真实 Zotero 上用例 protocol.batches 通过。 |
| P-6 | 错误位置：未知工具 `-32602`；参数不合法 → `isError` + `INVALID_ARGUMENT`；处理函数抛异常 → `isError` + `INTERNAL`；Accept 不含 JSON（或覆盖 JSON 的最具体范围为 `q=0`）→ 406；`params` 不是对象 → `-32602`；Content-Type 不是 JSON → 415；任何情况都不返回 5xx | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/protocol/*`；真实 Zotero 上用例 protocol.tool-call-errors、protocol.accept-and-content-type、protocol.malformed-bodies 通过。 |
| P-7 | 响应：小写 `application/json`、`Content-Length` 等于字节长度（含中文内容）、`Connection: close`、外层 JSON 非 ASCII 全部转义（`tests/unit/response.test.ts`、`tests/protocol/zotero-quirks.test.ts`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/unit/response.test.ts` 8 通过、`tests/protocol/zotero-quirks.test.ts`；真实 Zotero 上 tools.pagination 校验了转义后正文的 Content-Length。 |
| P-8 | `tools/list` 返回 18 个工具，名称与 `shared/types/tool-names.ts` 一致，没有 `outputSchema`（`tests/unit/contract.test.ts`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/unit/contract.test.ts` 111 通过；真实 Zotero 上用例 protocol.tools-list 通过。 |
| P-9 | 真实 Zotero 服务器上的协议用例：两个版本的 initialize、探测、通知 202、GET 405、两条路径结果一致、补齐的状态短语（`npm run test:zotero`） | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 protocol.*（共 19 个，含 protocol.bookmarklet-origin）全部通过，包括 202 / 405 / 406 / 415 状态短语与 HTTP/1.0 请求行。 |
| P-10 | 不带 `Authorization` 即可完成初始化与查询（原计划：无认证，不要求 Authorization） | 通过 | Node.js 24.15.0，@modelcontextprotocol/sdk 1.32.1；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero）；Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/protocol/sdk-client.test.ts` 用例“needs no Authorization”：四组 SDK 会话中所有请求都没有 `Authorization` 头，initialize、tools/list、tools/call 均成功；集成测试的原始 HTTP 客户端（`tests/zotero/lib/http.ts` 的默认请求头）从不发送 `Authorization`，运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`） 中全部协议与工具用例照常通过。 |

## 3. 本机访问边界

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| L-1 | 独立测试实例：Zotero 的 HTTP 服务器在测试端口 23139 上只监听 `127.0.0.1`，没有 `0.0.0.0` 或 IPv6 监听（`npm run test:zotero` 用例 harness.instance，用 Get-NetTCPConnection 列出该端口的全部监听地址） | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 harness.instance：监听地址只有 127.0.0.1:23139（无 0.0.0.0、无 IPv6）。默认端口 23119 上的检查见 L-1A。 |
| L-1A | 真实安装：Zotero 运行时 `netstat -ano \| findstr :23119` 只显示 `TCP 127.0.0.1:23119 ... LISTENING`，没有 `0.0.0.0` 或 `[::]` | 未验证 | | | | 需要在用户自己的 Zotero（默认端口 23119）上执行；集成测试从不连接 23119。 |
| L-2 | `get_status` 报告 `loopbackVerified: true`、`status: "running"`（`npm run test:zotero`） | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.get_status 断言 status "running"、loopbackVerified true。 |
| L-3 | 带 `Origin` 头（包括 `null`）的请求：真实 Zotero 直接断开连接；能到达插件的请求一律 403；插件的响应从不含 CORS 头（Zotero 只对 `https://www.zotero.org` 附加它自己的 CORS 头，见 L-10）（`tests/unit/access.test.ts`、`tests/protocol/zotero-quirks.test.ts`、`npm run test:zotero`） | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/access.test.ts`、`tests/protocol/zotero-quirks.test.ts`；`npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 protocol.browser-requests-refused：带 Origin（含 null）的请求每次都被 Zotero 直接断开。 |
| L-4 | User-Agent 以 `Mozilla/` 开头的请求被 Zotero 直接断开 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 protocol.browser-requests-refused：Mozilla/ User-Agent 的请求被 Zotero 直接断开。 |
| L-5 | Host 不对：HTTP/1.1 请求中外部主机名或端口不符 → Gecko 的 httpd 返回 400（正文 `Bad request`，到不了 Zotero 与插件）；HTTP/1.0 请求中外部主机名 → Zotero 返回 400 `Invalid Host header`，端口不符 → 插件返回 403；两条路径相同 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 protocol.host-check 在 `/bridge/mcp` 与 `/codex/mcp` 上分别得到：外部 Host（HTTP/1.1）400 `Bad request`、端口不符（HTTP/1.1）400、外部 Host（HTTP/1.0）400 `Invalid Host header`、端口不符（HTTP/1.0）插件 403；`[::1]` 由 httpd 返回 400。 |
| L-6 | 从局域网中另一台电脑访问 `http://<本机局域网 IP>:23119/bridge/mcp` 无法连接 | 未验证 | | | | |
| L-7 | 在普通浏览器网页中用 `fetch` 调用端点失败（被 Zotero 断开，页面读不到任何数据） | 未验证 | | | | |
| L-8 | 非回环监听配置被拒绝：Zotero 的服务器启动代码改用 `start_dualStack` / `start_ipv6` / `0.0.0.0`，或 httpd 的 `start()` 不再绑定 `"localhost"` 时，回环验证失败；验证失败时状态为 `loopback-unverified`，端点不注册（`tests/unit/loopback.test.ts`、`tests/unit/client-config.test.ts`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/unit/loopback.test.ts` 4 通过（Zotero 11 实际源码样本通过；dual-stack、IPv6、0.0.0.0、不再调用 `start()`、httpd 不绑定 localhost 均判定失败）；`tests/unit/client-config.test.ts` 14 通过（`loopbackVerified: false` 时状态为 `loopback-unverified`，只有 `running` 才注册端点）。验证规则已拆成纯函数 `src/server/loopback.ts`；在真实 Zotero 中触发失败路径需要改动 Zotero 自身代码，未做。验证成功的路径见 L-2。 |
| L-9 | 两条路径同一访问规则：`/bridge/mcp` 与 `/codex/mcp` 对 Origin、浏览器 User-Agent 与 Host 的处理完全相同 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 protocol.browser-requests-refused、protocol.host-check、protocol.bookmarklet-origin 都在两条路径上各执行一遍，结果一致。 |
| L-10 | Zotero 不会断开的带 Origin 请求（带 `X-Zotero-Connector-API-Version` 或 `Zotero-Allowed-Request` 头，包括 Zotero 放行 CORS 的 `https://www.zotero.org`）到达插件后一律 403，读不到任何数据 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 protocol.bookmarklet-origin：三种请求（zotero.org + connector 头、外部来源 + Zotero-Allowed-Request、浏览器 User-Agent + zotero.org + connector 头）调用 `get_status`，两条路径上都是 403 + `-32000`、没有 result；zotero.org 来源的响应带 Zotero 自己的 `Access-Control-Allow-Origin`。记录：Zotero 对该来源的 OPTIONS 预检返回 200，允许 `Content-Type,X-Zotero-Connector-API-Version,X-Zotero-Version`。 |
| L-11 | 未知工具与写入类工具不可调用：`tools/list` 只有 18 个只读工具；未知工具名（如 `delete_everything`）返回 `-32602` | 通过 | Node.js 24.15.0，@modelcontextprotocol/sdk 1.32.1；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero）；Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/protocol/mcp-handler.test.ts` 与 `tests/protocol/sdk-client.test.ts`（未知工具 `-32602`）、`tests/unit/contract.test.ts` 111 通过（全部只读注解）；运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`） 中用例 protocol.tools-list（18 个只读工具）、protocol.tool-call-errors（未知工具 `-32602`）。 |
| L-12 | 服务端不依赖客户端名称：任意 MCP 客户端名（SDK 的 `sdk-test`、集成测试的 `zab-harness`）都能使用全部工具；`client` 只用于快照标识与 Hook 预算 | 通过 | Node.js 24.15.0，@modelcontextprotocol/sdk 1.32.1；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero）；Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/protocol/sdk-client.test.ts` 38 通过；运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）：集成测试以 `zab-harness` 身份完成全部用例；`tests/unit/snapshot.test.ts` 中 `other-client` 的快照 id。 |

## 4. 数据

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| D-1 | `list_libraries`：个人文献库（及可用时的群组文献库），不含订阅源 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.list_libraries、tools.group_library。 |
| D-2 | `list_collections`（嵌套、`recursive`、条目数）与 `get_collection`（含条目分页） | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.list_collections、tools.get_collection（含超过 200 个条目的分页）。 |
| D-3 | `list_saved_searches` / `run_saved_search` | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.saved_searches。 |
| D-4 | `search_items`：四种 `mode`、标签 / 作者 / 条目类型 / 集合过滤、中文检索、子条目命中归并到父条目、排序、缺少检索条件时报 `INVALID_ARGUMENT` | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.search_items（中文检索、作者 / 标签 / 类型 / 集合过滤、四种 mode、子条目归并、错误路径）。 |
| D-5 | 分页：超过 200 个条目时 `nextCursor` 连续翻页结果完整、不重复 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.pagination：230 个条目分为 200 + 30，无重复、按标题排序。 |
| D-6 | `get_items`：最多 50 个 key；按 key 获取已删除条目时带 `deleted: true`；列表与检索不含回收站内容 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.get_items（deleted 标记、notFound）、tools.get_collection 与 tools.saved_searches（不含回收站）。 |
| D-7 | `get_item_children`、`list_tags` | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.get_item_children、tools.list_tags。 |
| D-8 | `get_notes`：HTML 与纯文本，超长截断并标记 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.get_notes（HTML 与纯文本、截断、类型错误）。 |
| D-9 | `get_annotations`：类型过滤、页码标签、位置、`zotero://open-pdf` 链接、中文批注 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.get_annotations（六种类型、阅读顺序、中文、位置、链接、过滤）。 |
| D-10 | `get_schema`、`get_status` | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.get_schema、tools.get_status。 |
| D-11 | 在真实的大型文献库上，Zotero 启动完成后首次 `search_items` 与 `get_items` 在客户端超时（30 秒）内返回 | 未验证 | | | | |
| D-12 | 列表摘要按基础字段映射：会议论文的 `proceedingsTitle` 作为 `publicationTitle`（书籍章节、网页、判例等同理）；两位作者的 `creatorSummary` 不含不可见的双向隔离符，复制其中的姓名可直接用作 `creator` 过滤 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.search_items 与 tools.get_items：会议论文夹具的 `publicationTitle` 为“会议论文集 Proceedings”、`year` 2021；“张 and 李”不含 U+2068 / U+2069，用“张”作为 `creator` 能找回该条目。 |
| D-13 | `get_collection`、`list_collections` 与 `search_items(collectionKey)` 一致地遵循 Zotero 的“显示子集合中的条目”：关闭时只含直接条目，开启时含所有子集合中的条目，`itemCount` 与条目列表一致，结果中 `includesSubcollections` 说明当前设置；子集合最多列出 50 个并标记截断 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.subcollection-items：根集合直接条目 3 个，开启选项后 5 个（含子集合与孙集合中的条目），三个工具结果一致；用例 tools.get_collection：`subcollectionsTruncated` false。 |
| D-14 | `fulltext` 模式（以及 `everything` 模式中加引号的词）遇到全文索引无法回答的词（3 个字母以下、单个汉字、中英文 / 数字混合）时返回 `INVALID_ARGUMENT` 并逐个说明原因，不悄悄忽略、不触发逐文件扫描 | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero）；Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/data-search-plan.test.ts`；运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 tools.search_items：`AI ethics`（fulltext）列出 `AI`，`"AI模型"`（fulltext）说明中英文混合，`深度 "AI模型"`（everything）报错，不加引号的 `AI模型`（everything）正常检索。 |
| D-15 | 翻页结果与标签计数的缓存在文献库变化后立即失效 | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero）；Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/result-cache.test.ts`；运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 tools.cache-invalidation：先把空结果读入缓存，再通过种子插件给条目加上标签，`list_tags` 与 `search_items(tags)` 立即看到它，删除后立即消失。 |
| D-16 | `get_notes` 读取附件笔记（附件面板中的笔记）；没有笔记的附件返回空页；`get_items` 只列出前 10 个子笔记 / 附件并给出精确数量，批注文字与评论限 50000 字符 | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero）；Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/data-format.test.ts`；运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 tools.get_notes（链接 PDF 的附件笔记、无笔记附件返回 0 项、批注键返回 WRONG_ITEM_TYPE）与 tools.get_items（`noteCount` / `attachmentCount` / `truncated`）。 |

## 5. 附件

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| A-1 | 存储文件：`get_attachment_path` 返回绝对路径、`exists: true`、存储目录 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.attachments。 |
| A-2 | 链接文件，路径含中文和空格：路径正确、`exists: true` | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.attachments（链接文件位于含中文和空格的目录）。 |
| A-3 | 文件缺失：`exists: false`，`note` 说明原因 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.attachments：两个缺失文件均为 exists false，带 note 与预期路径。 |
| A-4 | 对普通条目调用 `get_attachment_path` 时选择最佳附件（PDF 优先）；`list_attachments` 列出全部附件 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.attachments：对父条目调用 get_attachment_path 返回存储的 PDF。 |
| A-5 | `get_library_paths`：数据目录、存储目录、数据库路径、链接附件根目录 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 tools.get_library_paths。 |
| A-6 | 链接网址附件：`path` 为 null，返回网址 | 未验证 | | | | |
| A-7 | 同步设置为“按需下载”且文件尚未下载时：返回 `exists: false`，**不触发下载** | 未验证 | | | | |

## 6. 生命周期

Z-3（设置页启用开关）随开关一起删除，编号不再使用；关闭桥接改为禁用插件，见 Z-4。

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| Z-1 | 通过「工具 → 插件」从文件安装 XPI，无需重启即可调用 `get_status` | 未验证 | | | | |
| Z-2 | 设置页「Zotero AI Bridge」显示状态「运行中，地址 127.0.0.1:23119」、地址与别名；四个复制按钮复制的内容正确 | 未验证 | | | | 设置页加载、本地化、状态、地址与别名已在独立测试实例上自动验证（见 Z-10）；仍需人工确认：默认端口 23119 下的显示、中文界面，以及四个复制按钮写入剪贴板的内容（自动测试不点击复制按钮，以免改动本机剪贴板）。 |
| Z-4 | 关闭桥接（插件没有自己的开关）：在插件管理器中禁用插件 → 两个路径立即 404；重新启用 → 立即恢复，无需重启 Zotero；Zotero Connector 的 `/connector/ping` 始终正常 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 lifecycle.addon-toggle（AddonManager 禁用 / 启用）：禁用期间两个路径 404、/connector/ping 200；重新启用后两条路径 initialize 与 `get_status`（status "running"）正常、`tools/list` 18 个工具。 |
| Z-5 | 卸载插件：两个路径 404；`extensions.zotero.httpServer.*` 与 Connector 相关首选项未被改动 | 未验证 | | | | |
| Z-6 | 重启 Zotero 后插件自动注册端点，客户端无需改配置 | 未验证 | | | | |
| Z-7 | 修改 `extensions.zotero.httpServer.port` 并重启 Zotero：设置页显示新端口；客户端改配置后可用 | 未验证 | | | | |
| Z-8 | 关闭 Zotero HTTP 服务器（`extensions.zotero.httpServer.enabled = false`）并重启：设置页显示“Zotero 的本地 HTTP 服务器未运行……”，不注册端点 | 未验证 | | | | |
| Z-9 | 覆盖安装新版本 XPI：旧版本端点被注销，新版本正常服务，没有残留的旧端点类 | 未验证 | | | | |
| Z-10 | 设置页（独立测试实例，en-US 界面）：「Zotero AI Bridge」设置页加载；页面中全部 17 个本地化元素显示 en-US 文件中的文本；zh-CN 文件同样已注册（XPI 不含目录条目，Zotero 仍能列出 `locale/<语言>/`）；状态「Running on 127.0.0.1:23139」、地址与别名正确，复制按钮可用；插件禁用再启用后设置页重新注册 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | T1（运行 20261015-125642-ad25b2）与 T2（运行 20261015-125804-611a4d）中用例 lifecycle.prefs-pane 通过（在 lifecycle.addon-toggle 之后运行）：17 个本地化元素逐一与 `locale/en-US/zotero-ai-bridge.ftl` 比对；通过新建的 Fluent Localization 按 en-US、zh-CN 分别格式化 15 条无变量消息，结果与两个 FTL 文件一致；L10nRegistry 中存在 Zotero 的合并插件源 `zotero-plugins`；设置页图标可读取。 |
| Z-11 | Zotero 在没有 shutdown 的情况下再次调用 `startup`（同一会话中卸载后重新安装等）时，bootstrap 先停止旧运行时再加载新的，旧运行时的端点（新运行时不提供服务时）、Notifier 观察器、状态短语补丁与设置页不会遗留 | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/unit/build-helpers.test.ts`（`restartProblems`：缺少保护的 bootstrap 被判失败）；`npm run build` 的打包契约检查与 `npm run verify` 的 XPI 检查对真实 `bootstrap.js` 运行同一检查（startup 1 → shutdown 1 → startup 2 → shutdown 2）。 |

## 7. 安装（双端）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| I-C1 | Codex：`codex plugin marketplace add <插件目录>` 接受插件根目录内的 `.agents/plugins/marketplace.json`（`"path": "./"`），市场名 `zotero-ai-bridge-local`；路径含中文和空格同样成功 | 已验证（临时配置） | codex-cli 0.162.0-alpha.17.2 | Windows 11，开发机，临时 `CODEX_HOME` / `HOME` / `USERPROFILE` | 2026-10-15 | 输出 ``Added marketplace `zotero-ai-bridge-local` ``；`plugin list --available --json` 列出 `zotero-ai-bridge@zotero-ai-bridge-local` 0.1.0。真实 `~/.codex/config.toml` 中没有出现任何本项目条目。 |
| I-C2 | Codex：`codex plugin add zotero-ai-bridge@zotero-ai-bridge-local` 安装并启用；`codex mcp list --json` 出现 `zotero_bridge`；`hooks/list` 发现插件 Hook；技能列表出现 `zotero-ai-bridge:zotero` | 已验证（临时配置） | codex-cli 0.162.0-alpha.17.2 | 同上 | 2026-10-15 | `installed: true, enabled: true`；`zotero_bridge` 为 `streamable_http`、`startup_timeout_sec` 10、`tool_timeout_sec` 30；`codex app-server` 的 `hooks/list`：键 `zotero-ai-bridge@zotero-ai-bridge-local:hooks/hooks.json:user_prompt_submit:0:0`、`handlerType: mcpTool`、`server: zotero_bridge`、`timeoutSec: 5`、`trustStatus: untrusted`，无警告和错误；`codex debug prompt-input` 中出现技能 `zotero-ai-bridge:zotero`。 |
| I-C3 | Codex：Hook 信任语义：只改版本号或只改 `.mcp.json` 时信任保持；Hook 定义改动后变为需要重新信任 | 已验证（临时配置） | codex-cli 0.162.0-alpha.17.2 | 同上（在临时 `config.toml` 中写入 `hooks/list` 报告的 `currentHash` 模拟信任） | 2026-10-15 | 0.1.1 → 0.1.2 只改版本：`trusted`；Hook `timeout` 5 → 6：`modified`；恢复 Hook、只改 `.mcp.json` 端口：`trusted`。`codex plugin marketplace upgrade` 对本地市场报 “is not configured as a Git marketplace”；修改后重新 `plugin add` 安装新版本。 |
| I-C4 | Codex：手动配置示例 `examples/codex-config.toml.example` 被接受；`codex mcp add zotero_bridge --url ...` 写入 `[mcp_servers.zotero_bridge]`；`plugin remove` 与 `marketplace remove` 正常卸载 | 已验证（临时配置） | codex-cli 0.162.0-alpha.17.2 | 同上 | 2026-10-15 | `mcp list` 显示 `zotero_bridge`（超时 10 / 30）；`hooks/list` 显示来源 `user` 的同一 Hook，无警告。`codex mcp add` 只写入临时 `config.toml`；真实 `~/.codex/config.toml` 不含本项目条目（同时运行的 Codex 桌面版在此期间自己改写过它一次）。 |
| I-C5 | Codex CLI 真实环境：按 [install-codex.md](install-codex.md) 安装，`/hooks` 中信任 Hook，新会话 `/mcp` 显示 18 个工具 | 未验证 | | | | |
| I-C6 | Codex 桌面版真实环境：插件目录中安装，“Review hooks” / “Trust all” 信任，新对话可用 | 未验证 | | | | |
| I-K1 | Claude Code：`claude plugin marketplace add <插件目录>` + `claude plugin install zotero-ai-bridge@zotero-ai-bridge-local`（user 作用域）；`claude plugin details` 列出 1 个技能、1 个 UserPromptSubmit Hook、1 个 MCP 服务器 | 已验证（临时配置） | Claude Code 2.1.295 | Windows 11，开发机，临时 `HOME` / `USERPROFILE` / `CLAUDE_CONFIG_DIR` | 2026-10-15 | `settings.json` 写入 `extraKnownMarketplaces`（`source: directory`）与 `enabledPlugins`；`claude mcp list` 显示 `plugin:zotero-ai-bridge:zotero`（Zotero 未运行，ECONNREFUSED 符合预期）。真实 `~/.claude/settings.json`、`~/.claude.json` 前后 SHA-256 相同。 |
| I-K2 | Claude Code：`--plugin-dir`（路径含中文和空格）加载插件；版本号改为 0.1.1 后 `marketplace update` + `plugin update` 升级；`uninstall` + `marketplace remove` 清理干净 | 已验证（临时配置） | Claude Code 2.1.295 | 同上 | 2026-10-15 | `--plugin-dir ... mcp list` 显示 `plugin:zotero-ai-bridge:zotero`；“updated from 0.1.0 to 0.1.1”；卸载后 `enabledPlugins` 与 `extraKnownMarketplaces` 为空。 |
| I-K3 | Claude Code：插件已安装时再手动 `claude mcp add --scope user zotero <同一地址>`，插件服务器被隐藏（证实“二选一”） | 已验证（临时配置） | Claude Code 2.1.295 | 同上 | 2026-10-15 | 并存时 `claude mcp list` 只列出手动的 `zotero`；`claude mcp remove zotero --scope user` 后插件服务器重新出现。（当时的手动注册名是 `zotero`；现在的说明改用 `zotero_bridge`，去重按 URL 进行，与名字无关。） |
| I-K4 | Claude Code 真实环境：按 [install-claude-code.md](install-claude-code.md) 安装，`/mcp` 显示已连接、18 个工具，`/hooks` 显示 Hook | 未验证 | | | | |
| I-K5 | Claude 桌面应用的 Code 标签页是否加载用户级插件 | 未验证 | | | | |

## 8. 端到端（双端）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| E-C1 | Codex：在 Zotero 中选中一篇论文，问“我当前在 Zotero 中选中的是哪篇论文？请给出 libraryID 和 key。”→ 不调用工具即答出正确标题和 libraryID + key | 未验证 | | | | |
| E-C2 | Codex：打开 PDF、翻到某页并选中一段文字，问“我选中的这段话是什么意思？在第几页？”→ 准确引用选中文字和页码标签 | 未验证 | | | | |
| E-C3 | Codex：“在我的文献库中找关于 <主题> 的论文，读取第一篇的 PDF 并总结方法”→ 依次调用 `search_items`、`get_attachment_path`，用 Codex 自己的工具读取 PDF，引用中给出 `zotero://select` 链接或 libraryID + key | 未验证 | | | | |
| E-K1 | Claude Code：同 E-C1 | 未验证 | | | | |
| E-K2 | Claude Code：同 E-C2 | 未验证 | | | | |
| E-K3 | Claude Code：同 E-C3（用 Read 工具读取 PDF） | 未验证 | | | | |

## 9. 每轮刷新（双端）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| R-1 | 服务端：每次 `capture_prompt_context` 生成新的 `snapshotId`，`sequence` 严格递增，`capturedAt` 更新；Codex 与 Claude Code 的 id 组成正确（`tests/unit/snapshot.test.ts`、`npm run test:zotero`） | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/snapshot.test.ts` 30 通过；`npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 context.hook-sequence、context.hook-codex、context.hook-claude-code。 |
| R-2 | 服务端：关闭阅读器后的下一次快照不再包含 `reader`；空选择 → `status: "empty"`（`npm run test:zotero`） | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 context.reader-closed、context.empty。 |
| R-3 | 服务端：笔记在标签页中打开（Zotero 11 默认）时，快照的 `focus` 为 `note`，`note` 给出笔记及其父条目；隐藏的文献库标签页中的选择不作为焦点；状态行不会说“什么都没打开” | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero）；Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/snapshot.test.ts` 30 通过、`tests/unit/hook-output.test.ts`；运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 context.note-tab：文献库中选中另一篇条目后在标签页打开子笔记，快照 `focus: "note"`、`activeTab.type: "note"`、父条目正确，Hook 状态行为 “Focus: the note open in Zotero”。 |
| R-4 | 服务端：关闭主窗口、只留获得焦点的独立阅读器窗口时，快照仍为 `ok` 并包含阅读器（`unavailable` 只在没有任何可读窗口时出现）；读取阅读器条目超时只丢掉阅读器部分 | 未验证 | | | | 状态与焦点规则由 `tests/unit/snapshot.test.ts` 覆盖；真实 Zotero 中关闭主窗口的流程未自动化（会影响后续用例），需人工检查。 |
| R-C1 | Codex：选中论文 A 提问，再改选论文 B 问“那这篇呢？”→ 第二个回答切换到 B；两轮快照的 `snapshotId` 不同 | 未验证 | | | | |
| R-C2 | Codex：关闭 PDF 阅读器后再问“我在读哪篇？”→ 不再声称阅读器中打开着之前的 PDF | 未验证 | | | | |
| R-K1 | Claude Code：同 R-C1 | 未验证 | | | | |
| R-K2 | Claude Code：同 R-C2 | 未验证 | | | | |

## 10. 一致性（双端）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| S-1 | 服务端：`/bridge/mcp` 与 `/codex/mcp` 对同一请求结果一致；`get_current_context` 与 `capture_prompt_context` 中的快照结构一致（`npm run test:zotero`、`tests/unit/snapshot-schema.test.ts`） | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/snapshot-schema.test.ts` 5 通过；`npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 protocol.alias-equality（两条路径结果一致），context.* 用例把两个工具返回的快照按同一 ContextSnapshot 结构断言。 |
| S-C1 | Codex：让模型分多点详细总结当前论文，回答生成期间在 Zotero 中改选另一篇 → 本次回答始终使用开始时的 libraryID + key；回答中的 key 与本轮快照一致 | 未验证 | | | | |
| S-K1 | Claude Code：同 S-C1 | 未验证 | | | | |
| S-X1 | 同一选择下，Codex 与 Claude Code 报告的 libraryID + key、标题、页码一致 | 未验证 | | | | |

## 11. 失败继续（双端）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| F-1 | 服务端：任何异常都不返回 5xx；“什么都没选中”或 Zotero 状态不可读时 `capture_prompt_context` 不返回 `isError`，而在 additionalContext 中说明；additionalContext ≤ 8000 字符，Codex 与未知客户端另 ≤ 9600 个 UTF-8 字节（Codex 约 10000 字节的转存阈值以内）（`tests/unit/hook-output.test.ts`、`tests/protocol/*`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/unit/hook-output.test.ts` 24 通过（2600 / 4000 个汉字的选区、3 / 5 条长中文批注在 Codex 预算下都 ≤ 9600 字节且 JSON 完整；Claude Code 预算下 4000 字的中文选区保持完整）、`tests/protocol/*` 114 通过；真实 Zotero 上 context.* 用例均满足 ≤ 8000 字符，非 Claude Code 客户端的 Hook 另满足 ≤ 9600 字节。 |
| F-C1 | Codex：Zotero 未运行时开始新会话并发送消息 → Hook 失败（`not connected`）但消息照常得到回答；模型说明当前 Zotero 状态未知，不引用旧快照 | 未验证 | | | | |
| F-C2 | Codex：会话中途退出 Zotero → 下一条消息 Hook 失败、对话继续；重新启动 Zotero 后记录同一会话是否恢复，新会话必须恢复 | 未验证 | | | | |
| F-C3 | Codex：在 Zotero 中禁用插件（**工具 → 插件**，端点 404）→ Hook 失败、对话继续；重新启用插件后恢复 | 未验证 | | | | |
| F-K1 | Claude Code：Zotero 未运行 → 非阻塞 Hook 错误，消息照常得到回答 | 未验证 | | | | |
| F-K2 | Claude Code：会话中途退出 Zotero → 对话继续；重启 Zotero 后在 `/mcp` 中重新连接即可恢复 | 未验证 | | | | |
| F-K3 | Claude Code：在 Zotero 中禁用插件（端点 404）→ 非阻塞错误、对话继续 | 未验证 | | | | |
| F-K4 | Claude Code：启动后立即发送第一条消息（服务器可能仍在连接）→ 记录本轮是否带快照；不带时消息仍正常发送 | 未验证 | | | | |

## 12. 输入最小化（双端）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| M-1 | 两个插件的 Hook 输入只含 `client`、`session_id` 和 `turn_id`（Codex）/ `prompt_id`（Claude Code），不含 `${prompt}`、`${cwd}`、`${transcript_path}`；手动配置示例相同（`tests/clients/plugin-manifests.test.ts`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/clients/plugin-manifests.test.ts` 28 通过（也包含在 `npm test` 中）。 |
| M-C1 | Codex：开启 Zotero 调试日志后发送一条含独特词语的消息，日志中 `capture_prompt_context` 请求只含上述参数（以及 Codex 自动附加的 `_meta.threadId`），搜索不到该词语 | 未验证 | | | | |
| M-K1 | Claude Code：同 M-C1（没有 `_meta.threadId`） | 未验证 | | | | |
| M-2 | 插件自己的日志行（以 `[Zotero AI Bridge]` 开头）只含方法、工具名、状态码、字节数和耗时，不含标题、参数或响应内容 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139），测试配置文件中开启 Zotero 调试输出（`-ZoteroDebugText`） | 2026-10-15 | T2（`npm run test:zotero -- --debug-output`，运行 20261015-125804-611a4d）中用例 harness.debug-log-privacy：全部用例结束后检查调试输出中的 580 行 `[Zotero AI Bridge]`，每一行都符合已知的摘要格式（请求方法、JSON-RPC 方法、工具名、状态、结果类别、字节数、耗时，以及启动 / 关闭行），没有任何一行含夹具中的标题、集合名、附件名或批注文字。T0（运行 20261015-103117-8c0161，`work/zotero-test/20261015-103117-8c0161/logs/zotero-stdout.log`）中 PowerShell、Claude Code 与 Codex 的请求（见 G-2、G-3）产生的 49 行同样只有摘要。Zotero 自己记录的请求头、请求正文、附件路径与数据库查询参数不在此项范围内（见 architecture.md 第 5 节）：T2 的调试输出中有 16 行 Zotero 自己的 `Attachment file '…' not found`（缺失附件的绝对路径与文件名），与文档的说明一致。 |

## 13. 无 Hook 通用 MCP 客户端 / Claude Science

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| G-1 | 通用 MCP 客户端（官方 TypeScript SDK，无 Hook）完成 initialize、tools/list（18 个工具）、tools/call（`tests/protocol/sdk-client.test.ts`） | 通过 | Node.js 24.15.0，@modelcontextprotocol/sdk 1.32.1 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/protocol/sdk-client.test.ts` 38 通过 / 0 失败。 |
| G-2 | 用 PowerShell 原始 JSON-RPC 请求（[generic-no-hook](../tests/clients/generic-no-hook/README.md) 第 1 节）对真实 Zotero 完成 initialize、tools/list、`get_current_context` | 通过 | PowerShell 7.6.6 与 Windows PowerShell 5.1.26100；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | T0（运行 20261015-103117-8c0161，证据 `work/zotero-test/20261015-103117-8c0161/logs/zotero-stdout.log`，手动运行没有 report.json）：第 1 节的命令原样执行（只把 `$uri` 的端口改为 23139），选中一个中文标题的夹具条目后：两个 PowerShell 版本都得到 protocolVersion 2025-11-25、serverInfo.name zotero-ai-bridge；通知无输出；tools/list 18 个工具名；`get_current_context` 为 status ok、focus library，返回所选条目的 libraryID + key，中文标题完整（响应不带 charset，Windows PowerShell 5.1 也能正确得到中文，因为外层 JSON 已全部转义为 \uXXXX 而不受影响）。 |
| G-3 | 一个真实的无 Hook MCP 客户端（例如手动注册、不加 Hook 的 Claude Code）连接并列出 18 个工具 | 已验证（临时配置） | Claude Code 2.1.295；codex-cli 0.162.0-alpha.17.2；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139）；客户端使用临时 `HOME` / `USERPROFILE` / `CLAUDE_CONFIG_DIR` / `CODEX_HOME` | 2026-10-15 | T0（运行 20261015-103117-8c0161，证据 `work/zotero-test/20261015-103117-8c0161/logs/zotero-stdout.log` 中 `user-agent: claude-code/2.1.295` 与 `codex-mcp-client/0.162.0-alpha.17.2` 的请求，手动运行没有 report.json）。Claude Code：`claude mcp add --transport http --scope user zotero http://127.0.0.1:23139/bridge/mcp`（当时的手动注册名；现在的说明使用 `zotero_bridge`）后 `claude mcp list` 与 `claude mcp get zotero` 均为「✔ Connected」；Zotero 调试输出显示其请求序列为 `server/discover` 探测（400）→ initialize 2025-11-25 → 通知 202 → GET 405 → tools/list 200。Codex：`codex app-server` 的 `mcpServerStatus/list`（配置同 `examples/codex-config.toml.example` 的服务器段，端口 23139）返回 serverInfo zotero-ai-bridge 0.1.0、18 个工具、toolsError 为 null；其请求序列为 GET 405 与若干 OAuth 发现请求（Zotero 404）→ initialize 2025-06-18 → 202 → tools/list 200。这证明两个客户端的 HTTP 实现（Bun、reqwest）能与 Zotero 的 HTTP/1.0 响应配合；会话中 `/mcp` 的显示仍属 I-C5 / I-K4。真实 `~/.claude.json`、`~/.claude/settings.json`、`~/.codex/config.toml` 前后 SHA-256 相同。 |
| G-4 | Claude Science：添加 `http://127.0.0.1:23119/bridge/mcp` 连接器 | 未验证 / 静态分析判定不兼容 | Claude Science 0.1.62 | Windows 11，开发机（只做静态分析） | 2026-10-14 | 程序中 `safeFetch: https-only` 与 `safeFetch: non-public host rejected` 两个拒绝分支；启动日志曾记录 `[proxy] denied 127.0.0.1:23119 (blocked-port)`。详见 [integrations/claude-science/README.md](../integrations/claude-science/README.md)。 |

## 14. 无 Hook 工作流

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| W-1 | 无 Hook 技能 + 通用客户端：用户说“这篇论文 / 我的选择”时，模型在同一轮调用 `get_current_context` 并使用返回的 libraryID + key | 未验证 | | | | |
| W-2 | 下一条消息前在 Zotero 中改选，用户再说“这篇呢” → 模型重新调用 `get_current_context`，不复用旧结果 | 未验证 | | | | |
| W-3 | 什么都没选中（`status: "empty"`）→ 模型请用户选中或按标题搜索；Zotero 未运行 → 模型说明并建议 `get_status`，不猜测 | 未验证 | | | | |
| W-4 | 模型不调用 `capture_prompt_context` | 未验证 | | | | |
| W-5 | Claude Science 中的无 Hook 工作流 | 未验证 / 静态分析判定不兼容 | Claude Science 0.1.62 | — | 2026-10-14 | 连接器无法添加（见 G-4）。 |

## 15. 无 Hook PDF 阅读

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| N-1 | 通用客户端：`get_attachment_path` 取得路径后，用客户端自己的文件工具读取 PDF 并回答 | 未验证 | | | | |
| N-2 | 附件文件缺失时，模型根据 `exists: false` 和 `note` 如实说明，不编造内容 | 未验证 | | | | |
| N-3 | Claude Science 中读取 PDF | 未验证 / 静态分析判定不兼容 | Claude Science 0.1.62 | — | 2026-10-14 | 连接器无法添加（见 G-4）；沙箱是否能读取本地文件也未知。 |

## 16. 只读

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| O-1 | 18 个工具的注解都是 `readOnlyHint: true`、`destructiveHint: false`（`tests/unit/contract.test.ts`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/unit/contract.test.ts` 111 通过 / 0 失败。 |
| O-2 | 集成测试调用全部工具前后，测试数据库指纹（行数、最大修改时间、文献库版本）与附件文件完全一致（`npm run test:zotero`） | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 lifecycle.read-only：阅读器打开、条目选中时调用 61 次工具，21 张表、最大值与 4 个附件文件前后一致。基线在界面操作之后取（Zotero 自己的阅读器打开 PDF 时会写数据库），只比较桥接调用前后。 |
| O-3 | 发布代码中没有 Zotero 写入 API：在仓库根目录执行下面的扫描，除注释和 `linkModeToName`（只读的名称转换）外没有命中 | 已验证（静态检查） | — | Windows 11，开发机，仓库源码与最终 XPI | 2026-10-15 | 集成时对最终代码重新执行下面的扫描：只命中 `src/zotero/attachments.ts` 中的一行注释和 `Zotero.Attachments.linkModeToName`；对最终 XPI 中的三个脚本执行同一扫描，只命中 `linkModeToName`。 |
| O-4 | 真实文献库：完成第 8–15 节的手动验收后，所用条目在 Zotero 中的“修改日期”未变化，没有新增条目、笔记或标签 | 未验证 | | | | |

O-3 使用的扫描命令（Git Bash）：

```bash
grep -rnE "\.(saveTx|save|eraseTx|erase|setField|setNote|setCreators|addTag|removeTag|setTags|addToCollection|removeFromCollection|relinkAttachmentFile|renameAttachmentFile|downloadFile)\(|Zotero\.DB\.[A-Za-z]+\(|Zotero\.File\.(putContents|putContentsAsync|createDirectoryIfMissing|removeIfExists)|Zotero\.Sync|IOUtils\.(write|remove|move|copy|makeDirectory)|Zotero\.Attachments\.(import|link|create|download)" \
  packages/zotero/src packages/zotero/bootstrap.ts packages/zotero/content/preferences.ts
```
