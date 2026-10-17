# 架构与设计决策

## 1. 总览

Zotero Reading Bridge 只维护三个插件：Zotero 插件（XPI）、Codex 桌面插件（ZIP）和 Claude 桌面应用扩展（MCPB）。Zotero 插件在
Zotero 自带的本机 HTTP 服务器上注册一个无状态的 MCP 端点；两个客户端插件都内置同一个 stdio↔HTTP 子进程中继
`server/zotero-relay.js`（源码 `shared/relay/`），经它调用端点（决策 22）。所有工具只读。服务端不依赖客户端名称，任何 MCP 客户端都能直接用 HTTP 调用端点，
但只有上述两个客户端插件随项目发布和测试。

```
同一台电脑
│
├─ Codex 桌面插件 zotero-reading-bridge（outputs/zotero-reading-bridge-codex.zip）
│    ├─ 技能 zotero（zotero-reading-bridge:zotero）
│    ├─ MCP 服务器 zotero_bridge = stdio 子进程 zotero-relay.js ─┐
│    └─ UserPromptSubmit Hook → zotero_bridge                    │
│                                                                │   POST http://127.0.0.1:23119/bridge/mcp
├─ Claude 桌面应用扩展（聊天与 Cowork，无 Hook）                   │   （仅提供 /bridge/mcp）
│    └─ stdio 子进程 zotero-relay.js ─────────────────────────────┤
│       （outputs/zotero-reading-bridge-claude-desktop.mcpb）      │
│                                                                ▼
└─ Zotero 11 进程
     Zotero.Server（Zotero 自带，只监听 127.0.0.1）
       ├─ Zotero 自身检查：Host 头、拦截 Origin / Mozilla UA 请求、JSON 解析
       └─ BridgeEndpoint.init(req)            packages/zotero/src/server/endpoint.ts
            └─ handleMcpHttp(req, ctx)        packages/zotero/src/server/mcp.ts（纯函数，可在 Node 中测试）
                 ├─ 访问检查                   src/server/access.ts（Origin → 403，Host / 端口 → 403）
                 ├─ JSON-RPC：initialize / ping / tools/list / tools/call / notifications
                 └─ 工具注册表                 src/tools/registry.ts + shared/contracts/tools.json
                      ├─ 数据工具（17 个）      src/tools/{libraries,collections,items,content,attachments,schema,status}.ts
                      └─ 上下文工具（2 个）     src/tools/context.ts + src/context/*
```

## 2. 代码结构

| 路径 | 内容 |
|---|---|
| `shared/contracts/tools.json` | 19 个工具的定义（名称、说明、输入 JSON Schema、只读注解），`tools/list` 与参数校验的唯一来源 |
| `shared/types/` | 协议常量、工具结果类型、上下文快照类型、Hook 约定、端点与端口常量 |
| `shared/instructions/` | 给模型的英文说明：`context-policy.md`（`server-instructions` 与 `hook-rules` 两个段落）、`research-workflow.md`；`sections.ts` 按 `<!-- BEGIN:名称 -->` / `<!-- END:名称 -->` 提取段落 |
| `packages/zotero/` | Zotero 插件：`bootstrap.ts`（生命周期）、`src/main.ts`（启动 / 关闭）、`src/server/`（HTTP 适配、MCP 协议、访问检查、响应、参数校验）、`src/tools/`（工具实现）、`src/context/`（界面状态快照与 Hook 输出）、`src/settings/` 与 `content/`（设置页面）、`locale/`（界面文字） |
| `shared/relay/` | 零依赖的 stdio↔HTTP 中继 `relay.ts`、`main.ts`；构建时只打包一次为 `server/zotero-relay.js`，同时放入 Codex ZIP 和 MCPB（决策 22） |
| `packages/codex/` | Codex 桌面插件：`.codex-plugin/plugin.json`、`.mcp.json`（stdio：`node ${PLUGIN_ROOT}/server/zotero-relay.js`）、`hooks/hooks.json`、`skills/zotero/SKILL.md`、`assets/icon.svg`、`README.md`（安装说明）。构建时另行生成可移植布局的 `plugin.json` / `mcp.json` 副本并加入中继，产物 `outputs/zotero-reading-bridge-codex.zip` |
| `packages/claude-desktop/` | Claude 桌面应用扩展：`manifest.json`（MCPB）与 `README.md`（安装说明），产物 `outputs/zotero-reading-bridge-claude-desktop.mcpb` |
| `scripts/build.ts`、`scripts/verify-package.ts` | 类型检查、打包（一次生成三个插件、`SKILL.md`、`updates.json` 与 `BUILD-INFO.json`，随后自动校验）、产物校验 |
| `tests/unit`、`tests/protocol` | Node 单元测试与协议测试（含模拟 Zotero 服务器怪癖的 HTTP 服务器和官方 MCP SDK 客户端） |
| `tests/zotero` | 在独立的 Zotero 测试配置文件中运行的集成测试 |

版本号、作者、许可证与关键词只在根目录 `package.json` 中维护，构建时写入 Zotero 清单、Codex `plugin.json` 和 MCPB `manifest.json`。

模型看到的说明文字只维护一份：`context-policy.md` 的 `server-instructions` 段落作为 MCP `initialize` 的 `instructions`，
`hook-rules` 段落随每轮快照注入；Codex 插件的技能文件在构建时通过 `<!-- @include ... -->` 展开 `research-workflow.md` 和
`context-policy.md` 全文。

## 3. 每轮上下文（Hook）流程

```
用户发送消息
 → Codex 触发 UserPromptSubmit Hook（mcp_tool 类型，超时 5 秒），经 stdio 中继转发
 → tools/call capture_prompt_context
     Codex:       {"client":"codex","session_id":"…","turn_id":"…"}
     （协议同时接受可选的 prompt_id，供只有提示 id 的客户端使用：{"client":"<名称>","session_id":"…","prompt_id":"…"}）
 → Zotero 插件读取界面状态（约 2.5 秒内完成，绝不等待冷加载；只有查找阅读器 / 笔记条目的一步可能等待数据库，
   超时只丢掉这一步并在 unavailableReason 中说明，活动标签页与条目列表的选择照常保留）：
     活动标签页；集合树选中的文献库 / 集合 / 保存的搜索；条目列表中选中的条目（最多列出 10 个，数量精确）；
     阅读器（标签页或独立窗口）：附件、父条目、页码、选中文字、选中的批注；
     笔记（主窗口的笔记标签页，Zotero 11 默认如此打开笔记；或独立笔记窗口）：笔记与父条目；
     主窗口已关闭时只读取获得焦点的独立阅读器 / 笔记窗口
 → 组装快照：status = ok | empty | unavailable；focus = reader | note | library | none
     （获得焦点的独立阅读器 / 笔记窗口优先，其次是活动标签页中的阅读器 / 笔记；只有文献库标签页在前台时，选中的条目才是焦点：
     笔记或阅读器标签页在前台时，条目列表的选择属于隐藏的文献库标签页；前台标签页的内容读不到时 status 仍为 ok、focus 为 none，
     不会声称“什么都没打开”）；
     snapshotId = 客户端 / s:会话 id / t:turn_id（Codex）或 p:prompt_id / n:进程内递增序号 / 采集时间，
     例如 codex/s:…/t:…/n:12/20261014T221200123Z；序号随 Zotero 重启归零，采集时间保证跨重启仍唯一
 → 生成 additionalContext：一行标题（本条消息的 snapshotId、capturedAt、status）+ 状态说明 + hook-rules
     + 不可信数据声明 + <zotero_snapshot>紧凑 JSON</zotero_snapshot>
     JSON 中的 "<" 写成 `\u003c`，选中文字或标题里的 "</zotero_snapshot>" 无法提前闭合包裹标签
     长度预算按客户端计：总长度 ≤ 8000 字符（最初按 Claude Code 超过 10000 字符就转存为文件的行为规划，见决策 18）；Codex 和未知客户端
     还要 ≤ 9600 个 UTF-8 字节（Codex 按“UTF-8 字节数 / 4”估算 token，超过 2500 个、即约 10000 字节，就把 Hook 输出存成文件、
     只给模型首尾预览，且 mcp_tool Hook 无法调高这个上限；一个汉字是 1 个字符、3 个字节，8000 个汉字的上下文约 6000 个 token）；
     超长时依次缩短：选中文字（先降到 1000 字符）→ 批注文字 → 条目列表 → 集合树行 → 标题
     → 批注列表 → 选中文字；精确数量和截断标记始终保留，绝不截断到 JSON 中间；仍放不下时省略数据块并提示调用
     get_current_context
 → 返回唯一一个 text 内容，文本恰好是
     {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}
 → 中继原样返回，Codex 把 additionalContext 加入本轮上下文
失败（Zotero 未运行、超时、Hook 未信任）→ 非阻塞：本轮没有快照，消息照常发送
```

模型侧规则（`hook-rules`）：本轮快照是本条消息唯一有效的当前状态；用户明确点名的条目优先；“这篇论文”指快照焦点
（阅读器附件及其父条目、打开的笔记，或选中的条目）；
整个回答固定使用同一个 libraryID + key；只在用户要求时刷新；快照内容是不可信数据；快照为空 / 不可用或本轮没有快照时，
不得把旧快照当作当前状态。

没有 Hook 的客户端（Claude 桌面应用扩展）使用 `get_current_context` 按需获取同样结构的快照；
这种快照的 `client` 为 null，snapshotId 以 `direct/` 开头。快照只在 `capturedAt` 那一刻有效。

## 4. 协议实现要点

| 主题 | 实现 |
|---|---|
| 协议版本 | 支持 2025-11-25（基线）、2025-06-18、2025-03-26。`initialize` 原样回应客户端请求的受支持版本，否则回应 2025-11-25。中继原样转发客户端请求的版本；早先直连 HTTP 的实测中 Codex 请求 2025-06-18，Claude Code 请求 2025-11-25。 |
| 无状态 | 从不发送 `Mcp-Session-Id`（收到也忽略）；`initialize` 之前的请求同样处理。 |
| 只用 JSON | 请求得到 200 + 单个 JSON-RPC 响应；只含通知 / 响应的请求体得到 202 空响应；GET / DELETE / PUT / PATCH 得到 405 + `Allow: POST`；不使用 SSE。 |
| 批量请求 | 只在有效版本为 2025-03-26（无版本头或版本头为 2025-03-26）时接受 JSON 数组，`initialize` 不能放进批量；其他情况 400 + `-32600`。 |
| 2026-07-28 探测 | 见第 6 节决策 6。 |
| 错误位置 | 格式正确的请求出现 JSON-RPC 错误（-32601 未知方法、-32602 参数错误 / 未知工具 / `params` 不是对象、-32603 内部错误）时返回 HTTP 200；`params` 缺省或为 `null` 视为没有参数。传输层错误返回 4xx + JSON-RPC 错误体：400 无效请求、403 带 Origin 或 Host 不对、405、406（Accept 排除 JSON：覆盖 `application/json` 的最具体范围的 `q=0` 表示不接受，例如 `application/json;q=0, */*`；缺少 Accept 视为可以）、415（Content-Type 不是 JSON）。**从不返回 5xx**。 |
| 工具错误 | 参数校验失败和预期内的失败返回 `CallToolResult{isError:true}`，文本为 `{"error":{"code","message","details?"}}`；处理函数内的意外异常也转换成 `INTERNAL` 工具错误，日志只记录异常类型。 |
| 工具结果 | 每个结果只有一个 text 内容，内容是普通的 `JSON.stringify` 文本（`capture_prompt_context` 是 Hook JSON）；所有工具都不声明 `outputSchema`，也不返回 `structuredContent`。 |
| 响应格式 | `Content-Type: application/json`（小写）、非空响应的 `Content-Length` 为字节长度、`Connection: close`；JSON-RPC 外层把所有非 ASCII 字符转义为 `\uXXXX`，因此字节长度等于字符长度，孤立的代理项也保持合法。 |
| 状态短语 | Zotero 的 `responseCodes` 表缺少 202 / 405 / 406 / 415，插件仅在缺失时补上，关闭时只删除自己补上且未被改动的条目。 |
| 日志 | 每个响应都传 `logFilter`，Zotero 调试日志中只出现 `"[Zotero Reading Bridge] response <状态> (<n> bytes, body redacted)"` 之类的摘要。 |

## 5. 安全边界：本机可访问、只读

**只读**

- 所有工具只调用读取类 Zotero API；没有任何写入（不保存、不删除、不改字段、不执行 UPDATE / INSERT / DELETE、不写文件、不触发同步、不下载附件）。
- `get_attachment_path` 只返回路径和是否存在；读取附件文件本身（PDF、EPUB、网页快照）由客户端自己的文件工具完成，桥接从不返回附件文件。
  桥接只返回 Zotero 自己生成的派生数据：`get_fulltext` 读全文索引缓存（`.zotero-ft-cache` / `.zotero-ft-unprocessed`），
  `get_annotations` / `get_current_context` 读图片批注的缓存图（`cache/library/<KEY>.png`）；都只读文件，不触发索引、提取或渲染（决策 23、24）。
- 19 个工具的注解都是 `readOnlyHint: true`、`destructiveHint: false`（单元测试检查）。

**只在本机可访问**

- Zotero 的 HTTP 服务器只监听 IPv4 回环地址 `127.0.0.1`（Zotero 源码：`serv.start(port)` → `_start(port, "localhost")` → 回环套接字）。
  插件在注册端点前检查 Zotero 的服务器启动代码确实如此；检查失败就不注册（状态 `loopback-unverified`）。
- Host 头：HTTP/1.1 请求中，Host 不是 httpd 的身份（`127.0.0.1:<端口>` / `localhost:<端口>`）时由 Gecko 的 httpd 以通用的
  400 拒绝（正文为 `Bad request`；外部主机名、端口不符、`[::1]` 都在此列，到不了 Zotero 和插件）；HTTP/1.0 请求跳过这一检查，Zotero 自己再
  拒绝 Host 不是 `127.0.0.1` / `[::1]` / `localhost` 的请求（`400 Invalid Host header`，防 DNS 重绑定），但不检查端口。
- 浏览器请求：Zotero **直接断开**大多数带 `Origin` 头或以 `Mozilla/` 开头 User-Agent 的请求，但**不是全部**：同时带
  `X-Zotero-Connector-API-Version` 或 `Zotero-Allowed-Request` 头的请求会跳过这项检查，而且 Zotero 对 `https://www.zotero.org`
  （`ZOTERO_CONFIG.BOOKMARKLET_ORIGIN`）回应 CORS 预检并允许 `Content-Type`、`X-Zotero-Connector-API-Version` 两个请求头。因此该站点上
  的脚本（或那里的 XSS）可以发出能到达插件端点的 JSON POST。插件不设置 `allowRequestsFromUnsafeWebContent`。
- 插件自身的检查（`access.ts`）：只要带 `Origin`（包括 `"null"`）就返回 403；Host 必须是 `127.0.0.1` / `localhost` /
  `[::1]` 且端口等于 Zotero 实际端口，否则 403。**Origin 规则是上面那类请求唯一的屏障，必须保留**（DESIGN 决策 11 原先把这一层
  称为“纵深防御”，以为 Zotero 会断开所有带 Origin 的请求，这一判断不完整，见第 6 节决策 17）。端口规则只在 HTTP/1.0 请求中起作用。
  插件从不发送 CORS 头；Zotero 只对 `https://www.zotero.org` 附加它自己的 CORS 头，页面因此只能读到插件的 403 错误。集成测试
  protocol.bookmarklet-origin 用这个来源与 `X-Zotero-Connector-API-Version` 头实测为 403。
- 不修改 Zotero 或 Zotero Connector 的任何首选项，也不修改端口。

**但本机上的任何程序和任何用户都能读取**

- 端点没有身份验证。本机任何程序（包括其他 Windows 用户账户下的程序、恶意软件）只要能连上 `127.0.0.1:23119`，
  就能读取整个文献库的元数据、笔记、批注和附件路径。只在你信任的电脑上启用；要停止桥接，在 Zotero 中禁用插件（**工具 → 插件**）。
- **绝不**通过局域网、端口转发、反向代理、内网穿透、隧道或监听端口的中继暴露这个端口（Zotero 的 Host 检查也会拒绝外部主机名）。
  两个客户端插件内置的 stdio 中继不监听端口，不扩大可访问范围（决策 22）。

**反方向同样没有验证：本机程序可以冒充桥接**

- 中继连接的是固定的 `http://127.0.0.1:23119/bridge/mcp`，服务器不出示任何凭据。Zotero 未运行、HTTP 服务器关闭或绑定失败时，
  这个非特权端口是空闲的，本机任何程序（包括其他 Windows 用户账户下的程序）都可以监听它。客户端启动时会连到这个程序：
  它提供的 `initialize` 说明和工具说明进入模型上下文，而且 Codex 插件的 `UserPromptSubmit` Hook 在**每个项目、每一条消息**上
  调用它的 `capture_prompt_context`，把返回的整段文字（包括它自己写的“规则”，不在 `<zotero_snapshot>` 不可信数据包裹之内）作为
  附加上下文交给模型；模型可能照着执行命令。Hook 发出的只有会话 / 轮次 id。
- 令牌解决不了这个问题：客户端发给服务器的令牌只能证明客户端的身份；服务器不出示可验证的凭据，客户端就无法分辨真假 Zotero。
  因此首版只在文档、设置页和插件说明中写明风险与使用方式：**多人共用的电脑上不要安装客户端插件（尤其不要信任它的 Hook）**，
  先启动 Zotero 再启动客户端，不用时卸载。

**隐私**

- Hook 只发送客户端名和会话 / 轮次 id，不发送提示词、工作目录或对话记录路径。
- 插件自己的日志只记录 HTTP 方法、JSON-RPC 方法名、工具名、状态码、字节数和耗时，不记录参数、选中文字、笔记或标题。
- **Zotero 自身**在开启“帮助 → 调试日志”时会记录：每个请求的全部请求头和请求正文的前 1000 个字符；工具调用触发的 Zotero 内部
  日志，其中有附件的绝对路径和文件名（例如文件缺失时 `Attachment file '<路径>' not found`，路径含 Windows 用户名，文件名通常是
  “作者 - 年份 - 标题.pdf”）、每条数据库查询的全部参数（例如 `get_attachment_path` 选最佳附件时的条目网址、检索条件的值）、全文检索的
  检索词与缓存文件路径。这些都不在插件的控制范围内：与 AI 客户端一起使用时关闭调试日志，分享或提交日志前逐行检查。
- 快照、笔记、批注和 PDF 选中文字可能包含第三方写入的文字，模型说明中统一标记为不可信数据（防提示注入），并限制长度。

## 6. 关键决策

1. **Codex 插件布局**：使用 Codex 的兼容布局 `.codex-plugin/plugin.json` + `.mcp.json` + `hooks/hooks.json` + `skills/zotero/SKILL.md`。
   原因：Codex 0.162 只有在根目录 `plugin.json` 带 agent-plugins.org 的 `$schema` 时才读取它，否则静默忽略（实测版本号为 null）；
   而带 `$schema` 的可移植布局中 `mcp.json` 的服务器条目只允许 `type` / `url` / `headers`，不能设置超时。兼容布局是所有官方插件采用的格式。
   源码只维护兼容布局；构建时由它派生可移植布局的 `plugin.json` / `mcp.json` 副本，并把共用中继放入 `server/zotero-relay.js`，
   `.mcp.json` 的服务器是 stdio 命令 `node ${PLUGIN_ROOT}/server/zotero-relay.js`（决策 22）。
2. **Codex 服务器名 `zotero_bridge`**：Codex 中插件服务器与 `config.toml` 的 `[mcp_servers.*]` 共用一个命名空间，且 `config.toml`
   优先级更高。用户常已有 `[mcp_servers.zotero]`（其他 Zotero MCP 服务器），会截走 Hook 调用。项目不再提供手动配置；
   旧安装残留的同名 `config.toml` 条目会让插件 `.mcp.json` 被忽略，文档只把这一点作为排查依据。
3. （已移除：Claude Code 插件已停止维护。）
4. **Hook 输入最小化**：Codex 有 `${turn_id}`，没有 `${prompt_id}`，遇到不存在的占位符会让 Hook 失败，因此 Hook 定义只用 Codex 自己的
   占位符。输入只含 client、session_id 和 turn_id；整数超时 5 秒、`statusMessage`，不写 `onFailure` 和 `matcher`。服务端协议另接受
   可选的 `prompt_id`，供只有提示 id 的客户端使用。
5. **Hook 输出**：只返回一个 text 内容，文本恰好是 `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}`，
   没有任何其他键（Codex 对多余键直接判定失败）；没有选中内容或 Zotero 不可用时也不返回 `isError`，而是在 additionalContext 中说明；
   additionalContext ≤ 8000 字符，Codex 与未知客户端另限 9600 个 UTF-8 字节（见决策 18）；所有工具都不声明 `outputSchema`。
6. **2026-07-28 探测**：最新的 MCP 规范 2026-07-28 用 `server/discover` 代替 `initialize`。Claude Code 对 HTTP 服务器默认先发这个探测
   （Codex 在实验开关下也会）。本桥接只实现基于 `initialize` 的版本，对探测回应 **HTTP 400 + JSON-RPC 错误 -32601，并回显请求 id**；
   其他带不支持的 `MCP-Protocol-Version` 头的非 initialize 请求回应 400 + -32600。原因：当时实测的 Claude Code 与 Codex 只有在收到这种“方法不存在”的
   回应时才会回退到 `initialize`；401 / 403 / 5xx / 超时 / 断开连接都会让连接直接失败。
7. **无状态、只用 JSON**：见第 4 节。Zotero 的服务器是每个请求一个连接（HTTP/1.0），不适合长连接和 SSE。
8. **从不返回 5xx**：Zotero 自身在 `init` 抛出异常时会写出格式错误的 500；Codex 把 500 / 502 / 503 / 504 当作可重试的传输失败，
   Claude Code 的探测分类器把 ≥ 500 当作硬失败。因此所有异常都被捕获并转换为 200 + -32603 或工具错误。
9. **响应字节**：Zotero 只在响应体为空时自动加 `Content-Length: 0`，并以 HTTP/1.0 关闭连接；插件给每个非空响应自行设置
   `Content-Length` 并把非 ASCII 转义，避免依赖“读到连接关闭”的分帧方式（202 空响应不重复设置，以免出现两个同名头）。`Content-Type` 用小写，因为 Codex 区分大小写匹配。
10. **端点注册**：`/bridge/mcp` 指向端点类，`init(req)` 只声明一个参数（Zotero 据此选择调用约定），
    永不抛出异常；插件启动时（Zotero 的 HTTP 服务器在运行且已确认只监听回环地址）注册一次，关闭插件时注销，且只删除仍指向本插件类的路径。
    桥接没有自己的开关：要停止它，在 Zotero 中禁用插件（**工具 → 插件**），端点随之注销。
11. **端口**：使用 `Zotero.Server.port` 的实际值；修改端口需要重启 Zotero，插件不修改 `httpServer.*` 首选项。
12. **Zotero 11 API**：单数形式的选择 getter（如 `getSelectedCollection`）在 11.0 beta 上会抛出异常，改用复数形式；条目数据延迟加载，
    后台在界面就绪后按顺序预热；Hook 路径绝不等待冷加载，读不到时返回部分快照并给出警告。
13. **本地化文件名**：使用 `locale/en-US/zotero-reading-bridge.ftl` 与 `locale/zh-CN/zotero-reading-bridge.ftl`，所有消息 id 以 `zotero-reading-bridge-` 开头。
14. **清单**：`manifest_version: 2`，`applications.zotero.id = zotero-reading-bridge@volatile.static`，`strict_min_version: 10.0`
    （允许 Zotero 10 正式版及 11.0 beta 安装）、`strict_max_version: 11.*`；`update_url` 指向
    `https://github.com/volatile-static/zotero-reading-bridge/releases/latest/download/updates.json`。
    构建从 XPI 清单和实际安装包生成更新清单，包含版本、兼容范围、固定版本下载地址与 SHA-256，并随 Release 上传。
15. （已移除：Claude Science 与通用无 Hook 技能已停止维护。）
16. **不声明 `outputSchema`**：MCP 规定声明了 `outputSchema` 的工具在每个成功结果中都必须带符合该 Schema 的 `structuredContent`，
    客户端（例如官方 TypeScript SDK）会校验，不符合就把整个调用当作失败；而 Hook 路径只读取 text 内容，忽略
    `structuredContent`。只返回 JSON 文本可以让模型、Hook 和所有客户端看到同一份内容，也避免列表类结果必须包一层对象的限制。
    （决策 23 修订：第一个内容始终是完整的 JSON 文本，其后可以追加正文 text 与 image 内容；Hook 输出仍只有一个 text。）
17. **Origin 403 是必需的一层（修正 DESIGN 决策 11）**：DESIGN 原来认为 Zotero 会断开所有带 `Origin` 或浏览器 User-Agent 的请求，
    插件的检查只是纵深防御。Zotero 11 源码表明，带 `X-Zotero-Connector-API-Version` 或 `Zotero-Allowed-Request` 头的请求跳过这项检查，
    且 Zotero 为 `https://www.zotero.org` 回应 CORS 预检，所以该站点的脚本可以把 JSON POST 送到插件。插件的 Origin 规则因此是这类
    请求唯一的屏障：保留它，永不设置 `allowRequestsFromUnsafeWebContent`（`access.ts` 注释与集成测试 protocol.bookmarklet-origin）。
18. **Hook 上下文按客户端计量**：原设计只按 Claude Code 的“10000 字符”规划了 8000 字符的上限。Codex 对 mcp_tool Hook 的附加上下文
    固定使用约 2500 token 的转存阈值（`additionalContextLimit` 只能用于 command Hook），并按“UTF-8 字节数 / 4”估算 token，即约
    10000 字节；中文选区 2600 字左右就会超过，Codex 会把全文写入临时文件、只给模型首尾预览，JSON 被从中间截断。因此
    `capture_prompt_context` 按 `client` 选择预算：`claude-code`（历史客户端名，协议仍识别）只限 8000 字符；`codex` 和未知客户端另限 9600 个 UTF-8 字节
    （`SNAPSHOT_LIMITS.hookContextUtf8Bytes`），缩短顺序不变，JSON 始终完整。
19. **列表结果缓存**：分页游标只是偏移量，`search_items`、`run_saved_search`、`get_collection` 与 `list_tags` 每翻一页都要重新检索、
    排序或遍历全部条目，在 Zotero 主线程上运行。插件按“文献库 + 规范化请求”在内存中缓存排好序的条目 id 与标签计数（每类最多 8 / 4 项，
    120 秒过期），并注册 Zotero Notifier 观察器：条目、集合、集合成员、保存的搜索、标签、回收站、群组有任何变化（包括全文索引
    更新）都立即清空缓存。观察器注册失败时缓存保持关闭，每次调用重新计算。缓存只在内存中，不写入任何东西。
20. **快照焦点与笔记**：Zotero 11 默认在主窗口标签页中打开笔记。快照增加 `note`（笔记标签页或获得焦点的独立笔记窗口：笔记与父条目）
    和 `focus: "note"`；前台是笔记 / 阅读器 / 其他标签页时，条目列表的选择属于隐藏的文献库标签页，不再作为焦点，也不会报告
    “什么都没打开”。关闭主窗口后，独立阅读器 / 笔记窗口仍可被读取。读取阅读器或笔记条目超时时，只丢掉这一部分，保留其余快照。
21. **全文检索不回退到逐文件扫描**：Zotero 的全文索引无法回答 3 个字母以下的单词、单个汉字和中英文 / 数字混合的词；对加引号的这类词，
    Zotero 会逐个读取文献库中所有附件的全文缓存（大型文献库要几分钟，客户端超时后仍在运行）。`search_items` 在 `fulltext` 模式下
    （以及 `everything` 模式中加了引号的词）对这类词直接返回 `INVALID_ARGUMENT` 并逐个说明原因，而不是悄悄忽略或强制扫描。
22. **两个客户端插件都经 stdio 子进程中继接入，不扩大暴露面**：Claude 桌面应用的本地 MCP 服务器和扩展（`.mcpb`）只能是 stdio 命令，
    远程连接器只接受公网 https 地址，无法直接使用 `http://127.0.0.1:23119/bridge/mcp`。因此提供零依赖的 Node 中继
    `shared/relay/relay.ts`（入口 `shared/relay/main.ts`）：从 stdin 逐行读取 JSON-RPC，原样 POST 给桥接，把 JSON 响应写成一行输出
    （202 不输出），Zotero 不可达或回答非 JSON 时对每个请求回 `-32000` 错误。构建时只打包一次为 `server/zotero-relay.js`，
    同时放入 MCPB 和 Codex ZIP；Codex 插件也用它作为 stdio 服务器，两个安装包因此共用同一份连接代码。它**不**改变第 5 节的安全边界：
    - 中继是客户端启动的子进程，只通过自己的 stdin / stdout 管道与父进程通信，**不打开任何监听端口**，也就没有新的入口。能驱动它的只有
      启动它的那个进程；而能启动本机进程的程序本来就能直接连接 `127.0.0.1:23119`。所以它与客户端直接发 HTTP 请求等价。
    - 隧道、端口转发、反向代理和**监听端口的中继**仍然禁止：它们打开新的可连接入口（局域网、公网或另一个回环端口），把无鉴权的
      文献库交给更多的程序或机器。早先文档中“不提供本地中继进程”指的正是这一类。
    - 目标主机写死为 `127.0.0.1`，只有端口可配置；`--host` 只接受 `127.0.0.1`，其他值（`localhost`、`::1`、`0.0.0.0`、局域网地址）直接
      以退出码 2 结束。使用专用的 `http.Agent`，不读取代理环境变量；请求不带 `Origin`，User-Agent 为 `zotero-reading-bridge-relay/<版本>`，
      所以 Zotero 与插件的 Origin / 浏览器检查（决策 17）照常生效。
    - 中继不做协议处理（不解析参数、不缓存、不发 `Mcp-Session-Id`），只在 `initialize` 成功后把协商的版本放进 `MCP-Protocol-Version`
      头；日志只写方法名和 HTTP 状态。冒充风险（第 5 节）不变：Zotero 未运行时占用端口的程序同样能回答中继。
    产物校验（`npm run build` 末尾自动运行，也可用 `npm run verify` 单独运行）检查两个安装包中的中继只引用 `node:` 内置模块、
    不含 `createServer` / `listen`、不设置 `Origin`，并实际运行它。
23. **图片批注默认附带图像，工具结果可以有多个内容（修订决策 16）**：用户选中图片批注，就是要让模型看图。`get_annotations`
    （`includeImages` 默认 true）与 `get_current_context`（选中的图片批注）读取 Zotero 渲染时写下的
    `<数据目录>/cache/library/<KEY>.png`（`Zotero.Annotations.getCacheImagePath`），以 MCP image 内容追加在 JSON 之后。
    第一个内容始终是完整的 JSON 文本：每条图片批注的 `image` 字段（`get_current_context` 为第二个 text 中的
    `selectedAnnotationImages`）说明缓存路径、是否存在、是否附带及原因，不支持图像的客户端也不丢信息。取图失败（未渲染、读取出错、
    单张超过 2 MB 或本次合计超过 6 MB）只退回元数据，不报错；不调用渲染接口，缺图保持缺图（渲染会写磁盘）。插件沙箱没有 `btoa`，
    base64 由 `util/base64.ts` 自行编码。Hook 的 additionalContext 只能是文本，快照不变，由 hook-rules 要求模型对选中的图片批注调用 `get_annotations`。
24. **全文只读 Zotero 的缓存，默认整篇返回**：`get_fulltext` 读取 `storage/<KEY>/.zotero-ft-cache`（Zotero 索引 PDF、EPUB、
    网页时写下的纯文本，按阅读顺序；双栏 PDF 比 `pdftotext` 默认输出可读得多），没有时读同步来、尚未处理的 `.zotero-ft-unprocessed`
    （JSON 的 `text`）。不使用 `item.attachmentText`（缓存不完整时它会调用 PDF worker 现场提取），不索引、不提取、不读附件文件。
    缓存没有分页符，无法按页读取；PDF 默认只索引前若干页，所以结果带 `indexState`（`partial` 时 `note` 说明并建议读文件）与
    `indexedPages` / `totalPages`。默认按估算 token（ASCII 4 字符 / token，其他字符 1 字符 / token）取不超过 20 000 token，低于
    Claude Code 默认的 MCP 输出上限 25 000，常见论文一次返回整篇；更长时 `complete: false`，用 `nextOffset` 续读，切分点优先落在
    换行处、不拆代理对。正文作为第二个 text 内容原样返回，不放进 JSON 字符串，避免换行与引号转义。
25. **根据阅读器上下文回答前必须先读全文**：焦点是阅读器、问题涉及该文献时，模型先对阅读器附件调用 `get_fulltext`（每篇一次），
    依据正文作答，不凭记忆、标题或摘要。规则写在 hook-rules（每轮注入；上限因此从 900 提高到 1200 字符）、server-instructions 与
    `research-workflow.md`（Codex 插件的技能包含它）。

## 7. 与原计划的差异

下表逐条对照用户的原始计划：“原计划”一栏只写原计划实际规定的内容，原计划没有规定的写“未规定”；原计划已有规定且实现
完全一致的地方不列。所有差异都是有意为之：

| 主题 | 原计划 | 实际实现 | 原因 |
|---|---|---|---|
| Codex 插件布局 | 插件根目录放 `plugin.json`、`mcp.json` 与 `hooks/hooks.json` | `.codex-plugin/plugin.json` + `.mcp.json` + `hooks/hooks.json` | Codex 0.162 忽略不带 agent-plugins.org `$schema` 的根目录 `plugin.json`；带 `$schema` 的布局又禁止在 `mcp.json` 中设置超时（决策 1）。 |
| 支持的客户端 | Codex 与 Claude Code 插件；Claude Science（Connectors + Skill） | 只维护 Codex 桌面插件（ZIP，带 Hook）与 Claude 桌面应用扩展（MCPB，聊天与 Cowork，无 Hook）；Claude Code 插件、CLI 安装说明、本地市场文件与 Claude Science / 通用无 Hook 技能均已删除 | 项目所有者决定收敛维护范围；服务端协议不变，`capture_prompt_context` 仍接受任意 `client` 字符串。 |
| Codex 安装方式 | 桌面安装包 | 在 Customize → Plugins → Add → New Plugin 拖入 `zotero-reading-bridge-codex.zip` | 旧名称包于 2026-10-17 确认导入成功；新包内置与 Claude 桌面版共用的 stdio 中继（决策 22）。 |
| MCP 服务器名 | 未规定名字；只要求 Hook 引用实际连接名 | Codex：`zotero_bridge` | 属于补充规定：`zotero` 常被其他 Zotero MCP 服务器占用，Codex 中 `config.toml` 的同名条目会截走 Hook 调用（决策 2）。 |
| Hook 输入 | 只传客户端及会话 / 本轮标识：Codex 为 `client` + `${turn_id}`；不传用户问题全文、会话记录路径或记录内容 | Codex：`client`、`session_id`、`turn_id`；同样不传提示词、工作目录或记录路径（协议另接受可选的 `prompt_id`） | 补上 `session_id`，使 snapshotId 能区分会话与同一会话中的各轮；Codex 遇到不存在的占位符会让 Hook 失败，所以 Hook 定义只用 Codex 的占位符（决策 4）。 |
| 启用开关与 `prefs.js` | 设置页含启用开关；建议布局含 `packages/zotero/prefs.js` | prefs.js 删除：插件不再有自有偏好项；关闭桥接使用 Zotero 的插件禁用（**工具 → 插件**），设置页没有启用开关 | 自有开关与 Zotero 内置的插件禁用重复：禁用插件同样立即注销端点、不影响 Connector（集成测试 lifecycle.addon-toggle），不必再维护首选项观察器和运行中的重新注册；新版仅注册和注销一个端点。Zotero 允许插件不带 `prefs.js`（`plugins.js` 忽略找不到该文件的错误）。 |
| 本地化文件名 | `locale/<语言>/bridge.ftl` | `locale/<语言>/zotero-reading-bridge.ftl`，消息 id 统一加 `zotero-reading-bridge-` 前缀 | Zotero 11 把所有插件的 FTL 合并到同一个命名空间，并只读取 `locale/<语言>/` 顶层文件；通用文件名和消息 id 容易与其他插件冲突（决策 13）。 |
| 带 Origin 的请求 | 缺失 Origin 可接受，存在 Origin 则拒绝（含 null）；不开放 CORS | 大多数带 `Origin` 或浏览器 User-Agent 的请求先被 Zotero 自身直接断开（连接关闭，没有 403）；带 `X-Zotero-Connector-API-Version` / `Zotero-Allowed-Request` 头的请求不会被断开，到达插件后一律 403；插件从不发送 CORS 头，Zotero 只对 `https://www.zotero.org` 附加它自己的 CORS 头 | 若要对所有浏览器请求都自己返回 403，就必须打开 `allowRequestsFromUnsafeWebContent`，让浏览器请求进入插件代码；保持 Zotero 的“直接断开”更安全。插件的 Origin 规则是绕过 Zotero 检查的那类请求唯一的屏障（决策 17）。 |
| `server/discover` 探测 | 未涉及（2026-07-28 晚于原计划） | 无论是否带 2026-07-28 版本头，一律 HTTP 400 + `-32601` 并回显 id；其他带不支持版本头的请求 400 + `-32600` | Claude Code 与 Codex 的探测分类器在收到回显 id 的“方法不存在”（`-32601`）时才判定为旧协议服务器并回退到 `initialize`；未回显 id 的错误、其他错误码、非 JSON 的 400、401 / 403 / 5xx 都会被判定为硬失败（决策 6）。 |
| 错误状态码 | 未规定（只要求协议错误与工具执行错误按 MCP 格式返回）；常见实现用 500 / 503 表示内部错误或“未就绪” | **从不返回 5xx**：内部异常变成 HTTP 200 + JSON-RPC `-32603` 或 `isError` 工具结果；桥接关闭时注销端点，由 Zotero 返回 404 | Zotero 自身在 `init` 抛异常时写出格式错误的 500；Codex 把 5xx 当作可重试的传输失败，Claude Code 的探测把 ≥ 500 当作硬失败（决策 8）。 |
| 工具结果格式 | 未规定（可用 `outputSchema` + `structuredContent`） | 第一个内容始终是 JSON 文本；`get_fulltext` 之后追加正文 text，图片批注追加 image；不声明 `outputSchema` | 声明后每个结果都必须带通过校验的 `structuredContent`，否则客户端判定调用失败；Hook 路径只读取文本（决策 16、23）。 |
| Hook 输出 | 快照用 `hookSpecificOutput.additionalContext` 返回，MCP 文本内容承载 Hook JSON；长选区注明截断 | 文本**恰好**是 `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}`，没有其他键；“未选中 / Zotero 不可用”也不返回 `isError`；长度按客户端限制：8000 字符，Codex 与未知客户端另限 9600 个 UTF-8 字节 | Codex 对多余键直接判定 Hook 失败；`isError` 在 Codex 中是“失败、不注入任何内容”，模型就看不到“当前什么都没选中”这一事实（决策 5）；Codex 按 UTF-8 字节估算 token，超过约 10000 字节就把上下文转存为文件、只给首尾预览（决策 18）。 |
| 采集内容 | 选中条目、当前分类、阅读器附件、选中文字、选中批注与时间戳 | 另外采集打开的笔记（笔记标签页或独立笔记窗口）与焦点（`focus`），主窗口关闭时读取独立阅读器 / 笔记窗口 | Zotero 11 默认在标签页中打开笔记；笔记或阅读器标签页在前台时，条目列表的选择属于隐藏的文献库标签页，不能当作“这篇”（决策 20）。 |
| 全文检索 | 全文检索仅用 Zotero 已有索引 | 一致；索引无法回答的词（3 个字母以下、单个汉字、中英文混合）在 `fulltext` 模式及 `everything` 模式的引号词中直接报 `INVALID_ARGUMENT` | Zotero 对这类词会退回到逐个读取所有附件的全文缓存，这已不是“用已有索引”，且在大型文献库上要几分钟（决策 21）。 |
| 分页实现 | 分页默认 50、上限 200，返回后续分页信息 | 一致；翻页结果在内存中按请求缓存，Zotero 数据一变就清空 | 避免每翻一页都在 Zotero 主线程上重新检索和排序（决策 19）。 |
| Claude 桌面应用 | 未规定 | `.mcpb` 扩展运行零依赖的 stdio↔HTTP 中继（与 Codex ZIP 共用），无 Hook，模型按服务器说明按需调用 `get_current_context`；在 Claude 桌面应用 2.42304.0 的聊天与 Cowork 中实测可用（[acceptance.md](acceptance.md) 第 17 节） | 桌面应用的本地 MCP 服务器和扩展只接受 stdio 命令，远程连接器只接受公网 https；中继作为子进程只通过管道通信、不监听端口，目标固定为 `127.0.0.1`（决策 22）。 |

## 8. 运行约束与已知限制

| 主题 | 说明 |
|---|---|
| 端口 | Zotero 只在启动时绑定 HTTP 端口。修改 `extensions.zotero.httpServer.port` 后必须**重启 Zotero**，并把客户端配置中的 23119 改成新端口；设置页始终显示实际端口。插件不修改任何 `httpServer.*` 首选项。 |
| Codex：先启动 Zotero | Codex 的 Hook 以 `wait_for_server = false` 调用 MCP，服务器必须已经连接；只有 Codex 内置服务器会在启动失败后自动重连。会话开始时 Zotero 未运行，这个会话里 `zotero_bridge` 就一直不可用，Hook 每轮失败（不阻塞消息），需要新开会话。会话第一条消息如果早于服务器完成初始化，也可能没有快照（源码分析，未实测）。 |
| Codex：Hook 信任 | 插件 Hook 默认不受信任，必须在 `/hooks`、桌面版 “Review hooks” / “Trust all” 或 Settings > Hooks 中信任一次。信任记录是 Hook 定义（`server`、`tool`、`input`、`timeout`、`statusMessage`）的 SHA-256；**Hook 定义有任何变化都要重新信任**，只改版本号或 `.mcp.json` 不影响（已在临时配置中验证，见 [acceptance.md](acceptance.md) I-C3）。 |
| Codex：工具过滤 | `enabled_tools` / `disabled_tools` 同样过滤 Hook 调用；使用 `enabled_tools` 时必须包含 `capture_prompt_context`。 |
| Hook 超时 | Codex Hook 超时 5 秒。插件在 2.5 秒内完成采集（读取阅读器 / 笔记条目超时只丢掉这一部分，其余快照保留；整个采集卡住超过 3 秒才返回 `unavailable` 快照）；Zotero 正忙（同步、建立全文索引、冷加载）时仍可能整体超时，Codex 记为失败，消息照常发送。 |
| 阅读器内部接口 | 页码、选中文字、选中批注读取自 Zotero 阅读器的内部状态（`_internalReader`、`_state`、`_lastView` 等），每次访问都有异常保护；Zotero 版本变化后可能读不到，此时快照保留附件与父条目并在 `warnings` 中说明。 |
| 调试日志隐私 | 见第 5 节“隐私”：Zotero 自身的调试日志会记录请求头、请求正文前 1000 个字符，以及工具调用中经手的附件路径与文件名、数据库查询参数和全文检索词；插件自己的日志与响应日志只有摘要。与 AI 客户端一起使用时关闭调试日志。 |
| 冒充桥接 | 客户端无法验证 `127.0.0.1:23119` 上的服务器（见第 5 节）：Zotero 未运行时占用该端口的程序可经 Hook 向每条消息注入文字。多人共用的电脑上不要安装客户端插件。 |
| Codex 的 Hook 上下文 | Codex 对 mcp_tool Hook 固定按约 2500 token（UTF-8 字节数 / 4）转存附加上下文；插件对 Codex 另限 9600 字节，中文选区因此比只按字符计的 8000 字符上限更早被缩短（快照的 `warnings` 中说明），需要全文时让模型调用 `get_current_context`。 |
| Claude 桌面应用 | 没有 Hook，不会每轮附加快照；模型按服务器说明在需要时调用 `get_current_context`。Zotero 未运行时中继对每个请求回 JSON-RPC 错误：发生在启动时，`initialize` 失败，服务器显示为失败，启动 Zotero 后需重启 Claude 桌面应用（或重新启用扩展）；发生在会话中途，只有那几次工具调用失败，Zotero 重新启动后下一次调用即可成功（中继无状态）。未实测。 |
| 结果缓存 | 翻页结果与标签计数在内存中缓存（120 秒，Zotero 数据变化即清空，见决策 19）；Zotero 的“显示子集合中的条目”设置变化后，`get_collection` 与 `search_items(collectionKey)` 立即按新设置计算。 |

## 9. 测试分层

| 层次 | 内容 | 命令 |
|---|---|---|
| 类型检查 | 全部 tsconfig（Zotero 插件、设置页面、脚本、测试、测试用种子插件、共用中继 `shared/relay/`） | `npm run typecheck` |
| 单元测试 | 纯函数：参数校验、分页、文本处理、访问检查、回环监听验证、响应、注册表、工具契约、检索计划与全文可检索性、结果缓存、快照与 Hook 输出（字符与 UTF-8 字节预算）、说明段落、打包与启动契约、共用中继（参数只接受 127.0.0.1、逐行转发、202 不输出、Zotero 不可达时的 JSON-RPC 错误、请求头不含 Origin） | `npm test`（`tests/unit`） |
| 协议测试 | 模拟 Zotero 服务器怪癖的 Node HTTP 服务器 + 官方 MCP SDK 客户端（2025-11-25 与 2025-06-18）+ 原始 HTTP 用例；SDK 的 stdio 客户端启动中继子进程，经中继完成 initialize / tools/list / tools/call | `npm test`（`tests/protocol`） |
| 集成测试工具自检 | 路径安全、测试配置文件首选项、夹具、原始 HTTP 客户端、用例目录（不启动 Zotero） | `npm test`（`tests/zotero/harness.test.ts`） |
| 打包校验 | 三个产物（XPI、Codex ZIP、MCPB）的结构、清单字段（版本等元数据与 `package.json` 一致）、引用资源、敏感信息与本机路径扫描；两个安装包中的中继（只用 Node 内置模块、不监听、不带 Origin），并实际运行打包后的中继（拒绝 `--host 0.0.0.0`，Zotero 不可达时返回 JSON-RPC 错误） | `npm run build` 末尾自动运行；`npm run verify` 重新校验已有产物 |
| Zotero 集成测试 | 独立测试配置文件、端口 23139、合成数据，覆盖全部工具、上下文快照、生命周期、设置页与本地化、只读检查；加 `--debug-output` 时还检查插件自己的调试日志行只有摘要 | `npm run test:zotero`（可加 `--debug-output`） |
| 手动验收 | 真实 Codex 桌面版与 Claude 桌面应用（聊天、Cowork） | 步骤见两个安装说明（`packages/codex/README.md`、`packages/claude-desktop/README.md`），结果记录于 [acceptance.md](acceptance.md) |
