# 在 Claude Code 中安装

适用于 Claude Code CLI 2.1.118 及以上版本（`mcp_tool` 类型的 Hook 从 2.1.118 开始支持）。本文的命令在 Claude Code
2.1.295（Windows 11）上用临时 `HOME` / `USERPROFILE` / `CLAUDE_CONFIG_DIR` 实际执行过（见第 8 节）。

先完成 [install-zotero.md](install-zotero.md)，并确认 Zotero 正在运行。

> **插件与手动注册二选一。** Claude Code 按 URL 对 MCP 服务器去重，手动用 `claude mcp add` 注册的同一地址优先级更高，
> 会把插件的服务器隐藏掉，插件 Hook 也就找不到服务器。已经手动注册过的，装插件前先删除两样东西：
> 手动注册的服务器（`claude mcp remove zotero_bridge`；按早期说明注册的名字是 `zotero`），以及 `~/.claude/settings.json` 中
> 手动添加的 `UserPromptSubmit` Hook（见 [examples/claude-mcp-add.md](../examples/claude-mcp-add.md) 第 3 节）。只删服务器的话，
> 留下的 Hook 每条消息都会报一次“找不到服务器”的非阻塞错误。
>
> **多人共用的电脑上不要安装本插件。** 客户端无法验证 `127.0.0.1:23119` 上的程序真是 Zotero：Zotero 未运行时，其他程序或其他用户
> 可以占用这个端口，通过 Hook 把任意文字注入每一条消息（见 [install-zotero.md](install-zotero.md) 第 7 节）。

## 1. 插件包结构

`outputs/zotero-ai-bridge-claude-code.zip` 解压后的根目录就是插件根目录，同时也是一个只含这一个插件的本地市场：

```
zotero-ai-bridge-claude-code/
├── .claude-plugin/plugin.json        插件清单（不声明 hooks / mcpServers，使用默认位置）
├── .claude-plugin/marketplace.json   本地市场：name = zotero-ai-bridge-local，source = "./"
├── .mcp.json                         MCP 服务器 zotero（会话中为 plugin:zotero-ai-bridge:zotero）
├── hooks/hooks.json                  UserPromptSubmit → capture_prompt_context
├── skills/zotero/SKILL.md            使用说明（显示为 zotero-ai-bridge:zotero）
└── README.md
```

清单中不写 `hooks` / `mcpServers` 字段：Claude Code 会把这两个字段与默认文件合并，重复声明可能导致重复加载。

## 2. 快速试用（只对当前会话生效）

```powershell
claude --plugin-dir "$env:USERPROFILE\zotero-ai-bridge\claude-code"
```

这种方式不写入任何设置；插件 id 为 `zotero-ai-bridge@inline`，服务器名同样是 `plugin:zotero-ai-bridge:zotero`，
所以 Hook 可以正常工作。修改文件后在会话中执行 `/reload-plugins` 即可重新加载。

## 3. 长期安装

1. 把 zip 解压到一个长期保留的目录，例如 `%USERPROFILE%\zotero-ai-bridge\claude-code`。
2. 注册本地市场并安装：

   ```powershell
   claude plugin marketplace add "$env:USERPROFILE\zotero-ai-bridge\claude-code"
   claude plugin install zotero-ai-bridge@zotero-ai-bridge-local
   ```

   - `marketplace add` 在 `~/.claude/settings.json` 的 `extraKnownMarketplaces` 中记录这个目录（`source: directory`）。
   - `plugin install` 默认使用 user 作用域：在 `~/.claude/settings.json` 的 `enabledPlugins` 中启用插件，并把插件复制到
     `~/.claude/plugins/cache/zotero-ai-bridge-local/zotero-ai-bridge/<版本>/`。需要只在某个项目中启用时，加
     `--scope project`（写入项目的 `.claude/settings.json`）或 `--scope local`。
3. 重新启动 Claude Code。

检查：

```powershell
claude plugin list --json        # zotero-ai-bridge@zotero-ai-bridge-local，enabled: true
claude plugin details zotero-ai-bridge@zotero-ai-bridge-local
claude mcp list                  # plugin:zotero-ai-bridge:zotero: http://127.0.0.1:23119/bridge/mcp (HTTP)
```

`claude plugin details` 应列出 Skills (1) zotero、Hooks (1) UserPromptSubmit、MCP servers (1) zotero。
`claude mcp list` 会做一次健康检查：Zotero 运行时显示已连接，未运行时显示 ECONNREFUSED。

## 4. Hook 行为

Claude Code 没有逐个 Hook 的信任步骤，插件启用后 Hook 即生效。在会话中可以用 `/hooks` 查看、用 `/mcp` 查看服务器状态。

Hook 发送给 Zotero 的内容只有：

```json
{ "client": "claude-code", "session_id": "${session_id}", "prompt_id": "${prompt_id}" }
```

不发送提示词、工作目录或对话记录路径。Claude Code 没有 `turn_id`；`prompt_id` 在会话第一条输入之前可能为空字符串，
桥接会把空值当作“没有”处理。

- 超时为 5 秒。超时后 Claude Code 取消这次 Hook 并**丢弃**它的输出，本轮没有快照，但消息照常发送。
- Zotero 未运行、服务器未连接、工具报错都是非阻塞错误：界面显示 Hook 错误提示，消息照常处理。
- **第一条消息**：Claude Code 启动后在后台连接 MCP 服务器。对 2.1.295 程序的静态分析表明，`UserPromptSubmit` Hook 会在
  Hook 超时（5 秒）与 MCP 连接超时以内等待仍在连接的服务器，所以 Zotero 已运行时第一条消息通常也带快照；Zotero 未运行时
  服务器连接失败，Hook 报非阻塞错误。此行为未实测（验收项 F-K4）。如果第一条消息没有快照，第二条起正常即可；也可以让模型
  调用 `get_current_context`。
- 启动 Claude Code 时 Zotero 未运行：服务器显示 failed。启动 Zotero 后在 `/mcp` 中重新连接，或重启 Claude Code。

## 5. 在新会话中验证

1. 确认 Zotero 已经运行，启动新的 Claude Code 会话，`/mcp` 中 `plugin:zotero-ai-bridge:zotero` 显示已连接。
2. 在 Zotero 中选中一篇论文（或打开它的 PDF 并选中一段文字）。
3. 发送：“我当前在 Zotero 中选中的是哪篇论文？请给出 libraryID 和 key。”回答应给出正确的标题以及 libraryID + key，
   并且不需要先调用工具。
4. 在 Zotero 中改选另一篇论文，再发送“那这篇呢？”，回答应切换到新论文。
5. 发送“搜索我的文献库中关于 <主题> 的论文”，Claude 应调用 `mcp__plugin_zotero-ai-bridge_zotero__search_items`。

完整的验收步骤见 [tests/clients/claude-code/README.md](../tests/clients/claude-code/README.md)，结果记录在
[acceptance.md](acceptance.md)。

## 6. 更新与卸载

- **更新**：用新版本的文件替换第 3 步的目录内容，然后：

  ```powershell
  claude plugin marketplace update zotero-ai-bridge-local
  claude plugin update zotero-ai-bridge@zotero-ai-bridge-local
  ```

  再重启 Claude Code。
- **卸载**：

  ```powershell
  claude plugin uninstall zotero-ai-bridge@zotero-ai-bridge-local
  claude plugin marketplace remove zotero-ai-bridge-local
  ```

- **非默认端口**：编辑市场目录中的 `.mcp.json`，把 `23119` 改成实际端口，然后按“更新”的步骤执行。

## 7. 不安装插件：手动注册

见 [examples/claude-mcp-add.md](../examples/claude-mcp-add.md)：

```powershell
claude mcp add --transport http --scope user zotero_bridge http://127.0.0.1:23119/bridge/mcp
```

再在 `~/.claude/settings.json` 中添加 `server` 为 `zotero_bridge`（手动注册的名字，而不是 `plugin:...`）的
`UserPromptSubmit` Hook。手动注册与插件不要同时使用。服务器名用 `zotero_bridge` 而不是 `zotero`：其他 Zotero MCP 服务器常用
`zotero`，Claude Code 中 local / project 作用域的同名服务器会覆盖 user 作用域的本桥接，Hook 也会调用到它。手动注册时，
工具在会话中显示为 `mcp__zotero_bridge__<工具名>`。

Zotero 设置页「Zotero AI Bridge」中也有对应按钮：

- 「复制 Claude Code 命令」复制 `claude mcp add --transport http --scope user zotero_bridge http://127.0.0.1:<实际端口>/bridge/mcp`，
  即 user 作用域，在所有项目目录中可用（与上面的命令相同，只是端口取 Zotero 实际端口）。
- 「复制钩子设置」复制上面那段 `hooks` JSON（`server` 为 `zotero_bridge`），合并到 `settings.json` 中。

## 8. 已做的验证与未验证项

2026-10-15 用真实的 `claude.exe`（2.1.295，Windows 11）验证；会写入配置的命令都在临时 `HOME`、`USERPROFILE`、
`CLAUDE_CONFIG_DIR` 中执行，真实的 `~/.claude/settings.json` 和 `~/.claude.json` 前后 SHA-256 相同（记录见
[acceptance.md](acceptance.md) B-6、I-K1 – I-K3）：

- `claude plugin validate --strict --json` 对插件目录、`plugin.json` 和 `marketplace.json`（`"source": "./"`）均通过，无错误、
  无警告。反例验证了组件确实被检查：把 Hook 类型改成未知值、把 `.mcp.json` 的服务器类型改成未知值的副本都校验失败。
  注意校验器**不**检查 Hook 的 `server` 名称、`input` 中的占位符和多余的键（把 `server` 改成不存在的名字、加入未知占位符和
  未知字段的副本仍然通过），这些由 `tests/clients/plugin-manifests.test.ts` 检查。
- `claude plugin marketplace add <插件目录>` 成功，市场名 `zotero-ai-bridge-local`；`claude plugin install` 以 user 作用域安装，
  `claude plugin details` 列出 1 个技能、1 个 UserPromptSubmit Hook、1 个 MCP 服务器。
- `claude --plugin-dir <插件目录> mcp list` 显示 `plugin:zotero-ai-bridge:zotero`（目录路径含中文和空格时同样成功）。
- 插件已安装时再用 `claude mcp add --scope user` 以同一地址手动注册（当时用的名字是 `zotero`），`claude mcp list` 只剩手动注册的服务器，
  插件服务器被隐藏：证实了“二选一”的要求。去重按 URL 进行，与手动服务器的名字无关，因此改名为 `zotero_bridge` 后结论不变。
- 版本号改为 0.1.1 后，`claude plugin marketplace update` + `claude plugin update` 升级成功；`uninstall` 与
  `marketplace remove` 正常卸载。
- 手动 Hook 示例（`examples/claude-mcp-add.md`）的 JSON 结构与插件 Hook 一起由 `tests/clients/plugin-manifests.test.ts` 检查。

尚未验证（需要在真实 Claude Code 与运行中的 Zotero 上完成，见 [acceptance.md](acceptance.md)）：Hook 在真实对话中的执行、
端到端问答、Claude 桌面应用 Code 标签页是否加载 `--plugin-dir` 或用户级插件。
