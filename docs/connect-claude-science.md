# 连接 Claude Science 与其他无 Hook 的 MCP 客户端

Codex 和 Claude Code 通过 Hook 在每轮消息前自动附加 Zotero 快照。其他 MCP 客户端没有这种机制，只能在需要时由模型
主动调用 `get_current_context`。本页说明这类客户端的通用连接方式，以及 Claude Science 的现状。

## 1. 通用 MCP 客户端

| 项目 | 值 |
|---|---|
| 传输 | MCP Streamable HTTP（只用 POST + JSON 响应，不使用 SSE，无会话） |
| 地址 | `http://127.0.0.1:23119/bridge/mcp`（端口以 Zotero 设置页显示为准；别名 `/codex/mcp` 等价） |
| 协议版本 | 2025-11-25、2025-06-18、2025-03-26 |
| 认证 | 无（不要配置令牌或 OAuth） |
| 主机 | 只能用 `127.0.0.1`。客户端必须与 Zotero 运行在同一台电脑上，并且不能带浏览器的 `Origin` 头或 `Mozilla/` 开头的 User-Agent |

客户端连上后会看到 18 个只读工具。为了让模型正确处理“当前论文 / 我的选择”，请同时导入无 Hook 技能：构建产物
`outputs/claude-science-zotero-skill/skills/zotero/SKILL.md`（源文件 `integrations/claude-science/skills/zotero/SKILL.md`，
构建时展开其中的 include 标记）。不支持技能的客户端，可以把这个文件的正文作为系统提示或项目说明使用。

### 无 Hook 时的工作流（技能中的规则）

- 用户提到“这篇论文 / 打开的 PDF / 我的选择 / 我划的这段”或要求刷新时，先在同一轮调用 `get_current_context`。
- 整个回答固定使用返回结果中的 libraryID + key。
- 结果只代表 `capturedAt` 那一刻的状态；后续消息再提到当前选择时要重新调用，不能把旧结果当作当前状态。
- `status` 为 `empty`：什么都没选中，请用户在 Zotero 中选中或打开论文，或者按标题搜索。
- `status` 为 `unavailable` 或调用失败：说明情况并用 `get_status` 诊断，不猜测。
- 不调用 `capture_prompt_context`（它只供 Hook 使用）。
- 读取 PDF：`get_attachment_path` 取得本地路径，再用客户端自己的文件读取能力打开；客户端无法读取本地文件时如实说明。

手动验收步骤见 [tests/clients/generic-no-hook/README.md](../tests/clients/generic-no-hook/README.md)。

## 2. Claude Science：未验证 / 静态分析判定不兼容

**结论**：在 Claude Science 0.1.62（Windows 11，2026-10-14 安装）上，没有做过真实连接；根据静态分析，它目前**无法**连接本桥接。

**原因**（详见 [integrations/claude-science/README.md](../integrations/claude-science/README.md)）：

1. 自定义远程连接器的 URL 必须是**公网 https 地址**：程序中有 `safeFetch: https-only` 与 `safeFetch: non-public host rejected`
   两个拒绝分支，提示文字为 “Remote MCP servers must be reachable at a public https URL”。`http://127.0.0.1` 两条都不满足。
2. 它的沙箱出站代理拦截过本机端口：启动日志 `%LOCALAPPDATA%\ClaudeScience\desktop-launch.log` 中有
   `[proxy] denied 127.0.0.1:23119 (blocked-port) via HTTP`。本地（stdio）连接器是否同样被拦截**未验证**（它也不是本方案的接入方式）。
3. Claude Science 文档中没有 Hook 或插件机制，无法做到每轮自动附加 Zotero 快照。

**交付内容**：只有无 Hook 技能（`outputs/claude-science-zotero-skill/`）和复测说明。

**不提供、也不建议**：公网隧道、端口转发、反向代理、本地中继进程，或修改 Claude Science 的沙箱 / 代理规则。
桥接没有身份验证，这些做法会把整个文献库暴露出去，突破“本机可访问、只读”的安全边界。

**复测**：Claude Science 更新后，按 [integrations/claude-science/README.md](../integrations/claude-science/README.md) 的
“如何复测”逐步操作（包括原计划要求实测的三项：回环可达性、是否发送 `Origin` 请求头或浏览器 User-Agent、能否接受 JSON-only 响应），
把版本、错误文字和日志行记录到 [acceptance.md](acceptance.md)。在真实复测通过之前，状态保持
“未验证 / 静态分析判定不兼容”。
