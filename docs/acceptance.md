# 验收记录

当前构建不再生成额外的 `source.zip`，源码由 GitHub Release 提供；下文实测记录中的源码包条目保留为历史证据。

历史记录中的 Zotero AI Bridge、旧安装包名和 `/codex/mcp` 对应当时测试的版本。当前项目已更名为 Zotero Reading Bridge，使用新的插件 ID，且只提供 `/bridge/mcp`；以下历史实测结果不代表新版已完成桌面实装验收。

本页逐项列出验收项，并记录每一项的执行结果。项目现在只维护三个插件：Zotero 插件（XPI）、Codex 桌面插件（ZIP）和
Claude 桌面应用扩展（MCPB）。手动步骤见各自的安装说明：

- Codex 桌面版：[packages/codex/README.md](../packages/codex/README.md)
- Claude 桌面应用（聊天与 Cowork）：[packages/claude-desktop/README.md](../packages/claude-desktop/README.md)

Claude Code 插件、Claude Science 与通用无 Hook 技能已删除，只涉及它们的验收项（B-3、B-6、I-K*、E-K*、R-K*、S-K1、F-K*、M-K1、G-3、G-4、
第 14、15 节）随之删除，编号不再使用；保留的条目中提到这些客户端的地方是当时的历史证据。

## 状态取值

| 状态 | 含义 |
|---|---|
| `未验证` | 还没有人执行过。 |
| `自动化测试覆盖（待集成后填写结果）` | 由仓库中的自动化测试或脚本检查（命令写在“检查项”中）。集成时运行命令，把状态改为 `通过` / `失败`，并在“证据”中写明命令、通过数量和日期。 |
| `已验证（临时配置）` | 用真实客户端程序执行过，但 `HOME`、`USERPROFILE`、`CODEX_HOME`、`CLAUDE_CONFIG_DIR` 全部指向临时目录，只证明客户端能识别插件结构，不代表真实环境中的完整流程。 |
| `已验证（静态检查）` | 通过阅读程序、校验器或代码扫描确认，没有运行完整功能。 |
| `通过` / `失败` | 真实执行后的结论。失败时在“证据”中写明现象，并在 issue 或 [troubleshooting.md](troubleshooting.md) 中补充。 |

填写规则：

- **客户端版本**：`codex --version`、Codex 桌面版“关于”页、Claude 桌面应用“关于”页；Zotero 版本见「帮助 → 关于 Zotero」；不涉及客户端时写 Node 与 Zotero 版本。
- **执行位置**：操作系统 + 机器（例如“Windows 11，开发机”“Windows 11，干净虚拟机”），以及是否为临时配置 / 独立测试配置文件。
- **证据**：命令与输出摘要、测试报告文件（如 `work/zotero-test/report.json`）、截图文件名或日志片段。**不要**粘贴文献库内容、令牌或含用户名的本机绝对路径。

## 0. 环境

| 项目 | 值 |
|---|---|
| 被测提交 / 构建（`outputs/BUILD-INFO.json`） | 0.1.0，2026-10-15 构建（移除插件自有的启用开关与 `prefs.js` 之后）。`zotero-ai-bridge.xpi` sha256 `d2c2af6f…e334`，T1、T2 使用这个 XPI；T0 使用更早的 XPI `a17bb462…d840`（修复评审问题之前，仍带启用开关） |
| Zotero 集成测试运行 | T0：手动客户端探测（PowerShell 与当时的客户端连接独立测试实例，见 G-2、M-2），运行 20261015-103117-8c0161，证据为 `work/zotero-test/20261015-103117-8c0161/logs/zotero-stdout.log`（手动运行，没有 report.json；修复前的 XPI）。T1：`npm run test:zotero`，运行 20261015-125642-ad25b2：74 通过 / 0 失败 / 1 跳过（跳过的是 `harness.debug-log-privacy`，它只在 `--debug-output` 时执行）。T2：`npm run test:zotero -- --debug-output`，运行 20261015-125804-611a4d：75 通过 / 0 失败 / 0 跳过。报告：`work/zotero-test/<运行>/report.json` |
| Zotero 版本 | 11.0-beta.1+b0db83d9d（Gecko 153.3.0），独立测试实例 |
| 操作系统 | Windows 11 Pro |
| Node.js 版本 | 24.15.0 |
| Codex CLI / 桌面版版本 | codex-cli 0.162.0-alpha.17.2（仅临时配置验证） |
| Claude 桌面应用版本 | 2.42304.0（Windows，真实安装，见第 17 节） |

## 1. 构建与类型检查

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| B-1 | `npm run typecheck`：全部 tsconfig（Zotero 插件、设置页面、脚本、测试、测试用种子插件、共用中继 `shared/relay/`）均无错误 | 通过 | Node.js 24.15.0，TypeScript 6.0.3 | Windows 11 开发机 | 2026-10-17 | 6 个 tsconfig 全部 ok，退出码 0（`npm run build` 的类型检查步骤同样通过）。历史记录（2026-10-15，旧布局，Node.js 24.15.0，TypeScript 6.0.3，Windows 11 开发机）：当时的五个 tsconfig `npm run typecheck` 退出码 0，`npm run build` 的类型检查步骤也全部通过。 |
| B-2 | `npm test`：单元测试（`tests/unit`）、协议测试（`tests/protocol`）与集成测试工具自检（`tests/zotero/*.test.ts`）全部通过 | 通过 | Node.js 24.15.0，TypeScript 6.0.3 | Windows 11 开发机 | 2026-10-17 | 501 通过 / 0 失败（113 个测试组，0 跳过）。历史记录（2026-10-15，旧布局，Node.js 24.15.0，Windows 11 开发机）：522 通过 / 0 失败（116 个测试组，0 跳过；当时还包含已删除的客户端清单检查）。 |
| B-4 | `npm run build`：类型检查 → 打包，一次生成 `zotero-reading-bridge.xpi`、`zotero-reading-bridge-codex.zip`、`zotero-reading-bridge-claude-desktop.mcpb`、`SKILL.md`、`updates.json` 与 `BUILD-INFO.json`（两个安装包都含同一份 `server/zotero-relay.js`，清单中的版本、作者、许可证、关键词来自 `package.json`），随后自动运行产物校验；任何一步失败时不留下看似成功的产物，退出码非 0 | 通过 | Node.js 24.15.0，TypeScript 6.0.3 | Windows 11 开发机 | 2026-10-17 | 退出码 0：XPI 9 个条目、Codex ZIP 11 个条目、MCPB 4 个条目、`source.zip` 163 个条目、`BUILD-INFO.json`，末尾校验 34 项全部通过。失败注入：在 `packages/codex/` 放入应由构建生成的 `plugin.json`，构建报错并删除 `outputs/`。与旧布局构建逐文件比对：只有键顺序、来自 `package.json` 的元数据位置、描述文字和中继源路径注释不同。历史记录（2026-10-15，旧布局，Node.js 24.15.0，Windows 11 开发机）：`npm run build` 退出码 0，输出当时布局的 6 项产物（含 XPI 8 个条目、Codex 包 7 个条目、`source.zip`、`BUILD-INFO.json`）。失败注入（在路径含空格和中文的仓库副本中）：写出 XPI 与 Codex 包之后抛错、找不到 TypeScript、include 目标缺失，三种情况结束后 `outputs/` 都不存在。 |
| B-5 | `npm run verify`（`npm run build` 末尾也自动运行）：XPI、Codex ZIP、MCPB 的结构与清单字段、引用资源存在、无未展开的 include 标记、两个安装包中的中继只用 Node 内置模块且不监听端口、敏感信息与本机绝对路径扫描、更新清单版本及 XPI SHA-256 校验 | 通过 | Node.js 24.15.0，TypeScript 6.0.3 | Windows 11 开发机 | 2026-10-17 | 34 通过 / 0 失败，退出码 0。历史记录（2026-10-15，旧布局，Node.js 24.15.0，Windows 11 开发机）：32 通过 / 0 失败，退出码 0。敏感信息扫描另含 `Authorization: Basic`、Zotero Web API 密钥形状和通用的“key / token / secret / password = 引号字面值”规则；仓库根目录的 `.mcp.json` 与 `*.local.*` 文件不进入 `source.zip`。 |

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
| P-8 | `tools/list` 返回全部工具（当前 19 个），名称与 `shared/types/tool-names.ts` 一致，没有 `outputSchema`（`tests/unit/contract.test.ts`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/unit/contract.test.ts` 111 通过；真实 Zotero 上用例 protocol.tools-list 通过（当时 18 个工具，`get_fulltext` 尚未加入）。 |
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
| L-11 | 未知工具与写入类工具不可调用：`tools/list` 只有只读工具（当前 19 个，记录时 18 个）；未知工具名（如 `delete_everything`）返回 `-32602` | 通过 | Node.js 24.15.0，@modelcontextprotocol/sdk 1.32.1；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero）；Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/protocol/mcp-handler.test.ts` 与 `tests/protocol/sdk-client.test.ts`（未知工具 `-32602`）、`tests/unit/contract.test.ts` 111 通过（全部只读注解）；运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`） 中用例 protocol.tools-list（18 个只读工具）、protocol.tool-call-errors（未知工具 `-32602`）。 |
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
| A-8 | `get_fulltext`：已索引的 PDF 一次返回整篇（`complete: true`），第二个内容是按阅读顺序的正文；部分索引时 `indexState: "partial"` 并带 `note`；未索引时没有正文、`note` 建议读文件；不写数据库、不生成缓存文件 | 未验证 | | | | |
| A-9 | `get_fulltext` 超出单次上限的长文：`complete: false`，用 `nextOffset` 续读直到读完，拼接结果与缓存文件一致 | 未验证 | | | | |
| A-10 | 图片批注：`get_annotations` 默认在 JSON 后附带缓存 PNG（`image.included: true`）；`includeImages: false` 只给状态；缓存图不存在时 `exists: false` 并带 `note`，不报错；`get_current_context` 对选中的图片批注附带图像 | 未验证 | | | | |
| A-11 | 客户端：Codex 与 Claude 桌面应用把图片批注的 image 内容当作图像交给模型；`get_fulltext` 整篇结果不被客户端截断 | 未验证 | | | | |
| A-12 | 阅读器问答：打开一篇 PDF 问“这篇的方法是什么”，模型先对阅读器附件调用 `get_fulltext` 再作答；选中图片批注后提问，模型调用 `get_annotations` 看图（Codex） | 未验证 | | | | |

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

## 7. 安装（Codex）

I-C1–I-C4 是用当时的 CLI 与本地市场安装方式在临时配置中做的历史记录（该安装方式已删除），保留作为插件结构与 Hook 信任语义的证据；
现在的安装方式是拖入 ZIP（I-C5、I-C6）。Claude 桌面应用的安装见第 17 节。

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| I-C1 | Codex：旧版 CLI 操作（安装步骤已移除） 接受插件根目录内的 `.agents/plugins/marketplace.json`（`"path": "./"`），市场名 `zotero-ai-bridge-local`；路径含中文和空格同样成功 | 已验证（临时配置） | codex-cli 0.162.0-alpha.17.2 | Windows 11，开发机，临时 `CODEX_HOME` / `HOME` / `USERPROFILE` | 2026-10-15 | 输出 ``Added marketplace `zotero-ai-bridge-local` ``；`plugin list --available --json` 列出 `zotero-ai-bridge@zotero-ai-bridge-local` 0.1.0。真实 `~/.codex/config.toml` 中没有出现任何本项目条目。 |
| I-C2 | Codex：旧版 CLI 操作（安装步骤已移除） 安装并启用；`codex mcp list --json` 出现 `zotero_bridge`；`hooks/list` 发现插件 Hook；技能列表出现 `zotero-ai-bridge:zotero` | 已验证（临时配置） | codex-cli 0.162.0-alpha.17.2 | 同上 | 2026-10-15 | `installed: true, enabled: true`；`zotero_bridge` 为 `streamable_http`、`startup_timeout_sec` 10、`tool_timeout_sec` 30；`codex app-server` 的 `hooks/list`：键 `zotero-ai-bridge@zotero-ai-bridge-local:hooks/hooks.json:user_prompt_submit:0:0`、`handlerType: mcpTool`、`server: zotero_bridge`、`timeoutSec: 5`、`trustStatus: untrusted`，无警告和错误；`codex debug prompt-input` 中出现技能 `zotero-ai-bridge:zotero`。 |
| I-C3 | Codex：Hook 信任语义：只改版本号或只改 `.mcp.json` 时信任保持；Hook 定义改动后变为需要重新信任 | 已验证（临时配置） | codex-cli 0.162.0-alpha.17.2 | 同上（在临时 `config.toml` 中写入 `hooks/list` 报告的 `currentHash` 模拟信任） | 2026-10-15 | 0.1.1 → 0.1.2 只改版本：`trusted`；Hook `timeout` 5 → 6：`modified`；恢复 Hook、只改 `.mcp.json` 端口：`trusted`。旧版 CLI 操作（安装步骤已移除） 对本地市场报 “is not configured as a Git marketplace”；修改后重新 `plugin add` 安装新版本。 |
| I-C4 | Codex：手动配置示例 旧版配置示例（已移除） 被接受；旧版 MCP 注册操作 写入 `[mcp_servers.zotero_bridge]`；`plugin remove` 与 `marketplace remove` 正常卸载 | 已验证（临时配置） | codex-cli 0.162.0-alpha.17.2 | 同上 | 2026-10-15 | `mcp list` 显示 `zotero_bridge`（超时 10 / 30）；`hooks/list` 显示来源 `user` 的同一 Hook，无警告。旧版 MCP 注册操作 只写入临时 `config.toml`；真实 `~/.codex/config.toml` 不含本项目条目（同时运行的 Codex 桌面版在此期间自己改写过它一次）。 |
| I-C5 | Codex 桌面版真实环境：在 **Customize → Plugins → Add → New Plugin** 拖入 `zotero-reading-bridge-codex.zip`（[packages/codex/README.md](../packages/codex/README.md)），安装并启用后新对话中出现 19 个工具 | 未验证 | | | | 新名称安装包未验证。历史记录：改名前的桌面安装包（`zotero-reading-bridge-desktop.zip`）于 2026-10-17 导入成功。 |
| I-C6 | Codex 桌面版真实环境：“Review hooks” / “Trust all” 信任插件 Hook 后，新对话每轮带快照 | 未验证 | | | | |

## 8. 端到端（Codex）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| E-C1 | Codex：在 Zotero 中选中一篇论文，问“我当前在 Zotero 中选中的是哪篇论文？请给出 libraryID 和 key。”→ 不调用工具即答出正确标题和 libraryID + key | 未验证 | | | | |
| E-C2 | Codex：打开 PDF、翻到某页并选中一段文字，问“我选中的这段话是什么意思？在第几页？”→ 准确引用选中文字和页码标签 | 未验证 | | | | |
| E-C3 | Codex：“在我的文献库中找关于 <主题> 的论文，读取第一篇的 PDF 并总结方法”→ 依次调用 `search_items`、`get_attachment_path`，用 Codex 自己的工具读取 PDF，引用中给出 `zotero://select` 链接或 libraryID + key | 未验证 | | | | |

## 9. 每轮刷新（Codex）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| R-1 | 服务端：每次 `capture_prompt_context` 生成新的 `snapshotId`，`sequence` 严格递增，`capturedAt` 更新；Codex（`turn_id`）与其他客户端（`prompt_id`）的 id 组成正确（`tests/unit/snapshot.test.ts`、`npm run test:zotero`） | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/snapshot.test.ts` 30 通过；`npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 context.hook-sequence、context.hook-codex、context.hook-claude-code。 |
| R-2 | 服务端：关闭阅读器后的下一次快照不再包含 `reader`；空选择 → `status: "empty"`（`npm run test:zotero`） | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 context.reader-closed、context.empty。 |
| R-3 | 服务端：笔记在标签页中打开（Zotero 11 默认）时，快照的 `focus` 为 `note`，`note` 给出笔记及其父条目；隐藏的文献库标签页中的选择不作为焦点；状态行不会说“什么都没打开” | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero）；Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/snapshot.test.ts` 30 通过、`tests/unit/hook-output.test.ts`；运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 context.note-tab：文献库中选中另一篇条目后在标签页打开子笔记，快照 `focus: "note"`、`activeTab.type: "note"`、父条目正确，Hook 状态行为 “Focus: the note open in Zotero”。 |
| R-4 | 服务端：关闭主窗口、只留获得焦点的独立阅读器窗口时，快照仍为 `ok` 并包含阅读器（`unavailable` 只在没有任何可读窗口时出现）；读取阅读器条目超时只丢掉阅读器部分 | 未验证 | | | | 状态与焦点规则由 `tests/unit/snapshot.test.ts` 覆盖；真实 Zotero 中关闭主窗口的流程未自动化（会影响后续用例），需人工检查。 |
| R-C1 | Codex：选中论文 A 提问，再改选论文 B 问“那这篇呢？”→ 第二个回答切换到 B；两轮快照的 `snapshotId` 不同 | 未验证 | | | | |
| R-C2 | Codex：关闭 PDF 阅读器后再问“我在读哪篇？”→ 不再声称阅读器中打开着之前的 PDF | 未验证 | | | | |

## 10. 一致性

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| S-1 | 服务端：`/bridge/mcp` 与 `/codex/mcp` 对同一请求结果一致；`get_current_context` 与 `capture_prompt_context` 中的快照结构一致（`npm run test:zotero`、`tests/unit/snapshot-schema.test.ts`） | 通过 | Node.js 24.15.0；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `tests/unit/snapshot-schema.test.ts` 5 通过；`npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`），用例 protocol.alias-equality（两条路径结果一致），context.* 用例把两个工具返回的快照按同一 ContextSnapshot 结构断言。 |
| S-C1 | Codex：让模型分多点详细总结当前论文，回答生成期间在 Zotero 中改选另一篇 → 本次回答始终使用开始时的 libraryID + key；回答中的 key 与本轮快照一致 | 未验证 | | | | |
| S-X1 | 同一选择下，Codex 与 Claude 桌面应用报告的 libraryID + key、标题、页码一致 | 未验证 | | | | |

## 11. 失败继续（Codex）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| F-1 | 服务端：任何异常都不返回 5xx；“什么都没选中”或 Zotero 状态不可读时 `capture_prompt_context` 不返回 `isError`，而在 additionalContext 中说明；additionalContext ≤ 8000 字符，Codex 与未知客户端另 ≤ 9600 个 UTF-8 字节（Codex 约 10000 字节的转存阈值以内）（`tests/unit/hook-output.test.ts`、`tests/protocol/*`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/unit/hook-output.test.ts` 24 通过（2600 / 4000 个汉字的选区、3 / 5 条长中文批注在 Codex 预算下都 ≤ 9600 字节且 JSON 完整；Claude Code 预算下 4000 字的中文选区保持完整）、`tests/protocol/*` 114 通过；真实 Zotero 上 context.* 用例均满足 ≤ 8000 字符，非 Claude Code 客户端的 Hook 另满足 ≤ 9600 字节。 |
| F-C1 | Codex：Zotero 未运行时开始新会话并发送消息 → Hook 失败（`not connected`）但消息照常得到回答；模型说明当前 Zotero 状态未知，不引用旧快照 | 未验证 | | | | |
| F-C2 | Codex：会话中途退出 Zotero → 下一条消息 Hook 失败、对话继续；重新启动 Zotero 后记录同一会话是否恢复，新会话必须恢复 | 未验证 | | | | |
| F-C3 | Codex：在 Zotero 中禁用插件（**工具 → 插件**，端点 404）→ Hook 失败、对话继续；重新启用插件后恢复 | 未验证 | | | | |

## 12. 输入最小化（Codex）

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| M-1 | Codex 插件的 Hook 输入（`packages/codex/hooks/hooks.json`）只含 `client`、`session_id` 和 `turn_id`，不含 `${prompt}`、`${cwd}`、`${transcript_path}` | 已验证（静态检查） | — | Windows 11，开发机，仓库源码（只读） | 2026-10-17 | 阅读 `packages/codex/hooks/hooks.json`：`input` 只有 `client: "codex"`、`session_id`、`turn_id`。历史记录（2026-10-15）：当时由已删除的客户端清单测试检查通过（28 通过）。 |
| M-C1 | Codex：开启 Zotero 调试日志后发送一条含独特词语的消息，日志中 `capture_prompt_context` 请求只含上述参数（以及 Codex 自动附加的 `_meta.threadId`），搜索不到该词语 | 未验证 | | | | |
| M-2 | 插件自己的日志行（以 `[Zotero AI Bridge]` 开头）只含方法、工具名、状态码、字节数和耗时，不含标题、参数或响应内容 | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139），测试配置文件中开启 Zotero 调试输出（`-ZoteroDebugText`） | 2026-10-15 | T2（`npm run test:zotero -- --debug-output`，运行 20261015-125804-611a4d）中用例 harness.debug-log-privacy：全部用例结束后检查调试输出中的 580 行 `[Zotero AI Bridge]`，每一行都符合已知的摘要格式（请求方法、JSON-RPC 方法、工具名、状态、结果类别、字节数、耗时，以及启动 / 关闭行），没有任何一行含夹具中的标题、集合名、附件名或批注文字。T0（运行 20261015-103117-8c0161，`work/zotero-test/20261015-103117-8c0161/logs/zotero-stdout.log`）中 PowerShell 与当时客户端的请求（见 G-2）产生的 49 行同样只有摘要。Zotero 自己记录的请求头、请求正文、附件路径与数据库查询参数不在此项范围内（见 architecture.md 第 5 节）：T2 的调试输出中有 16 行 Zotero 自己的 `Attachment file '…' not found`（缺失附件的绝对路径与文件名），与文档的说明一致。 |

## 13. 通用 MCP 客户端（协议层）

服务端不依赖客户端名称（L-12）。本节只保留协议层的检查；G-3、G-4 对应的客户端集成已删除，编号不再使用。

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| G-1 | 通用 MCP 客户端（官方 TypeScript SDK，无 Hook）完成 initialize、tools/list（全部工具；记录时 18 个）、tools/call（`tests/protocol/sdk-client.test.ts`） | 通过 | Node.js 24.15.0，@modelcontextprotocol/sdk 1.32.1 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/protocol/sdk-client.test.ts` 38 通过 / 0 失败。 |
| G-2 | 用 PowerShell 原始 JSON-RPC 请求（写法与 [install-zotero.md](install-zotero.md) 第 5 节相同）对真实 Zotero 完成 initialize、tools/list、`get_current_context` | 通过 | PowerShell 7.6.6 与 Windows PowerShell 5.1.26100；Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | T0（运行 20261015-103117-8c0161，证据 `work/zotero-test/20261015-103117-8c0161/logs/zotero-stdout.log`，手动运行没有 report.json）：当时手动验收说明第 1 节的命令原样执行（只把 `$uri` 的端口改为 23139），选中一个中文标题的夹具条目后：两个 PowerShell 版本都得到 protocolVersion 2025-11-25、serverInfo.name zotero-ai-bridge；通知无输出；tools/list 18 个工具名；`get_current_context` 为 status ok、focus library，返回所选条目的 libraryID + key，中文标题完整（响应不带 charset，Windows PowerShell 5.1 也能正确得到中文，因为外层 JSON 已全部转义为 \uXXXX 而不受影响）。 |

## 14. 无 Hook 工作流（已删除）

原 W-1–W-5 针对通用无 Hook 技能，随该技能删除，编号不再使用。Claude 桌面应用的无 Hook 工作流见第 17 节 C-D4、C-D5。

## 15. 无 Hook PDF 阅读（已删除）

原 N-1–N-3 针对通用无 Hook 客户端，随之删除，编号不再使用。读取全文与附件的检查见第 5 节 A-8–A-12。

## 16. 只读

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| O-1 | 全部工具（当前 19 个，记录时 18 个）的注解都是 `readOnlyHint: true`、`destructiveHint: false`（`tests/unit/contract.test.ts`） | 通过 | Node.js 24.15.0 | Windows 11，开发机，仓库源码（Node 测试，不启动 Zotero） | 2026-10-15 | `tests/unit/contract.test.ts` 111 通过 / 0 失败。 |
| O-2 | 集成测试调用全部工具前后，测试数据库指纹（行数、最大修改时间、文献库版本）与附件文件完全一致（`npm run test:zotero`） | 通过 | Zotero 11.0-beta.1+b0db83d9d（Gecko 153.3.0） | Windows 11，开发机，独立测试实例（临时配置文件与数据目录 `work/zotero-test/<运行>/`，端口 23139） | 2026-10-15 | `npm run test:zotero` 运行 20261015-125642-ad25b2（T1，见第 0 节）：74 通过 / 0 失败 / 1 跳过（`work/zotero-test/20261015-125642-ad25b2/report.json`）；用例 lifecycle.read-only：阅读器打开、条目选中时调用 61 次工具，21 张表、最大值与 4 个附件文件前后一致。基线在界面操作之后取（Zotero 自己的阅读器打开 PDF 时会写数据库），只比较桥接调用前后。 |
| O-3 | 发布代码中没有 Zotero 写入 API：在仓库根目录执行下面的扫描，除注释和 `linkModeToName`（只读的名称转换）外没有命中 | 已验证（静态检查） | — | Windows 11，开发机，仓库源码与最终 XPI | 2026-10-15 | 集成时对最终代码重新执行下面的扫描：只命中 `src/zotero/attachments.ts` 中的一行注释和 `Zotero.Attachments.linkModeToName`；对最终 XPI 中的三个脚本执行同一扫描，只命中 `linkModeToName`。 |
| O-4 | 真实文献库：完成第 8–12 节与第 17 节的手动验收后，所用条目在 Zotero 中的“修改日期”未变化，没有新增条目、笔记或标签 | 未验证 | | | | |

O-3 使用的扫描命令（Git Bash）：

```bash
grep -rnE "\.(saveTx|save|eraseTx|erase|setField|setNote|setCreators|addTag|removeTag|setTags|addToCollection|removeFromCollection|relinkAttachmentFile|renameAttachmentFile|downloadFile)\(|Zotero\.DB\.[A-Za-z]+\(|Zotero\.File\.(putContents|putContentsAsync|createDirectoryIfMissing|removeIfExists)|Zotero\.Sync|IOUtils\.(write|remove|move|copy|makeDirectory)|Zotero\.Attachments\.(import|link|create|download)" \
  packages/zotero/src packages/zotero/bootstrap.ts packages/zotero/content/preferences.ts
```

## 17. Claude 桌面应用（无 Hook，stdio 中继）

步骤见 [packages/claude-desktop/README.md](../packages/claude-desktop/README.md)。中继程序（`shared/relay/`，与 Codex ZIP 共用）本身的行为由
`npm test` 中的中继单元测试与协议测试、产物校验中的中继检查覆盖（第 1 节 B-2、B-5）；本节记录真实 Claude 桌面应用（聊天与 Cowork）中的结果。
下表的历史记录使用改名前的安装包与名称（Zotero AI Bridge）。

| 编号 | 检查项 | 状态 | 客户端版本 | 执行位置 | 日期 | 证据 |
|---|---|---|---|---|---|---|
| C-D1 | 安装 `outputs/zotero-reading-bridge-claude-desktop.mcpb`（记录时为 `zotero-ai-bridge-claude-desktop.mcpb`；**设置 → 扩展**），接受清单（`manifest_version` 0.2、`server.type: node`、可选端口设置），扩展显示为运行中 | 通过 | Claude 桌面应用 2.42304.0（Windows） | Windows 11，开发机，真实安装（Zotero 11.0-beta.1，端口 23119） | 2026-10-16 | 通过 **设置 → 扩展** 的 Install extension 安装（未签名扩展，组织 can_install 检查通过）；**设置 → 开发者** 显示 “Zotero AI Bridge / Running / This server is managed by an extension”，命令 `node <扩展目录>/server/zotero-relay.js --port 23119`。MCP 日志（`%LOCALAPPDATA%Claudelogsmcp-server-Zotero AI Bridge.log`）：使用自带 Node.js，`server/discover` 400 → initialize 200 → 202 → tools/list 200。 |
| C-D3 | 新对话的“搜索和工具”菜单中出现全部工具（当前 19 个，记录时 18 个）；调用 `get_status` 成功；Zotero 调试日志中请求的 User-Agent 为 `zotero-ai-bridge-relay/<版本>`，没有 `origin:` 头 | 未验证 | Claude 桌面应用 2.42304.0（Windows） | Windows 11，开发机，真实安装（Zotero 11.0-beta.1，端口 23119） | 2026-10-16 | 部分完成：连接器菜单中出现 Zotero AI Bridge 开关，桌面应用日志 `replaceEnabledMcpTools ... toolCount=18`；`get_status` 返回 bridge 0.1.0、running、loopbackVerified，中继日志 `tools/call -> 200`。Zotero 调试日志中的 User-Agent / Origin 检查尚未做。注意：说“调用 get_status”时，Code 标签页的模型可能调用桌面应用自带的同名工具（PR 状态），测试时要写明 “Zotero AI Bridge 的 get_status”。 |
| C-D4 | 无 Hook 工作流：说“我当前在 Zotero 中选中的论文”时模型调用 `get_current_context` 并使用返回的 libraryID + key；改选后再问“那这篇呢？”会重新调用 | 未验证 | | | | |
| C-D5 | 失败继续：打开 Claude 桌面应用时 Zotero 未运行 → 服务器显示失败、对话照常；会话中途退出 Zotero → 工具调用返回 `Cannot reach the Zotero AI Bridge` 错误，Zotero 重新启动后下一次调用成功；在 Zotero 中禁用插件 → 错误提示 **Tools > Plugins** | 未验证 | | | | |
| C-D6 | Cowork 中能否使用同一个扩展 / 手动配置的服务器 | 通过 | Claude 桌面应用 2.42304.0（Windows） | Windows 11，开发机，真实安装（Zotero 11.0-beta.1，端口 23119） | 2026-10-16 | 扩展可用，但**第一条消息没有拿到工具**：扩展安装（20:38）后新建的 Cowork 任务（20:45）启动时 `mcpServerStatus` 的 14 个带工具服务器中没有 Zotero AI Bridge，模型回答“没有 get_status 工具”；在同一任务中继续对话后（20:47 起）中继日志出现多次 `tools/call -> 200`，用户确认可用。原因（任务启动时的工具列表未包含刚装的扩展，还是工具延迟加载）未确定。手动配置的服务器未测。 |
| C-D7 | 中继不监听端口：Claude 桌面应用运行、扩展已启用时，`netstat -ano` 中中继进程（`node` 子进程）没有 LISTENING 行，只有到 `127.0.0.1:23119` 的连接 | 未验证 | | | | |
