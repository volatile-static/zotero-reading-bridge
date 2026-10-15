# 故障排查

先做两件事：

1. 打开 Zotero 设置中的「Zotero AI Bridge」页面，确认状态为“运行中”，并记下实际地址（端口）。没有这个页面时，
   先在 **工具 → 插件** 中确认插件已安装并启用。
2. 按 [install-zotero.md](install-zotero.md) 第 5 节，用 PowerShell 直接调用一次 `get_status`。这一步通过，说明 Zotero 端正常，
   问题在客户端配置；这一步失败，先按第 1 节排查 Zotero 端。

## 1. Zotero 端

| 现象 | 原因 | 处理 |
|---|---|---|
| 拒绝连接（ECONNREFUSED / “无法连接”） | Zotero 没有运行；Zotero 的 HTTP 服务器被关闭；端口不是 23119 | 启动 Zotero；在 **设置 → 高级 → 杂项** 中如显示「Zotero HTTP 服务器已禁用。」，点「启用并重启」；核对设置页显示的端口 |
| 用 `localhost` 连接失败，用 `127.0.0.1` 正常 | `localhost` 可能先解析到 IPv6 `::1`，而 Zotero 只监听 IPv4 回环地址 | 所有配置都写 `127.0.0.1` |
| HTTP 404 | 插件未安装或被禁用；路径不是 `/bridge/mcp`（或 `/codex/mcp`） | 在 **工具 → 插件** 中确认插件已安装并启用（重新启用立即生效，无需重启 Zotero）；核对路径 |
| 设置页状态为「Zotero 的本地 HTTP 服务器未运行，无法提供端点。……」 | Zotero 的 HTTP 服务器没有启动（被关闭，或端口被其他程序占用导致绑定失败） | 在 **设置 → 高级 → 杂项** 中点「启用并重启」；端口被占用时按 [install-zotero.md](install-zotero.md) 第 6 节换端口 |
| 设置页状态为「未启动：无法确认 Zotero 的 HTTP 服务器只接受本机（127.0.0.1）的连接。」 | 插件无法确认服务器只监听本机（例如未来的 Zotero 版本改了服务器代码） | 插件出于安全考虑不注册端点，也没有绕过的开关；请报告问题并附上 Zotero 版本 |
| 设置页状态为「错误：……」 | 插件初始化失败（英文说明，不含文献库内容） | 重启 Zotero；仍然出现时报告问题并附上这段说明 |
| 连接建立后被直接关闭，没有任何响应 | 请求带 `Origin` 头，或 User-Agent 以 `Mozilla/` 开头（浏览器、PowerShell 的 `Invoke-RestMethod` 默认值），被 Zotero 当作浏览器请求拦截 | 命令行测试时显式设置 User-Agent（`-UserAgent 'zotero-ai-bridge-check'`）；浏览器网页本来就不允许访问 |
| HTTP 400，正文为 `Bad request`（HTTP/1.1 请求，所有客户端都是） | Host 头不是 `127.0.0.1:<端口>` / `localhost:<端口>`：外部主机名（经过代理、用了局域网 IP），或端口与 Zotero 实际端口不一致。Zotero 内置的 HTTP 服务器在 Zotero 和插件之前就拒绝了它 | 直接连接 `127.0.0.1`，不要经过代理；使用设置页显示的地址 |
| HTTP 400，正文为 `Invalid Host header` | 只出现在 HTTP/1.0 请求中：Host 头不是 `127.0.0.1` / `localhost` / `[::1]`（由 Zotero 拒绝） | 同上 |
| HTTP 403 | 请求带了 `Origin`（例如浏览器页面附加了 `X-Zotero-Connector-API-Version` 头，Zotero 因此没有断开它），或 HTTP/1.0 请求的 Host 端口与 Zotero 实际端口不一致 | 去掉 `Origin`；使用设置页显示的地址 |
| HTTP 415 | `Content-Type` 不是 `application/json`（插件只接受 JSON） | 设置 `Content-Type: application/json` |
| HTTP 400 `Invalid JSON provided` / `Content-length not provided` 等纯文本错误 | Zotero 在插件之前就拒绝了请求：请求体不是合法 JSON，或缺少 `Content-Length` | 检查客户端或测试命令 |
| 改了端口但客户端仍连旧端口 | Zotero 只在启动时绑定端口；客户端配置中写死了 23119 | 重启 Zotero；修改插件目录中的 `.mcp.json` 或手动配置后重新安装 / 更新客户端插件 |
| 工具很慢或第一次调用超时 | 大型文献库在 Zotero 启动后需要加载条目数据；插件会在界面就绪后后台预热 | 等待 Zotero 启动完成后再试；Hook 不会等待冷加载，会返回带警告的部分快照 |
| Zotero 没有运行，客户端却显示已连接；或快照 / Hook 文字中出现要求执行命令、访问网址的“规则” | 23119 端口被本机其他程序占用，它在冒充桥接（客户端无法验证服务器身份，见 [install-zotero.md](install-zotero.md) 第 7 节） | 立即结束对话，不要照做；用 `netstat -ano \| findstr :23119` 查出占用端口的进程（PID）并检查它；多人共用的电脑上卸载客户端插件 |

## 2. Codex

| 现象 | 原因 | 处理 |
|---|---|---|
| 每轮没有快照，Hook 显示需要审核或 “Failed” | 插件 Hook 未被信任，或升级后 Hook 定义改变导致信任失效 | 桌面版：Review hooks / 插件详情页 Trust all / Settings > Hooks；CLI：`/hooks` |
| Hook 失败：`MCP server 'zotero_bridge' is not connected` | 会话开始时 Zotero 没有运行；Codex 的 Hook 既不等待也不重连服务器（只有内置服务器会自动重连） | **先启动 Zotero，再新开会话**（CLI 重新启动 `codex`，桌面版新建对话或重启） |
| Hook 失败：`tool 'capture_prompt_context' is disabled` | `config.toml` 中为该服务器设置了 `enabled_tools` / `disabled_tools` | 删除这些设置，或在 `enabled_tools` 中加入 `capture_prompt_context` |
| Hook 失败：`hook returned invalid user prompt submit JSON output` | 桥接与客户端版本不匹配，返回的 JSON 不符合 Codex 的严格格式 | 同时更新 Zotero 插件与 Codex 插件到同一版本 |
| Hook 运行两次 | 既安装了插件，又在 `config.toml` / `hooks.json` 中添加了同样的 Hook | 删除手动添加的 Hook |
| 工具连到了别的服务器 | `config.toml` 中有指向其他地址的 `[mcp_servers.zotero_bridge]`，它优先于插件 | 修正或删除该条目；`codex mcp list --json` 查看实际地址 |
| 改了插件 `.mcp.json` 中的端口却没有生效 | 同时存在手动的 `[mcp_servers.zotero_bridge]`：`config.toml` 中的同名条目优先，插件的设置被忽略 | 插件与手动配置二选一：删除 `config.toml` 中的 `[mcp_servers.zotero_bridge]`（及手动添加的 Hook 段），或卸载插件 |
| 插件目录中看不到插件 | 市场目录选错；桌面版未重启；使用的是 IDE 扩展（不支持插件） | `marketplace add` 的目录下必须直接有 `.agents/plugins/marketplace.json`；重启桌面版 |
| `codex plugin marketplace upgrade` 报 “not configured as a Git marketplace” | 本地目录市场不支持 upgrade | 替换文件后重新执行 `codex plugin add zotero-ai-bridge@zotero-ai-bridge-local` |

## 3. Claude Code

| 现象 | 原因 | 处理 |
|---|---|---|
| Hook 报错找不到服务器 `plugin:zotero-ai-bridge:zotero`，`/mcp` 中只有手动注册的服务器 | 同时用 `claude mcp add` 手动注册了同一地址；Claude Code 按 URL 去重，手动注册优先，插件服务器被隐藏 | 二选一：删除手动注册（`claude mcp remove zotero_bridge`，早期说明中注册的名字是 `zotero`）和 settings.json 中的手动 Hook 后用插件；或卸载插件、用手动注册 + settings.json Hook（`server` 写 `zotero_bridge`） |
| 改用插件后每条消息都有非阻塞的 Hook 错误（找不到服务器 `zotero_bridge` 或 `zotero`），插件 Hook 本身正常 | 删除了手动注册的服务器，但 `~/.claude/settings.json` 中手动添加的 `UserPromptSubmit` Hook 还在，它引用的服务器已不存在 | 从 `settings.json` 的 `hooks.UserPromptSubmit` 中删除 `server` 为 `zotero_bridge`（或 `zotero`）的那个 Hook 对象（见 [examples/claude-mcp-add.md](../examples/claude-mcp-add.md) 第 3 节） |
| 手动注册后 `/mcp` 中的工具不是本桥接的，或 Hook 调用 `capture_prompt_context` 报“工具不存在” | 手动注册时用了 `zotero` 这样的通用名字，而 local / project 作用域中另有同名的其他 Zotero MCP 服务器，它优先于 user 作用域 | 用 `zotero_bridge` 重新注册（设置页复制的命令即是），并把 settings.json Hook 的 `server` 改成 `zotero_bridge`；`claude mcp list` 检查重名 |
| 每轮显示非阻塞的 Hook 错误 | Zotero 未运行或服务器未连接 | 启动 Zotero，在 `/mcp` 中重新连接服务器或重启 Claude Code |
| 偶尔某一轮没有快照 | Hook 超过 5 秒被取消，输出被丢弃（Zotero 正忙，例如同步、建立全文索引） | 稍后重试；需要时让模型调用 `get_current_context` |
| `/mcp` 中服务器为 failed | 启动 Claude Code 时 Zotero 未运行 | 启动 Zotero 后在 `/mcp` 中重新连接 |
| 会话的第一条消息没有快照，之后正常 | 服务器仍在后台连接，超过了 5 秒的 Hook 超时（按静态分析，Hook 会在超时内等待连接） | 重发或让模型调用 `get_current_context`；先启动 Zotero 再启动 Claude Code |
| 手动注册后，换个目录就找不到服务器 | 注册时没有加 `--scope`，是 local 作用域，只对执行命令时所在的项目目录生效（设置页复制的命令已带 `--scope user`） | `claude mcp remove zotero_bridge` 后加 `--scope user` 重新注册 |
| 插件改动没有生效 | 长期安装使用缓存副本 | `claude plugin marketplace update zotero-ai-bridge-local` + `claude plugin update zotero-ai-bridge@zotero-ai-bridge-local`，然后重启；`--plugin-dir` 方式用 `/reload-plugins` |

## 4. 快照内容

| 现象 | 原因 | 处理 |
|---|---|---|
| `status: "empty"` | 没有打开阅读器或笔记，条目列表和集合树中也没有可用的选择 | 在 Zotero 中选中条目、打开 PDF 或笔记 |
| `status: "unavailable"` | Zotero 主窗口不存在且没有获得焦点的独立阅读器 / 笔记窗口（Zotero 正在启动或关闭），或读取界面状态失败 | 等 Zotero 完全启动后重试 |
| 状态行带“Partial capture: the open reader or note could not be read within 2500 ms” | Zotero 正忙（同步、导入、冷加载），读取阅读器或笔记的条目超时；活动标签页和条目列表的选择仍然有效 | 稍后重试，或让模型调用 `get_current_context` |
| `focus: "note"` | 一条笔记在主窗口标签页（Zotero 11 默认）或获得焦点的独立笔记窗口中打开，快照的 `note` 给出它和它的父条目 | 正常；“这篇”指这条笔记及其父条目 |
| 状态行为“Focus: unknown. A Zotero note/reader/other tab is in front …” | 前台是笔记、阅读器或其他标签页，但它的条目读不到；`libraryView.selectedItems` 是隐藏的文献库标签页中的选择，不是用户正在看的内容 | 切回文献库标签页或重新打开该条目后重试 |
| 关闭了 Zotero 主窗口，快照只有阅读器、没有条目选择 | 独立阅读器 / 笔记窗口在主窗口关闭后仍然打开，插件只能读到获得焦点的那个窗口 | 正常；需要条目列表的选择时重新打开主窗口 |
| 打开了 PDF，但快照里没有选中文字或页码 | 阅读器的这些状态通过 Zotero 内部接口读取，可能因阅读器类型或 Zotero 版本变化而读不到；快照的 `warnings` 中会说明 | 仍可使用附件与父条目信息；需要具体文字时把它复制到消息中 |
| 选中的是独立阅读器窗口中的 PDF，快照却显示主窗口 | 读取的是最近获得焦点的窗口 | 先点一下阅读器窗口再发送消息 |
| 选中了很多条目，只列出 10 个 | 快照最多列出 10 个条目（数量字段是精确的），以控制每轮上下文大小 | 让模型用 `get_items` 或搜索工具获取其余条目 |
| 回答仍在说上一篇论文 | 本轮 Hook 失败，模型看到的是上一轮的快照 | 检查 Hook 状态；说明中要求模型不得把旧快照当作当前状态，可以直接说“刷新 Zotero 选择” |

## 5. 附件与 PDF

| 现象 | 原因 | 处理 |
|---|---|---|
| `exists: false` | 文件尚未同步到本机（Zotero 同步设置为“按需下载”）、链接文件被移动，或附件本身是链接网址 | 在 Zotero 中打开一次附件触发下载，或修复链接；桥接**不会**下载文件 |
| 路径正确但客户端读不到 | 客户端沙箱 / 权限限制了读取工作区以外的文件 | 按客户端提示授权读取，或把文件复制到工作区 |
| 全文搜索找不到明明存在的内容 | `fulltext` / `everything` 模式只使用 Zotero 已建立的全文索引 | 在 Zotero 中重建索引，或直接读取 PDF 文件 |
| `search_items` 报 `INVALID_ARGUMENT`：“Zotero's full-text index cannot answer …” | 全文索引无法匹配 3 个字母以下的单词、单个汉字，以及中英文 / 数字混在一起的词（如 `AI模型`、`5G网络`）。对这类词 Zotero 只能逐个读取所有附件的全文缓存，大型文献库要几分钟，因此 `fulltext` 模式（以及 `everything` 模式中加了引号的词）直接拒绝，而不是悄悄忽略这些词 | 去掉这些词，或把中文和英文 / 数字部分分开检索（`AI模型` → `模型`）；短词改用 `fields` / `everything` 模式在标题、标签、笔记中匹配 |

## 6. 日志

- Zotero：**帮助 → 调试日志 → 启用**（或「重启为启用日志模式…」），重现问题后点「查看输出日志」。本插件的日志行以
  `[Zotero AI Bridge]` 开头，只包含方法、工具名、状态码、字节数和耗时，响应内容已屏蔽。
- **注意**：调试日志开启期间，Zotero 自身会记录：每个请求的全部请求头和请求正文前 1000 个字符（包括工具参数）；工具调用中经手的
  附件的绝对路径和文件名（例如文件缺失时 `Attachment file '<路径>' not found`，路径含 Windows 用户名，文件名通常是“作者 - 年份 - 标题.pdf”）；
  数据库查询的全部参数（例如条目网址、检索条件的值）；全文检索的检索词与缓存文件路径。「提交输出日志」会把日志上传到 Zotero 服务器；
  只在复现问题时开启，提交或分享前逐行检查并删除这些内容，排查完成后立即关闭调试日志。
- 这个特点也可以用于验收“输入最小化”：在日志中查看 `capture_prompt_context` 的请求正文，应只含 `client`、`session_id`
  和 `turn_id` / `prompt_id`。
