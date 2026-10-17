# 无 Hook 客户端手动验收（通用 MCP 客户端 / Claude Science）

没有 Prompt Hook 的客户端不会在每轮消息前自动附加 Zotero 快照，模型必须在需要时自己调用 `get_current_context`。
本脚本验证这条路径，结果填入 [docs/acceptance.md](../../../docs/acceptance.md) 第 13–15 节（G-*、W-*、N-*）以及 O-4。

官方 TypeScript SDK 作为通用客户端的协议层验证已由 `tests/protocol/sdk-client.test.ts` 自动完成（G-1）；这里验证
真实的 Zotero 与真实的模型行为。

## 0. 准备

1. `npm run build`、`npm run verify`；按 [install-zotero.md](../../../docs/install-zotero.md) 安装 XPI，设置页状态为
   “运行中，地址 127.0.0.1:23119”。
2. 测试数据与 [Codex 脚本](../codex/README.md) 第 0 节相同：论文 A、B，A 带有文字层的 PDF。另准备一篇附件文件缺失的条目 C
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

## 2. 真实的无 Hook 客户端（G-3、W-1 – W-4、N-1、N-2）

任何能在本机连接 MCP Streamable HTTP 服务器的客户端都可以使用（地址见上，无认证，不能带浏览器 `Origin`）。下面以
**手动注册、不加 Hook 的 Claude Code** 为例，它与 Claude Science 一样只能靠技能和模型主动调用。

1. 如果装过 Claude Code 插件，先临时禁用（插件与手动注册不能并存）：

   ```powershell
   claude plugin disable zotero-ai-bridge@zotero-ai-bridge-local
   ```

2. 新建一个只用于本测试的目录，放入无 Hook 技能，并只在这个目录中注册服务器（local 作用域，不写 Hook）：

   ```powershell
   $test = Join-Path $env:USERPROFILE 'zab-nohook-test'
   New-Item -ItemType Directory -Force (Join-Path $test '.claude\skills\zotero') | Out-Null
   Copy-Item '<仓库目录>\outputs\claude-science-zotero-skill\skills\zotero\SKILL.md' (Join-Path $test '.claude\skills\zotero\SKILL.md')
   Set-Location $test
   claude mcp add --transport http zotero_bridge http://127.0.0.1:23119/bridge/mcp
   claude
   ```

3. **G-3**：`/mcp` 中 `zotero_bridge` 已连接，18 个工具；`/hooks` 中没有 Zotero 相关 Hook。
4. **W-1**：在 Zotero 中选中论文 A，发送“总结一下这篇论文”。
   - 模型在本轮先调用 `get_current_context`，再用返回的 libraryID + key 调用 `get_items` 等工具；回答针对 A。
5. **W-2**：在 Zotero 中改选 B，发送“那这篇呢？”
   - 模型**重新**调用 `get_current_context`，回答针对 B，没有沿用上一轮的结果。
6. **W-3**：取消所有选择，发送“这篇论文讲什么？”→ 模型说明当前没有选中任何条目，请你选中或按标题搜索；
   然后退出 Zotero 再问一次 → 模型说明 Zotero 不可用（可能建议 `get_status`），不猜测。之后重新启动 Zotero。
7. **W-4**：检查以上各轮的工具调用，模型从未调用 `capture_prompt_context`。
8. **N-1**：选中 A，发送“读取这篇论文的 PDF，告诉我实验用了哪些数据集”。
   - 模型调用 `get_current_context` → `get_attachment_path`，再用客户端自己的工具（这里是 Read）读取 PDF 并回答。
9. **N-2**：选中 C，发送“读取这篇论文的 PDF 全文”。
   - 模型根据 `exists: false` 和 `note` 说明文件不在本机，**不**编造内容。

清理：

```powershell
claude mcp remove zotero_bridge
Set-Location $env:USERPROFILE
Remove-Item -Recurse -Force (Join-Path $env:USERPROFILE 'zab-nohook-test')
claude plugin enable zotero-ai-bridge@zotero-ai-bridge-local   # 如果第 1 步禁用过插件
```

## 3. Claude Science（G-4、W-5、N-3）

当前状态为“不兼容”（0.1.63 实测，G-4）（原因见 [integrations/claude-science/README.md](../../../integrations/claude-science/README.md)）。
Claude Science 更新后，按该文件“如何复测”一节逐步操作：

- 连接器被拒绝：在 G-4 的“证据”中记录完整的错误文字与版本，状态保持不变，W-5、N-3 不再执行。
- 连接器被接受：G-4 记为“通过”，再按本文件第 2 节第 4–9 步执行 W-5、N-3（导入同一个无 Hook 技能），并检查
  `%LOCALAPPDATA%\ClaudeScience\desktop-launch.log` 中是否新增 `denied 127.0.0.1:23119` 行。
- 两种情况都按“如何复测”第 6 步，用 Zotero 调试日志记录原计划要求实测的三项：请求是否到达 Zotero（回环可达性）、是否带 `Origin`
  请求头或 `Mozilla/` User-Agent（Zotero 的 `Preventing request from browser` 或插件的 403）、是否接受 JSON-only 响应。

**不要**为了让 Claude Science 连上而使用公网隧道、端口转发、反向代理、监听端口的本地中继或修改沙箱 / 代理规则：桥接没有认证，
这些做法会把整个文献库暴露出去。

## 4. 只读（O-4）

完成以上步骤后，A、B、C 在 Zotero 中的「修改日期」与开始前相同；没有新增条目、笔记或标签。
