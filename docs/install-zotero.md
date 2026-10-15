# 安装 Zotero 插件

Zotero AI Bridge 的核心是一个 Zotero 插件。它在 Zotero 自带的本机 HTTP 服务器上注册 MCP 端点
`/bridge/mcp`（别名 `/codex/mcp`），提供 18 个只读工具。Codex、Claude Code 等客户端都连接这个端点。

## 1. 要求

| 项目 | 要求 |
|---|---|
| Zotero | Zotero 11（包括 11.0 beta）。插件清单声明 `strict_min_version: 10.999`、`strict_max_version: 11.*`，Zotero 10 及更早版本无法安装。开发与测试使用 Zotero 11.0-beta.1（Windows 11）。 |
| Zotero 内置 HTTP 服务器 | 必须开启（默认开启，首选项 `extensions.zotero.httpServer.enabled`）。 |
| 端口 | Zotero 的端口首选项 `extensions.zotero.httpServer.port`，默认 23119。本插件只读取、不修改这个值。 |
| 操作系统 | 与 Zotero 相同。端点只监听本机 IPv4 回环地址 `127.0.0.1`。 |

不需要开启 Zotero 设置中的「允许此计算机上的其他应用程序与 Zotero 通讯」。那个选项控制的是 Zotero 自带的
Local API（`/api/`），与本插件无关。

## 2. 获取 XPI

- 使用发布的 `zotero-ai-bridge.xpi`；或
- 在仓库中自行构建：

  ```powershell
  npm ci
  npm run build      # 类型检查 + 打包，产物在 outputs/
  npm run verify     # 校验产物结构、清单与敏感信息
  ```

  生成 `outputs/zotero-ai-bridge.xpi`。

## 3. 安装

1. 打开 Zotero，菜单 **工具 → 插件**。
2. 点击插件管理器右上角的齿轮按钮，选择 **Install Plugin From File…**（插件管理器的这一项在中文界面下也可能显示英文），
   选中 `zotero-ai-bridge.xpi`。也可以直接把 XPI 文件拖到插件管理器窗口中。
3. 确认安装。插件是免重启插件，安装后立即生效。

## 4. 设置页面

打开 **编辑 → 设置**（macOS：Zotero → 设置），左侧会出现「Zotero AI Bridge」页面，分三部分。

**本地 MCP 端点**

- 复选框「为 AI 客户端提供只读 MCP 端点」：对应首选项 `extensions.zotero-ai-bridge.enabled`（默认开启）。取消勾选后立即注销端点，
  客户端会收到 404；重新勾选后立即恢复，无需重启 Zotero。
- 「状态」：

  | 显示 | 含义 |
  |---|---|
  | 运行中，地址 127.0.0.1:23119 | 端点已注册，可以连接 |
  | 已关闭。端点未注册，AI 客户端无法连接。 | 复选框未勾选 |
  | Zotero 的本地 HTTP 服务器未运行，无法提供端点。…… | Zotero 的 HTTP 服务器被关闭或端口被占用，见第 6 节 |
  | 未启动：无法确认 Zotero 的 HTTP 服务器只接受本机（127.0.0.1）的连接。 | 插件无法确认服务器只监听回环地址，出于安全考虑不注册端点 |
  | 错误：…… | 插件初始化失败（后面是英文说明，不含文献库内容） |

  在 **工具 → 插件** 中禁用插件时，设置页面会随之消失：已打开的设置窗口自动重新加载，显示其他页面（通常是「常规」）。重新启用插件后，
  「Zotero AI Bridge」页面立即重新出现。（页面脚本中还有一条“插件未运行……”的提示，只作为防御性后备，正常使用中不会出现。）

- 「地址」与「别名（同一端点）」：实际地址 `http://127.0.0.1:<端口>/bridge/mcp` 与 `/codex/mcp`。两个路径完全等价，客户端配置统一使用
  `/bridge/mcp`。端口始终是 Zotero 实际使用的端口。「复制地址」复制主地址。

**连接 AI 客户端**（用于不安装客户端插件的手动配置；HTTP 服务器未运行时，前两个按钮不可用）

- 「复制 Codex 配置」：`~/.codex/config.toml` 中的 `[mcp_servers.zotero_bridge]` 段，加上与插件等价的可选
  `UserPromptSubmit` Hook 段（内容同 `examples/codex-config.toml.example`，见 [install-codex.md](install-codex.md) 第 6 节）。
  与 Codex 插件二选一；Hook 需要在 Codex 中信任一次。
- 「复制 Claude Code 命令」：`claude mcp add --transport http --scope user zotero_bridge <地址>`（user 作用域，所有项目目录可用，见
  [install-claude-code.md](install-claude-code.md) 第 7 节）。服务器名用 `zotero_bridge` 而不是 `zotero`，以免与其他 Zotero MCP 服务器重名。
- 「复制钩子设置」：Claude Code `settings.json` 的 `hooks` 段，引用手动注册的服务器 `zotero_bridge`。

**安全**：只读与本机访问说明，以及调试日志提示，见下文第 7 节。

## 5. 验证端点

Zotero 运行时，在 PowerShell 中执行（`-UserAgent` 不能省略：PowerShell 默认的 User-Agent 以 `Mozilla/` 开头，
Zotero 会把这类请求当作浏览器请求直接断开）：

```powershell
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status","arguments":{}}}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:23119/bridge/mcp `
  -ContentType 'application/json' -UserAgent 'zotero-ai-bridge-check' -Body $body |
  ConvertTo-Json -Depth 10
```

预期：返回 `result.content[0].text`，其中是 JSON 文本，包含桥接版本、端点地址、支持的 MCP 协议版本和文献库列表。
端点是无状态的，不需要先调用 `initialize`。

常见结果：

| 现象 | 含义 |
|---|---|
| 无法连接（拒绝连接） | Zotero 没有运行、HTTP 服务器关闭，或端口不是 23119 |
| HTTP 404 | 插件未安装、未启用，或路径写错 |
| 连接被直接关闭、没有任何响应 | 请求带了 `Origin` 头或以 `Mozilla/` 开头的 User-Agent，被 Zotero 拦截 |
| HTTP 400，正文为 `Bad request`（HTTP/1.1） | Host 不是 `127.0.0.1:<端口>` / `localhost:<端口>`（外部主机名，或端口不对），由 Zotero 的 HTTP 服务器在插件之前拒绝 |
| HTTP 400 `Invalid Host header`（HTTP/1.0） | HTTP/1.0 请求的 Host 不是 `127.0.0.1` / `localhost` |
| HTTP 415 | `Content-Type` 不是 `application/json` |

更多情况见 [troubleshooting.md](troubleshooting.md)。

## 6. 修改端口

一般不需要修改。如果 23119 被占用或你已经改过 Zotero 的端口：

1. 在 **设置 → 高级 → 设置编辑器** 中修改 `extensions.zotero.httpServer.port`，然后**重启 Zotero**（Zotero 只在启动时绑定端口）。
2. 在「Zotero AI Bridge」设置页面确认新地址。
3. 修改所有客户端配置中的端口：插件用户需要编辑插件目录中的 `.mcp.json` 后重新安装或更新插件（见
   [install-codex.md](install-codex.md)、[install-claude-code.md](install-claude-code.md)）；手动配置的用户修改相应配置。

如果 Zotero 的 HTTP 服务器被关闭，**设置 → 高级 → 杂项** 中会显示「Zotero HTTP 服务器已禁用。」和「启用并重启」按钮。

## 7. 安全边界：本机可访问、只读

- **只读**：18 个工具都只读取数据，不创建、修改或删除任何条目、笔记、标签、集合或文件，也不触发同步或文件下载。
- **只在本机可访问**：Zotero 的 HTTP 服务器只监听 `127.0.0.1`；本插件在注册端点前会检查这一点，检查失败就不注册。
- **但本机上的任何程序和任何用户都能访问**：端点没有身份验证。本机运行的任何程序（包括其他 Windows 用户账户下的程序）
  只要能连接 `127.0.0.1:23119`，就能读取整个文献库的元数据、笔记、批注和附件路径。只在你信任的电脑上启用。
- **本机其他程序也能冒充桥接**：方向反过来同样没有验证。Zotero 未运行、HTTP 服务器被关闭或绑定端口失败时，23119 端口是空闲的，
  本机任何程序或其他 Windows 用户都可以监听它。Codex / Claude Code 启动时会连到这个程序，此后**每条消息**的 Hook 都会把它返回的文字
  作为附加上下文交给模型（整段文字由对方决定，包括“规则”和假的快照），它提供的服务器说明和工具说明也会进入模型上下文，
  模型可能照着执行命令。Hook 发出的只有会话 / 轮次 id，但注入的文字不受控制。因此：
  - 在多人共用的电脑（实验室、机房、共享工作站）上，**不要安装 Codex / Claude Code 客户端插件**（尤其是其中的 Hook），
    或在不用时卸载；手动配置时不要添加 Hook 段；
  - 先启动 Zotero 再启动客户端，并在客户端中留意来历不明的“Zotero snapshot rules”或要求执行命令的内容；
  - 客户端无法验证服务器身份，这个风险只能靠上面的使用方式避免（桥接本身没有令牌：令牌只能证明客户端的身份，证明不了服务器的身份）。
- **不要暴露到网络**：不要配置局域网访问、端口转发、反向代理、内网穿透或任何隧道。
- **浏览器网页无法调用**：Zotero 会直接断开大多数带 `Origin` 头或浏览器 User-Agent 的请求；但带 `X-Zotero-Connector-API-Version`
  或 `Zotero-Allowed-Request` 头的请求不会被 Zotero 断开，而且 Zotero 对 `https://www.zotero.org` 页面放行跨域预检。
  这类请求能到达插件，由插件对任何带 `Origin` 的请求返回 403 拦下，读不到数据。插件自己从不发送 CORS 头（Zotero 只对
  `https://www.zotero.org` 附加它自己的 CORS 头）。
- **日志**：本插件自己的调试日志只记录方法名、工具名、状态码、字节数和耗时，响应内容被屏蔽。但当你开启 Zotero 的
  **帮助 → 调试日志** 时，Zotero 自身会记录：每个请求的全部请求头和请求正文的前 1000 个字符；工具调用中经手的附件的绝对路径和
  文件名（例如文件缺失时的 `Attachment file '…\storage\…\作者 - 年份 - 标题.pdf' not found`，路径中含 Windows 用户名）；
  数据库查询的全部参数（例如条目网址、检索条件的值）；全文检索的检索词和缓存文件路径。**与 AI 客户端一起使用时请关闭调试日志**；
  分享或提交调试日志（「提交输出日志」）前逐行检查并删除这些内容，用完后关闭调试日志。

## 8. 停用与卸载

- 临时停用：在「Zotero AI Bridge」设置页面关闭启用开关，或在 **工具 → 插件** 中禁用插件。
- 卸载：**工具 → 插件** 中移除插件。插件不在 Zotero 数据目录中写入任何数据，也不修改 Zotero 或 Zotero Connector 的首选项。
- 同时从 Codex / Claude Code 中卸载客户端插件或删除手动配置，否则客户端每轮会报连接失败（不影响对话本身）。
