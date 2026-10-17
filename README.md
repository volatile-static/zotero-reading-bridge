# Zotero AI Bridge

让 Codex 和 Claude 桌面应用**只读**访问本机 Zotero：检索文献、读取元数据、全文、笔记和批注。Codex 在宿主支持并信任 Hook 时自动附加当前选择；Claude 桌面版按需获取当前选择。

```text
Codex / Claude 桌面版 → stdio 中继 → 本机 HTTP → Zotero Bridge → 文献库
```

## 组成

| 组件 | 源码 | 构建产物 | 作用 |
|---|---|---|---|
| Zotero 插件 | `packages/zotero/` | `outputs/zotero-ai-bridge.xpi` | 在 Zotero 自带的本机 HTTP 服务器上提供 MCP 端点 `http://127.0.0.1:23119/bridge/mcp`（别名 `/codex/mcp`），19 个只读工具 |
| Codex 桌面插件 | packages/codex/ | outputs/zotero-ai-bridge-desktop.zip | 拖拽导入；内置中继、技能及上下文 Hook |
| Claude 桌面应用扩展 | `packages/claude-desktop/` | `outputs/zotero-ai-bridge-claude-desktop.mcpb` | stdio↔HTTP 中继 `server/zotero-relay.js`（零依赖 Node，只连 `127.0.0.1`，不监听端口） |
| 无 Hook 技能 | `integrations/claude-science/` | `outputs/claude-science-zotero-skill/` | 供没有 Hook 的 MCP 客户端使用（按需调用 `get_current_context`） |

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

1. 在 Zotero 的“工具 → 插件”中拖入 **zotero-ai-bridge.xpi**，确认 Bridge 正在运行。
2. **Codex 桌面版**：在 **Customize → Plugins → Add → New Plugin** 中拖入 **zotero-ai-bridge-desktop.zip**。详见 [安装说明](docs/install-codex.md)。
3. **Claude 桌面版**：在 **设置 → 扩展** 中拖入 **zotero-ai-bridge-claude-desktop.mcpb**。详见 [安装说明](docs/install-claude-desktop.md)。
4. 新建对话，询问“读取我当前在 Zotero 中选中的论文，给出 libraryID 和 key”。

无需解压安装包、注册本地市场或编辑配置文件。先启动 Zotero，再使用客户端。Codex 插件需要系统 Node.js 18+；Claude 扩展可使用应用自带的 Node.js。更新时重新导入新版安装包，卸载在各应用的插件或扩展页面完成。

开发者生成安装包：先运行 npm ci，再运行 npm run package:desktop-plugin 和 npm run verify。Codex ZIP、Zotero XPI 和 Claude MCPB 均位于 outputs/。两个桌面安装包共用同一份中继代码。

## 安全边界：本机可访问、只读

- **只读**：不创建、修改或删除任何条目、笔记、标签、集合或文件，不触发同步，不下载附件。
- **只在本机可访问**：Zotero 的 HTTP 服务器只监听 `127.0.0.1`，插件在注册端点前会确认这一点；浏览器网页的请求大多被 Zotero 直接断开，
  能到达插件的带 `Origin` 请求一律 403。
- **但没有身份验证**：本机上的任何程序和任何用户都能读取你的整个文献库。只在你信任的电脑上启用；要停止桥接，在 Zotero 中禁用插件（**工具 → 插件**）。
- **客户端也无法确认对方真是 Zotero**：Zotero 未运行时，本机其他程序（包括其他 Windows 用户）可以占用 23119 端口冒充桥接，
  它返回的“快照”和说明会经 Hook 注入每一轮对话。**多人共用的电脑上不要安装客户端插件的 Hook**（或不安装客户端插件）。
- **绝不**通过局域网、端口转发、反向代理、隧道或监听端口的中继暴露 23119 端口。Claude 桌面应用使用的 stdio 中继是
  客户端的子进程，只通过管道通信、不监听任何端口，不在此列（[docs/architecture.md](docs/architecture.md) 决策 22）。
- Hook 只发送客户端名和会话 / 轮次 id，不发送提示词、工作目录或对话记录。
- 开启 Zotero 的「帮助 → 调试日志」时，Zotero 自身会记录请求头、请求正文（前 1000 个字符），以及工具调用中经手的附件路径和文件名、
  数据库查询参数（如条目网址、检索词）；与 AI 客户端一起使用时请关闭调试日志，分享日志前请先检查。

详见 [docs/architecture.md](docs/architecture.md) 第 5 节。

## 要求与已知限制

- Zotero 11（含 11.0 beta）；开发与测试使用 Zotero 11.0-beta.1，Windows 11。
- Codex CLI / 桌面版（插件、`mcp_tool` Hook）；在 codex-cli 0.162.0-alpha.17.2 上验证过插件识别。IDE 扩展不支持插件。
- Claude Code 2.1.118 或更新版本（`mcp_tool` Hook）；在 2.1.295 上验证过插件安装。
- 修改 Zotero 的 HTTP 端口需要重启 Zotero，并同步修改客户端配置。
- Codex：会话开始时 Zotero 必须已在运行（Hook 不会等待或重连服务器）；插件 Hook 必须信任，Hook 定义变化后需重新信任。
- Claude 桌面应用：本地 MCP 服务器只能是 stdio 命令，经中继接入；扩展在 Claude 桌面应用 2.42304.0 中实测可用（聊天与 Cowork）（[docs/acceptance.md](docs/acceptance.md) 第 17 节）。
- Claude Science 0.1.63：远程连接器只接受公网 https 地址，添加本机 HTTP 端点时报 `safeFetch: https-only`，实测不兼容。
- 阅读器中的页码、选中文字和选中批注通过 Zotero 的内部接口读取，未来的 Zotero 版本可能读不到（快照会给出警告）。

当前各验收项的状态见 [docs/acceptance.md](docs/acceptance.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/install-zotero.md](docs/install-zotero.md) | 安装 Zotero 插件、设置页面、验证端点、修改端口 |
| [docs/install-codex.md](docs/install-codex.md) | Codex 插件安装、Hook 信任、拖拽安装 |
| [docs/install-claude-desktop.md](docs/install-claude-desktop.md) | Claude 桌面应用：`.mcpb` 扩展、拖拽安装、无 Hook 技能 |
| [docs/connect-claude-science.md](docs/connect-claude-science.md) | 无 Hook 客户端与 Claude Science |
| [docs/architecture.md](docs/architecture.md) | 架构、协议细节、安全边界、设计决策与原计划差异 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 故障排查 |
| [docs/acceptance.md](docs/acceptance.md) | 验收清单与记录 |

## 开发

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 六个 tsconfig 的类型检查（含测试用种子插件与 Claude 桌面应用中继） |
| `npm test` | 单元测试、协议测试、客户端插件静态检查与集成测试工具自检（Node，不启动 Zotero） |
| `npm run build` / `npm run verify` | 打包与产物校验 |
| `npm run test:zotero` | 在独立的 Zotero 测试配置文件（端口 23139）中运行集成测试，不触碰你的 Zotero 配置和数据 |

代码、标识符、工具说明和注释使用英文；面向用户的文档使用中文。

## 许可证

MIT，见 [LICENSE](LICENSE)。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
