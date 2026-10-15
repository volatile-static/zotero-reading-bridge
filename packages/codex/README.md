# Zotero AI Bridge — Codex 插件

让 Codex（CLI 与桌面版）以**只读**方式访问本机正在运行的 Zotero，并在每次发送消息前自动附加当前 Zotero 选择
（选中的条目、打开的 PDF、页码、选中文字和批注）。

本插件只包含配置文件，不包含可执行代码：

| 文件 | 作用 |
|---|---|
| `.codex-plugin/plugin.json` | 插件清单（名称、版本、技能 / MCP / Hook 路径、界面信息） |
| `.mcp.json` | MCP 服务器 `zotero_bridge` → `http://127.0.0.1:23119/bridge/mcp` |
| `hooks/hooks.json` | `UserPromptSubmit` Hook：调用 `capture_prompt_context`，只发送 `client`、`session_id`、`turn_id` |
| `skills/zotero/SKILL.md` | 使用说明（检索、读取 PDF、引用、上下文规则） |
| `.agents/plugins/marketplace.json` | 本地单插件市场，`path` 为 `./`，即本目录本身 |

## 前提

1. Zotero 11 已安装 Zotero AI Bridge 插件（`zotero-ai-bridge.xpi`），并在 Zotero 设置的「Zotero AI Bridge」页面中启用。
2. Codex CLI 或 Codex 桌面版（IDE 扩展不支持插件）。插件的识别与安装在 codex-cli 0.162.0-alpha.17.2 上验证过，更早的版本未测试。
3. **先启动 Zotero，再开始 Codex 会话。** Codex 的 Hook 不会等待或重连 MCP 服务器；会话开始时 Zotero 未运行，
   这个会话里 `zotero_bridge` 就一直不可用，需要新开会话。

## 安装

1. 把本压缩包解压到一个长期保留的目录（不要放在临时目录或下载目录中随时可能被清理的位置），例如
   `%USERPROFILE%\zotero-ai-bridge\codex`。该目录下应直接看到 `.codex-plugin`、`.agents`、`hooks` 等文件夹。
2. 注册本地市场（目录路径含空格或中文时请加引号）：

   ```powershell
   codex plugin marketplace add "$env:USERPROFILE\zotero-ai-bridge\codex"
   ```

   成功时输出的市场名是 `zotero-ai-bridge-local`。
3. 安装插件，二选一：
   - CLI：`codex plugin add zotero-ai-bridge@zotero-ai-bridge-local`
   - 桌面版：重启 Codex 桌面版，打开 Plugins（插件目录），选择 “Zotero AI Bridge (local)” 来源中的 Zotero AI Bridge，点击安装。
4. **信任 Hook（必须）。** 插件 Hook 默认不受信任，不信任就不会运行：
   - 桌面版：输入框上方出现 “Review hooks” 时点开并允许；或在插件详情页点 “Trust all”；或在 Settings > Hooks 中信任。
   - CLI：在会话中输入 `/hooks`，信任 `zotero-ai-bridge@zotero-ai-bridge-local:hooks/hooks.json:user_prompt_submit:0:0`。
5. **新建一个对话**（技能、MCP 工具和 Hook 只对新会话生效），在 Zotero 中选中一篇论文后提问
   “我当前在 Zotero 中选中的是哪篇论文？”。回答应包含正确的标题和 libraryID + key。

## 更新与卸载

- 更新：用新版本文件替换目录内容后，再执行一次 `codex plugin add zotero-ai-bridge@zotero-ai-bridge-local`
  （本地市场不支持 `codex plugin marketplace upgrade`，那只用于 Git 市场）。Hook 内容有变化时需要重新信任。
- 卸载：`codex plugin remove zotero-ai-bridge@zotero-ai-bridge-local`，然后
  `codex plugin marketplace remove zotero-ai-bridge-local`。

## 不装插件的替代方式

在 `~/.codex/config.toml` 中手动添加 `[mcp_servers.zotero_bridge]`（以及可选的 Hook），见项目中的
`examples/codex-config.toml.example`。**插件与手动配置二选一，不要同时使用。** 排查时注意：两者同时存在时，config.toml 中的同名条目
优先，插件 `.mcp.json` 中的设置（例如改过的端口）会被忽略，手动添加的 Hook 还会让每轮调用两次；改用插件前请删除手动配置的两段。

## 安全边界：本机可访问、只读

- 桥接只监听 `127.0.0.1`，但本机上的**任何程序和用户**都能读取你的整个 Zotero 文献库（无身份验证）。
- 反过来，Codex 也无法确认 `127.0.0.1:23119` 上的程序真是 Zotero：Zotero 未运行时，本机其他程序或其他用户可以占用这个端口，
  它返回的文字会经本插件的 Hook 作为附加上下文注入**每一条消息**（包括伪造的“规则”和要求执行命令的内容）。
  **多人共用的电脑（实验室、机房等）上不要安装本插件，也不要信任它的 Hook**；不用时卸载。
- 不要通过局域网、端口转发、反向代理或隧道把 23119 端口暴露出去。
- 所有工具只读；Hook 不发送提示词、工作目录或对话记录。
- 打开 Zotero 的调试输出时，Zotero 自身会记录收到的请求内容，以及工具调用中经手的附件路径和文件名、数据库查询参数（如条目网址、
  检索词）；使用 Codex 期间请关闭调试输出，分享调试日志前请先检查。

完整说明见项目文档 `docs/install-codex.md` 与 `docs/troubleshooting.md`。
