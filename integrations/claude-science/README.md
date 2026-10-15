# Claude Science：Zotero 技能（无 Hook）

> 连接状态：**未验证 / 静态分析判定不兼容**（Claude Science 0.1.62，Windows 11，2026-10-14）。
> 本目录只提供一个无 Hook 的技能文件和复测方法，不提供任何中继、隧道或放宽安全规则的办法。

## 内容

| 文件 | 作用 |
|---|---|
| `skills/zotero/SKILL.md` | 无 Hook 工作流：用户说“当前论文 / 我的选择 / 刷新”时先调用 `get_current_context`，固定使用返回的 libraryID + key，不把旧结果当作当前状态。构建时会展开 `<!-- @include ... -->` 标记，输出到 `outputs/claude-science-zotero-skill/`。 |
| `README.md` | 本说明。 |

## 连接前提

Claude Science 必须能以 MCP Streamable HTTP 访问 `http://127.0.0.1:23119/bridge/mcp`，并且 Zotero 正在同一台电脑上运行、Zotero AI Bridge 插件已启用（**工具 → 插件**）。桥接只监听 IPv4 回环地址，没有身份验证，只读。

## 静态分析结论：为什么判定不兼容

以下结论来自本机安装的 Claude Science 0.1.62（`%LOCALAPPDATA%\Programs\ClaudeScience`，`install.json` 版本 0.1.62）的程序字符串和启动日志，没有做过真实连接：

1. **远程连接器只接受公网 https 地址。** 添加自定义连接器时，URL 会经过 `safeFetch` 检查，程序中有 `safeFetch: https-only` 和 `safeFetch: non-public host rejected` 两个拒绝分支，并附带提示“Remote MCP servers must be reachable at a public https URL”。`http://127.0.0.1:...` 同时违反这两条。
2. **沙箱代理拦截过 Zotero 端口。** 本机启动日志 `%LOCALAPPDATA%\ClaudeScience\desktop-launch.log` 中出现过 `[proxy] denied 127.0.0.1:23119 (blocked-port) via HTTP`，说明沙箱的出站代理曾拦截访问 23119 端口的请求。本地（stdio）连接器是否运行在同一个沙箱中、是否同样被拦截、能否通过授权放行，都**未验证**；本地 stdio 连接器也不是本方案的接入方式。
3. **Claude Science 文档中没有 Hook 或插件机制**，因此无法像 Codex / Claude Code 那样每轮自动附加 Zotero 快照，只能使用本目录的无 Hook 技能。

本项目**不会**提供以下变通办法，也不建议自行尝试：公网隧道或端口转发（会把整个文献库无鉴权地暴露出去）、本地中继进程、修改 Claude Science 的沙箱或代理规则。这些都会突破“本机可访问、只读”的安全边界。

## 如何复测（Claude Science 更新后）

1. 启动 Zotero，在 Zotero 设置的「Zotero AI Bridge」页面确认状态为“运行中”，并记下页面显示的实际地址。
2. 先用已验证的客户端（Codex 或 Claude Code）调用一次 `get_status`，确认桥接本身正常。
3. 在 Claude Science 中打开 Settings > Connectors > Add connector > Remote，URL 填 `http://127.0.0.1:23119/bridge/mcp`，传输选择 Streamable HTTP，不填任何凭据。记录是否被拒绝以及完整的错误文字。
4. 复测前在 Zotero 中打开 **帮助 → 调试日志 → 启用**（仅复测期间开启，隐私说明见 `docs/install-zotero.md` 第 7 节），以便看到
   Claude Science 实际发出的请求。
5. 如果连接器被接受：新建对话，让它“调用 get_status”；然后在 Zotero 中选中一个条目，让它“读取我当前在 Zotero 中选中的论文”，确认它调用了 `get_current_context` 并使用返回的 libraryID + key。
6. 无论第 3、5 步成功与否，检查 Zotero 调试日志中这段时间对 `/bridge/mcp` 的请求（原计划要求实测的三项）：
   - **Origin 请求头 / 浏览器 User-Agent**：请求头中是否有 `origin:`，`user-agent` 是否以 `Mozilla/` 开头，日志中是否出现
     `Preventing request from browser`（Zotero 因此直接断开连接，客户端只看到连接被关闭），或插件返回了 403（`[Zotero AI Bridge]`
     行中的 `-> 403 rejected`）。出现任何一种都记为不兼容，不放宽规则。
   - **回环可达性**：日志中是否出现来自 Claude Science 的请求；完全没有请求时，说明它根本没有连到 `127.0.0.1:23119`。
   - **JSON-only 兼容性**：`initialize`、`tools/list`、`tools/call` 的 `[Zotero AI Bridge]` 行是否都是 200（通知为 202），客户端是否
     接受只返回 `application/json`、不提供 SSE 的服务器（例如是否反复发送 GET 并因 405 失败）。

   复测结束后关闭调试日志。
7. 查看 `%LOCALAPPDATA%\ClaudeScience\desktop-launch.log` 中是否新增 `denied 127.0.0.1:23119` 行。
8. 技能导入：Settings > Skills > Add skill（Upload 或 Write from scratch），内容使用构建产物 `outputs/claude-science-zotero-skill/skills/zotero/SKILL.md`。Claude Science 接受的上传格式未经验证，如需要可把正文粘贴到 Write from scratch。

## 需要记录的内容

把结果填入 `docs/acceptance.md` 的“无 Hook 通用 MCP 客户端 / Claude Science”“无 Hook 工作流”“无 Hook PDF 阅读”三节中的
G-4、W-5、N-3 行（逐步操作也可参考 `tests/clients/generic-no-hook/README.md` 第 3 节）：

- Claude Science 版本（Settings 或 `install.json`）、操作系统、日期；
- 第 3 步的完整错误文字或成功截图；
- 日志中与 `127.0.0.1:23119` 相关的行；
- 第 6 步的三项结果：请求是否带 `Origin` 或 `Mozilla/` User-Agent（是否被 Zotero 断开或被插件 403）、请求是否到达 Zotero、
  是否接受 JSON-only 响应（只记录请求头与状态，不要粘贴文献库内容）；
- 工具列表是否出现 18 个工具，`get_status` 与 `get_current_context` 的返回摘要；
- PDF 阅读：`get_attachment_path` 返回的路径是否能被 Claude Science 读取（沙箱可能无法读取本地文件）。

在真实复测通过之前，状态保持“未验证 / 静态分析判定不兼容”。
