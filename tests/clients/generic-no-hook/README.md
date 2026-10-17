# 无 Hook 客户端手动验收（通用 MCP 客户端 / Claude Science）

没有 Prompt Hook 的客户端不会在每轮消息前自动附加 Zotero 快照，模型必须在需要时自己调用 `get_current_context`。
本脚本验证这条路径，结果填入 [docs/acceptance.md](../../../docs/acceptance.md) 第 13–15 节（G-*、W-*、N-*）以及 O-4。

官方 TypeScript SDK 作为通用客户端的协议层验证已由 `tests/protocol/sdk-client.test.ts` 自动完成（G-1）；这里验证
真实的 Zotero 与真实的模型行为。

## 0. 准备

1. `npm run build`、`npm run verify`；按 [install-zotero.md](../../../docs/install-zotero.md) 安装 XPI，设置页状态为
   “运行中，地址 127.0.0.1:23119”。
2. 准备测试数据：论文 A、B，A 带有文字层的 PDF。另准备一篇附件文件缺失的条目 C
   （例如把一个链接文件附件指向的文件改名）。
3. 无 Hook 技能：构建产物 `outputs/claude-science-zotero-skill/skills/zotero/SKILL.md`（源文件
   `integrations/claude-science/skills/zotero/SKILL.md`，构建时已展开 include 标记）。

## 1. 原始 JSON-RPC 请求（G-2）

在 PowerShell 中执行。`-UserAgent` 不能省略：PowerShell 默认的 User-Agent 以 `Mozilla/` 开头，会被 Zotero 当作浏览器请求断开。

```powershell
$uri = 'http://127.0.0.1:23119/bridge/mcp'
function Invoke-Mcp([string]$Json, [string]$Version) {
  $headers = @{}
  if ($Version) { $headers['MCP-Protocol-Version'] = $Version }
  Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' `
    -UserAgent 'zotero-ai-bridge-check' -Headers $headers -Body $Json
}

# initialize：result.protocolVersion 应为 2025-11-25，serverInfo.name 为 zotero-ai-bridge
Invoke-Mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-check","version":"0"}}}' |
  ConvertTo-Json -Depth 10

# 通知：HTTP 202，没有输出
Invoke-Mcp '{"jsonrpc":"2.0","method":"notifications/initialized"}' '2025-11-25'

# tools/list：应列出 18 个工具名
(Invoke-Mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' '2025-11-25').result.tools.name

# get_current_context：在 Zotero 中选中论文 A 后执行，应得到 status "ok"、focus "library" 和 A 的 libraryID + key
$r = Invoke-Mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_current_context","arguments":{}}}' '2025-11-25'
$r.result.content[0].text | ConvertFrom-Json | ConvertTo-Json -Depth 10
```

再取消所有选择（或选中文献库根节点）执行最后一条，`status` 应为 `"empty"`。

## 2. Claude 桌面版无 Hook 验收

按 [安装说明](../../../docs/install-claude-desktop.md) 拖入 MCPB，新建对话后验证 get_status 和 get_current_context。选择论文 A 后询问当前论文，再改选 B 重新询问，检查 libraryID 和 key 随选择更新。点名 A 时应检索 A，而非误用当前 B。全文读取优先 get_fulltext，缺失时按需取得附件路径；附件 C 缺失时如实报告。

卸载通过设置 → 扩展完成。

## 3. Claude Science（G-4、W-5、N-3）

当前状态为“不兼容”（0.1.63 实测，G-4）（原因见 [integrations/claude-science/README.md](../../../integrations/claude-science/README.md)）。
Claude Science 更新后，按该文件“如何复测”一节逐步操作：

- 连接器被拒绝：在 G-4 的“证据”中记录完整的错误文字与版本，状态保持不变，W-5、N-3 不再执行。
- 连接器被接受：G-4 记为“通过”，再按本文件第 2 节的工作流执行 W-5、N-3（导入同一个无 Hook 技能），并检查
  `%LOCALAPPDATA%\ClaudeScience\desktop-launch.log` 中是否新增 `denied 127.0.0.1:23119` 行。
- 两种情况都按“如何复测”第 6 步，用 Zotero 调试日志记录原计划要求实测的三项：请求是否到达 Zotero（回环可达性）、是否带 `Origin`
  请求头或 `Mozilla/` User-Agent（Zotero 的 `Preventing request from browser` 或插件的 403）、是否接受 JSON-only 响应。

**不要**为了让 Claude Science 连上而使用公网隧道、端口转发、反向代理、监听端口的本地中继或修改沙箱 / 代理规则：桥接没有认证，
这些做法会把整个文献库暴露出去。

## 4. 只读（O-4）

完成以上步骤后，A、B、C 在 Zotero 中的「修改日期」与开始前相同；没有新增条目、笔记或标签。
