# Zotero Reading Bridge 开发文档

面向开发者的中文说明。面向用户的英文安装指南见 [README](../README.md)。

项目与发布包名称为 `zotero-reading-bridge`。新版使用新的插件 ID，不兼容旧安装；请先移除旧的 Zotero AI Bridge 及其客户端插件，再安装新版。

让 Codex 和 Claude 桌面应用**只读**访问本机 Zotero：检索文献、读取元数据、全文、笔记和批注。Codex 在宿主支持并信任 Hook 时自动附加当前选择；Claude 桌面版按需获取当前选择。

```text
Codex / Claude 桌面版 → stdio 中继 → 本机 HTTP → Zotero Bridge → 文献库
```

## 组成

| 组件 | 源码 | 构建产物 | 作用 |
|---|---|---|---|
| Zotero 插件 | `packages/zotero/` | `outputs/zotero-reading-bridge.xpi` | 在 Zotero 自带的本机 HTTP 服务器上提供 MCP 端点 `http://127.0.0.1:23119/bridge/mcp`，19 个只读工具 |
| Codex 桌面插件 | `packages/codex/` | `outputs/zotero-reading-bridge-codex.zip` | 拖拽导入；内置中继、技能及 `UserPromptSubmit` 上下文 Hook |
| Claude 桌面应用扩展 | `packages/claude-desktop/` | `outputs/zotero-reading-bridge-claude-desktop.mcpb` | 拖拽导入；供 Claude 桌面版聊天与 Cowork 使用，无 Hook，按需调用 `get_current_context` |
| 共用中继 | `shared/relay/` | 两个安装包中的 `server/zotero-relay.js` | stdio↔HTTP 中继（零依赖 Node，只连 `127.0.0.1`，不监听端口）；构建时打包一次，同时放入 Codex ZIP 和 MCPB |

## 工具（全部只读）

| 类别 | 工具 |
|---|---|
| 状态 | `get_status`、`get_library_paths`、`get_schema` |
| 当前选择 | `get_current_context`（按需），`capture_prompt_context`（仅供客户端 Hook 使用） |
| 文献库结构 | `list_libraries`、`list_collections`、`get_collection`、`list_saved_searches`、`run_saved_search`、`list_tags` |
| 条目 | `search_items`、`get_items`、`get_item_children` |
| 内容 | `get_notes`、`get_annotations`（图片批注附带 Zotero 缓存的图像） |
| 附件 | `get_fulltext`（Zotero 已提取的全文，常见论文一次返回整篇）；`list_attachments`、`get_attachment_path`（只返回本地路径与是否存在；全文缺失或不完整时，由客户端自己的文件工具读取 PDF） |

所有条目、集合、笔记和批注都用 libraryID + key 标识；列表结果分页（`nextCursor`）。

## 快速开始

1. 在 Zotero 的“工具 → 插件”中拖入 **zotero-reading-bridge.xpi**，确认 Bridge 正在运行。
2. **Codex 桌面版**：在 **Customize → Plugins → Add → New Plugin** 中拖入 **zotero-reading-bridge-codex.zip**。详见 [安装说明](../packages/codex/README.md)。
3. **Claude 桌面版**：在 **设置 → 扩展** 中拖入 **zotero-reading-bridge-claude-desktop.mcpb**。详见 [安装说明](../packages/claude-desktop/README.md)。
4. 新建对话，询问“读取我当前在 Zotero 中选中的论文，给出 libraryID 和 key”。

无需解压安装包或编辑配置文件。先启动 Zotero，再使用客户端。Codex 插件需要系统 Node.js 18+；Claude 扩展可使用应用自带的 Node.js。更新时重新导入新版安装包，卸载在各应用的插件或扩展页面完成。

开发者生成安装包：先运行 `npm ci`，再运行 `npm run build`（一次生成 Zotero XPI、Codex ZIP 和 Claude MCPB，并自动校验产物），产物均位于 `outputs/`。两个桌面安装包共用同一份中继代码。

## 安全边界：本机可访问、只读

- **只读**：不创建、修改或删除任何条目、笔记、标签、集合或文件，不触发同步，不下载附件。
- **只在本机可访问**：Zotero 的 HTTP 服务器只监听 `127.0.0.1`，插件在注册端点前会确认这一点；浏览器网页的请求大多被 Zotero 直接断开，
  能到达插件的带 `Origin` 请求一律 403。
- **但没有身份验证**：本机上的任何程序和任何用户都能读取你的整个文献库。只在你信任的电脑上启用；要停止桥接，在 Zotero 中禁用插件（**工具 → 插件**）。
- **客户端也无法确认对方真是 Zotero**：Zotero 未运行时，本机其他程序（包括其他 Windows 用户）可以占用 23119 端口冒充桥接，
  它返回的“快照”和说明会经 Hook 注入每一轮对话。**多人共用的电脑上不要安装客户端插件的 Hook**（或不安装客户端插件）。
- **绝不**通过局域网、端口转发、反向代理、隧道或监听端口的中继暴露 23119 端口。Claude 桌面应用使用的 stdio 中继是
  客户端的子进程，只通过管道通信、不监听任何端口，不在此列（[architecture.md](architecture.md) 决策 22）。
- Hook 只发送客户端名和会话 / 轮次 id，不发送提示词、工作目录或对话记录。
- 开启 Zotero 的「帮助 → 调试日志」时，Zotero 自身会记录请求头、请求正文（前 1000 个字符），以及工具调用中经手的附件路径和文件名、
  数据库查询参数（如条目网址、检索词）；与 AI 客户端一起使用时请关闭调试日志，分享日志前请先检查。

详见 [architecture.md](architecture.md) 第 5 节。

## 要求与已知限制

- Zotero 11（含 11.0 beta）；开发与测试使用 Zotero 11.0-beta.1，Windows 11。
- Codex CLI / 桌面版（插件、`mcp_tool` Hook）；在 codex-cli 0.162.0-alpha.17.2 上验证过插件识别。IDE 扩展不支持插件。
- 修改 Zotero 的 HTTP 端口需要重启 Zotero，并同步修改客户端配置。
- Codex：会话开始时 Zotero 必须已在运行（Hook 不会等待或重连服务器）；插件 Hook 必须信任，Hook 定义变化后需重新信任。
- Claude 桌面应用：本地 MCP 服务器只能是 stdio 命令，经中继接入；扩展在 Claude 桌面应用 2.42304.0 中实测可用（聊天与 Cowork）（[acceptance.md](acceptance.md) 第 17 节）。
- 阅读器中的页码、选中文字和选中批注通过 Zotero 的内部接口读取，未来的 Zotero 版本可能读不到（快照会给出警告）。

当前各验收项的状态见 [acceptance.md](acceptance.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [install-zotero.md](install-zotero.md) | 安装 Zotero 插件、设置页面、验证端点、修改端口 |
| [packages/codex/README.md](../packages/codex/README.md) | Codex 桌面插件：拖拽安装、Hook 信任、更新与卸载 |
| [packages/claude-desktop/README.md](../packages/claude-desktop/README.md) | Claude 桌面应用扩展：`.mcpb` 拖拽安装、聊天与 Cowork、故障排查 |
| [architecture.md](architecture.md) | 架构、协议细节、安全边界、设计决策与原计划差异 |
| [troubleshooting.md](troubleshooting.md) | 故障排查 |
| [acceptance.md](acceptance.md) | 验收清单与记录 |

## 开发

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 全部 tsconfig 的类型检查（含测试用种子插件与共用中继 `shared/relay/`） |
| `npm test` | 单元测试（`tests/unit`）、协议测试（`tests/protocol`）与集成测试工具自检（`tests/zotero`）（Node，不启动 Zotero） |
| `npm run build` | 类型检查 → 打包 → 一次生成三个插件（XPI、Codex ZIP、MCPB）以及 `source.zip`、`BUILD-INFO.json` → 自动运行产物校验 |
| `npm run verify` | 重新校验 `outputs/` 中已有的产物 |
| `npm run test:zotero` | 在独立的 Zotero 测试配置文件（端口 23139）中运行集成测试，不触碰你的 Zotero 配置和数据 |

版本号、作者、许可证与关键词只在 `package.json` 中维护，构建时写入全部清单。代码、标识符、工具说明和注释使用英文；面向用户的文档使用中文。

## 许可证

作者：volatile-static。GNU GPL v3 或更新版本（GPL-3.0-or-later）许可证，见 [LICENSE](../LICENSE)。第三方声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
