# Zotero AI Bridge — Claude Code 插件

让 Claude Code 以**只读**方式访问本机正在运行的 Zotero，并在每次发送消息前自动附加当前 Zotero 选择
（选中的条目、打开的 PDF、页码、选中文字和批注）。

本插件只包含配置文件，不包含可执行代码：

| 文件 | 作用 |
|---|---|
| `.claude-plugin/plugin.json` | 插件清单（不重复声明 hooks / mcpServers，使用默认位置） |
| `.claude-plugin/marketplace.json` | 本地单插件市场，`source` 为 `./`，即本目录本身 |
| `.mcp.json` | MCP 服务器 `zotero`（会话中显示为 `plugin:zotero-ai-bridge:zotero`）→ `http://127.0.0.1:23119/bridge/mcp` |
| `hooks/hooks.json` | `UserPromptSubmit` Hook：调用 `capture_prompt_context`，只发送 `client`、`session_id`、`prompt_id` |
| `skills/zotero/SKILL.md` | 使用说明（检索、读取 PDF、引用、上下文规则） |

## 前提

1. Zotero 11 已安装并启用 Zotero AI Bridge 插件（`zotero-ai-bridge.xpi`），Zotero 设置的「Zotero AI Bridge」页面状态为“运行中”。
2. Claude Code 2.1.118 或更新版本（支持 `mcp_tool` 类型的 Hook）。插件的校验与安装在 2.1.295 上验证过。
3. **不要**再用 `claude mcp add` 手动注册同一个地址：Claude Code 按 URL 去重，手动注册优先，插件服务器会被隐藏，
   插件 Hook 随之失效。

## 快速试用（仅当前会话）

```powershell
claude --plugin-dir "$env:USERPROFILE\zotero-ai-bridge\claude-code"
```

## 长期安装

1. 把本压缩包解压到一个长期保留的目录，例如 `%USERPROFILE%\zotero-ai-bridge\claude-code`，该目录下应直接看到
   `.claude-plugin`、`hooks`、`skills` 等文件夹。
2. 注册本地市场并安装：

   ```powershell
   claude plugin marketplace add "$env:USERPROFILE\zotero-ai-bridge\claude-code"
   claude plugin install zotero-ai-bridge@zotero-ai-bridge-local
   ```

3. **先启动 Zotero**，再重新启动 Claude Code。在会话中用 `/mcp` 确认 `plugin:zotero-ai-bridge:zotero` 已连接，用 `/hooks`
   查看 Hook。Claude Code 没有逐个 Hook 的信任步骤，安装即生效。启动时 Zotero 未运行的话，服务器显示 failed，启动 Zotero 后在
   `/mcp` 中重新连接即可。
4. 在 Zotero 中选中一篇论文后提问“我当前在 Zotero 中选中的是哪篇论文？”。回答应包含正确的标题和 libraryID + key。

## 更新与卸载

- 更新：用新版本文件替换目录内容后执行
  `claude plugin marketplace update zotero-ai-bridge-local` 和 `claude plugin update zotero-ai-bridge@zotero-ai-bridge-local`，然后重启 Claude Code。
- 卸载：`claude plugin uninstall zotero-ai-bridge@zotero-ai-bridge-local`，然后
  `claude plugin marketplace remove zotero-ai-bridge-local`。

## 不装插件的替代方式

`claude mcp add --transport http --scope user zotero_bridge http://127.0.0.1:23119/bridge/mcp`，再在
`~/.claude/settings.json` 中添加引用服务器 `zotero_bridge` 的 Hook，见项目中的 `examples/claude-mcp-add.md`。
**插件与手动注册二选一。** 从手动注册改用本插件时，删除手动注册的服务器**和** settings.json 中的那个 Hook。

## 安全边界：本机可访问、只读

- 桥接只监听 `127.0.0.1`，但本机上的**任何程序和用户**都能读取你的整个 Zotero 文献库（无身份验证）。
- 反过来，Claude Code 也无法确认 `127.0.0.1:23119` 上的程序真是 Zotero：Zotero 未运行时，本机其他程序或其他用户可以占用这个端口，
  它返回的文字会经本插件的 Hook 作为附加上下文注入**每一条消息**（包括伪造的“规则”和要求执行命令的内容）。
  **多人共用的电脑（实验室、机房等）上不要安装本插件**；不用时卸载。
- 不要通过局域网、端口转发、反向代理或隧道把 23119 端口暴露出去。
- 所有工具只读；Hook 不发送提示词、工作目录或对话记录。
- 打开 Zotero 的调试输出时，Zotero 自身会记录收到的请求内容，以及工具调用中经手的附件路径和文件名、数据库查询参数（如条目网址、
  检索词）；使用 Claude Code 期间请关闭调试输出，分享调试日志前请先检查。

完整说明见项目文档 `docs/install-claude-code.md` 与 `docs/troubleshooting.md`。
