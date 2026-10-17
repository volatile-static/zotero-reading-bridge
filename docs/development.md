# Zotero Reading Bridge 开发文档

面向开发者的中文说明。面向用户的英文安装指南见 [README](../README.md)。

Zotero 官方参考：[Zotero 11 for developers](https://www.zotero.org/support/dev/zotero_11_for_developers)。升级 Zotero API 或适配界面视图时优先核对这份迁移文档。

项目与发布包名称为 `zotero-reading-bridge`。本文描述仓库当前实现；接口变更时同步维护本文和工具契约。

让 Codex 和 Claude 桌面应用只读访问本机 Zotero 文献库，并通过独立工具下载不入库的临时研究 PDF。Codex 在宿主支持并信任 Hook 时自动附加当前选择；Claude 桌面版按需获取当前选择。

```text
Codex / Claude 桌面版 → stdio 中继 → 本机 HTTP → Zotero Bridge → 文献库
```

## 组成

| 组件 | 源码 | 构建产物 | 作用 |
|---|---|---|---|
| Zotero 插件 | `packages/zotero/` | `outputs/zotero-reading-bridge.xpi` | 在 Zotero 自带的本机 HTTP 服务器上提供 MCP 端点 `http://127.0.0.1:23119/bridge/mcp`，22 个工具（文献库只读，另支持临时 PDF 下载） |
| Codex 桌面插件 | `packages/codex/` | `outputs/zotero-reading-bridge-codex.zip` | 拖拽导入；内置中继、技能及 `UserPromptSubmit` 上下文 Hook |
| Claude 桌面应用扩展 | `packages/claude-desktop/` | `outputs/zotero-reading-bridge-claude-desktop.mcpb` | 拖拽导入；供 Claude 桌面版聊天与 Cowork 使用，无 Hook，按需调用 `get_current_context` |
| Claude 桌面应用 skill | `packages/claude-skill/` | `outputs/SKILL.md` | MCPB 无法携带 skill，故单独输出一个不压缩的 `SKILL.md`（展开共享说明） |
| 共用中继 | `shared/relay/` | 两个安装包中的 `server/zotero-relay.js` | stdio↔HTTP 中继（零依赖 Node，只连 `127.0.0.1`，不监听端口）；构建时打包一次，同时放入 Codex ZIP 和 MCPB |

## 开发与验证

### 本地构建与接入

源码开发需要 Node.js 22.12 或更新版本（见 `package.json`）。先运行 `npm ci` 安装依赖，
再运行 `npm run build`；产物及用途见[组成](#组成)。按 [Zotero 安装说明](install-zotero.md)、
[Codex 安装说明](../packages/codex/README.md) 或 [Claude 安装说明](../packages/claude-desktop/README.md)
安装构建产物。旧 Zotero AI Bridge 使用不同插件 ID，迁移时先移除旧插件。

保持 Zotero 运行，新建客户端对话并询问当前选择，或使用本文的 JSON-RPC 示例验证接口。
运行已打包的 Codex 中继需要 Node.js 18+；Claude 扩展可用应用自带 Node.js。
更新时重新导入产物，卸载在各应用插件页面完成。

### 常用命令

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 全部 tsconfig 的类型检查（含测试用种子插件与共用中继 `shared/relay/`） |
| `npm test` | 单元测试（`tests/unit`）、协议测试（`tests/protocol`）与集成测试工具自检（`tests/zotero`）（Node，不启动 Zotero） |
| `npm run build` | 类型检查 → 打包 → 一次生成三个插件（XPI、Codex ZIP、MCPB）以及 `SKILL.md`、`updates.json`、`BUILD-INFO.json` → 自动运行产物校验 |
| `npm run verify` | 重新校验 `outputs/` 中已有的产物 |
| `npm run test:zotero` | 在独立的 Zotero 测试配置文件（端口 23139）中运行集成测试，不触碰你的 Zotero 配置和数据 |

版本号、作者、许可证与关键词只在 `package.json` 中维护，构建时写入全部清单。代码、标识符、工具说明和注释使用英文；面向用户的文档使用中文。

### 全文下载交互回归

设置 `ZAB_TEST_ARTICLE_URL` 后运行
`npm run test:zotero -- --only downloads.publisher-captcha`，在独立测试 Zotero 窗口中手动完成验证。
该用例不在无人值守测试中自动启用。

2026-10-17 的验证记录：

| 用例 | 结果与范围 |
|---|---|
| ScienceDirect：`10.1016/j.jmr.2023.107424` | 进入验证窗口后下载成功，文献库指纹未变化。 |
| ACS：`10.1021/acsanm.6c02937` | 独立配置中 DOI 跳转后的文章页返回 403，当时 Zotero 验证规则未匹配 ACS，自动下载未通过。用户通过日常浏览器 Connector 保存成功，库内已有 PDF；两者会话不同。 |
| 宿主内置浏览器回退 | 已更新 skill 指令，尚未完成上述 ACS 论文全文读取的端到端验证。 |

其他验收项见 [acceptance.md](acceptance.md)。

## Endpoint 接口 API

### HTTP 入口与请求头

当前只有一个 HTTP endpoint，全部工具通过它的 JSON-RPC `tools/call` 方法调用，没有单独的 `/search_items` 或 `/get_status` REST 路由。

| 项目 | 约定 |
|---|---|
| URL | `http://127.0.0.1:23119/bridge/mcp`；端口随 Zotero HTTP 端口配置变化 |
| HTTP 方法 | `POST` |
| 请求体 | JSON-RPC 2.0 对象；请求 `id` 为字符串或数字，不能为 `null` |
| `Content-Type` | 使用小写 `application/json`，可以附带 `; charset=utf-8` |
| `Accept` | 建议 `application/json`；可以省略，但不能排除 JSON |
| `MCP-Protocol-Version` | 初始化后发送协商版本；支持 `2025-11-25`、`2025-06-18`、`2025-03-26`，省略时按 `2025-03-26` 处理 |
| `Host` | 回环地址且端口必须与 Zotero 实际端口一致；客户端连接地址使用 `127.0.0.1` |
| `Origin` | 不得携带；到达 Bridge 的任何带 `Origin` 请求均被拒绝 |
| 响应 | JSON 响应使用 `Content-Type: application/json`；通知返回空响应；连接关闭后下次重新连接 |
| 会话与流 | 无状态，不签发 session ID，不提供 SSE、GET 事件流或 DELETE 会话接口 |

请求经过 Zotero 自带 HTTP 服务器后才到达 Bridge；浏览器请求、非法 JSON 或不支持的 HTTP 方法可能先被 Zotero 拒绝。接口供本机程序调用，访问边界见[安全边界](#安全边界)。

### JSON-RPC 方法

| `method` | `params` | `result` / 行为 |
|---|---|---|
| `initialize` | 通常传 `protocolVersion`、`capabilities`、`clientInfo` | 返回 `protocolVersion`、`capabilities.tools.listChanged: false`、`serverInfo` 和 `instructions`；请求版本受支持时原样采用，否则返回 `2025-11-25` 供客户端判断 |
| `ping` | 省略或 `{}` | `{}` |
| `tools/list` | 省略或 `{}` | `{tools: [...]}`，一次返回全部 22 个工具及 `inputSchema`、`annotations`，没有后续页 |
| `tools/call` | `{name: "工具名", arguments: {...}}`；省略 `arguments` 相当于 `{}` | MCP `CallToolResult`，见下文 |
| `notifications/initialized` 等通知 | 不带 `id` | HTTP 202、空响应；不执行工具调用 |
| `server/discover` | 探测请求 | HTTP 400，JSON-RPC `-32601`，保留请求 id；客户端应回退到 `initialize` |

不提供 `resources/*`、`prompts/*` 方法；其他未知方法返回 `-32601`。只有 `2025-03-26` 支持 JSON-RPC 数组批请求：1–32 条、不能包含 `initialize`；纯通知批请求返回 202，其余返回响应数组。

### 工具参数速查

以下参数均位于 `tools/call.params.arguments`。**粗体参数必填**；其余为可选。完整类型、枚举、长度限制及默认值以运行时 `tools/list` 或 [tools.json](../shared/contracts/tools.json) 为准；工具不接受未声明的额外参数。

- `libraryID`：正整数，省略时使用个人文献库；群组库 ID 从 `list_libraries` 获取。
- `key` / `keys`：使用服务端返回的 8 位 Zotero key；与 `libraryID` 一起定位对象。
- 表中“分页”代表 `limit`（默认 50，范围 1–200）和 `cursor`。将响应 `nextCursor` 原样传回，保持原查询条件；`null` 表示结束。通用分页结果包含 `items`、`total`、`offset`、`limit`、`nextCursor`，个别工具外层另含集合等信息。

| 工具 | 参数 | 返回内容 |
|---|---|---|
| `get_status` | 无 | Bridge / Zotero 版本、endpoint、协议版本和文献库状态 |
| `get_current_context` | `maxTextLength`（默认 4000，0–20000） | 带时间戳的当前界面快照；选中的图片批注另附图像状态及图片 |
| `get_current_view_items` | 分页 | 当前文库标签页的实际条目列表，支持文库根目录、集合、保存搜索及全部特殊视图（包括订阅源）；保留筛选、排序与展开子条目。游标固定初次列表两分钟（最多三份），省略游标重新读取；条目元数据在各页返回时读取 |
| `capture_prompt_context` | **`client`**、`session_id`、`turn_id`、`prompt_id` | Hook JSON：`hookSpecificOutput.additionalContext`；仅供客户端 Hook 使用 |
| `list_libraries` | 分页 | 个人库、群组库与订阅源库 |
| `list_collections` | `libraryID`、`parentKey`、`recursive`（默认 false）、`includeItemCounts`（默认 true）、分页 | 集合层级及条目数量 |
| `get_collection` | **`key`**、`libraryID`、`includeItems`（默认 true）、分页 | 集合路径、最多 50 个直接子集合及条目分页；更多子集合用 `list_collections` |
| `list_saved_searches` | `libraryID`、分页 | 已保存搜索及条件摘要 |
| `run_saved_search` | **`key`**、`libraryID`、分页 | 已保存搜索的条目结果 |
| `search_items` | `query`、`mode`、`tags`、`creator`、`itemType`、`collectionKey`、`includeChildItems`、`sort`、`direction`、`libraryID`、分页 | 匹配条目；至少提供 `query` 或一个筛选条件 |
| `get_items` | **`keys`**（1–50 个，不重复）、`libraryID`、`includeChildren`（默认 true） | 完整元数据及可选子条目摘要 |
| `get_item_children` | **`key`**、`libraryID`、`types`、分页 | 直接子条目；`types` 可选 `note`、`attachment`、`annotation` |
| `list_tags` | `libraryID`、`query`、分页 | 标签名称、类型、颜色及条目数量 |
| `get_notes` | **`key`**、`libraryID`、`includeHtml`（默认 true）、`maxLength`（默认 20000，100–200000）、分页 | HTML / 纯文本笔记及截断标记 |
| `get_annotations` | **`key`**、`libraryID`、`types`、`includePosition` / `includeImages`（均默认 true）、分页 | 批注、页码、链接；图片批注可附 PNG 内容 |
| `list_attachments` | **`key`**、`libraryID`、分页 | 附件类型、文件名、本地路径及存在状态 |
| `get_attachment_path` | **`key`**、`libraryID` | 附件路径、`exists`、说明；普通条目使用最佳附件（PDF 优先） |
| `get_fulltext` | **`key`**、`libraryID`、`offset`（默认 0）、`maxLength`（可选，1000–500000） | 第一段为 JSON 元数据，第二段为已提取的文本；不触发提取或下载 |
| `download_fulltext` | **`url`**（HTTP(S)，最长 8192 字符）、`kind`（`page`／`pdf`，默认 `page`）、`allowCaptcha`（默认 true） | 启动临时 PDF 下载，返回任务状态及 `downloadID`；文章／DOI 用 `page`，PDF 直链用 `pdf` |
| `get_fulltext_download` | **`downloadID`**（最长 64 字符） | 查询下载任务；状态及文件生命周期见下节 |
| `get_library_paths` | 无 | 数据目录、storage、数据库路径和关联附件基目录 |
| `get_schema` | `itemType` | 省略时列出条目类型；指定时返回有效字段与作者类型 |

`search_items.mode` 支持 `titleCreatorYear`（默认）、`fields`、`everything`、`fulltext`；`sort` 默认 `dateModified`，也可为 `dateAdded`、`title`、`date`，`direction` 默认 `desc`，可设 `asc`。全文检索只查询 Zotero 已有索引，短词及中英文混合词的限制见工具契约。`get_annotations.types` 支持 `highlight`、`underline`、`note`、`text`、`image`、`ink`。

### 下载任务契约

两个下载工具返回相同的任务对象，字段定义见 [FulltextDownload](../shared/types/tools.ts)：

| 字段 | 含义 |
|---|---|
| `downloadID`、`requestedURL` | 任务标识和规范化后的输入 URL |
| `status` | `running`（进行中）、`complete`（PDF 已校验）、`not_found`（未找到可下载文件）、`failed`（执行或验证失败） |
| `sourceURL`、`path`、`bytes` | 成功时的来源 URL、临时 PDF 绝对路径和大小；其他状态为 null |
| `pollAfterMs` | 下次轮询至少等待的毫秒数；任务结束后为 null |
| `expiresAt` | 结果到期时间；运行中为 null |
| `note` | 当前状态的说明或失败原因 |

调用 `download_fulltext` 后，使用返回的 ID 轮询 `get_fulltext_download`；遵守 `pollAfterMs`，
遇到终态停止轮询。不要用重复启动代替查询，也不能仅凭 `running` 判断验证码窗口是否显示。
`allowCaptcha: true` 允许 Zotero 打开受支持站点的验证窗口，由用户完成验证；false 禁止交互窗口，
不代表能跳过验证。客户端调用前应提示这一交互可能性。

一次只运行一个任务：相同参数的运行中请求复用 ID，不同请求返回 `UNAVAILABLE`。
最多保留 10 个任务；终态结果保留一小时，容量满时淘汰最旧结果。正常插件关闭清理临时文件，
重启后 ID 失效；崩溃时文件清理只能尽力而为。查询已过期、被淘汰或重启前的 ID 返回 `NOT_FOUND`。

调用方不能指定落盘路径。`complete.path` 位于 Zotero 所在电脑，客户端须自行读取并及时复制需要保留的文件；
Bridge 不传输文件，也不为临时 PDF 创建条目、索引或附件，因此不能用库内 `get_fulltext` 读取它。
工具注解中 `download_fulltext` 为 `readOnlyHint: false`、`openWorldHint: true`；
`get_status` 的 `readOnly: false`、`libraryReadOnly: true` 区分文件写入与文献库只读。

### 调用示例与响应解析

下面的 JavaScript 示例使用 Node.js 18+ 内置的 `fetch`，保存为 `.mjs` 后运行。它执行初始化、发送初始化通知、列出工具并获取当前选择。Zotero 与 Bridge 应已启动；`endpoint` 的端口按本机配置调整。浏览器页面受前述 Origin 限制，不能直接运行此示例。

```javascript
const endpoint = "http://127.0.0.1:23119/bridge/mcp";
const headers = { "Content-Type": "application/json", Accept: "application/json" };

async function rpc(message) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  if (response.status === 202) return; // Notifications have no response body.
  const reply = await response.json();
  if (reply.error) throw new Error(JSON.stringify(reply.error));
  if (reply.result.isError) throw new Error(reply.result.content[0].text);
  return reply.result;
}

const init = await rpc({
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "bridge-dev", version: "1.0.0" },
  },
});
headers["MCP-Protocol-Version"] = init.protocolVersion;
await rpc({ method: "notifications/initialized" });
const toolList = await rpc({ id: 2, method: "tools/list" });
console.log(toolList.tools);
const result = await rpc({
  id: 3,
  method: "tools/call",
  params: { name: "get_current_context", arguments: {} },
});
const snapshot = JSON.parse(result.content[0].text);
console.log(snapshot);
```

常规成功响应为 `{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"..."}]}}`。多数工具把业务 JSON 编码在 `content[0].text` 中，需再解析一次；不要把所有 `text` 都当 JSON：`get_fulltext` 的第二段是原文，图片内容是独立的 `type: "image"` 对象（`data` 为 Base64，带 `mimeType`）。返回类型可查 [tools.ts](../shared/types/tools.ts)，上下文快照结构可查 [context-snapshot.schema.json](../shared/contracts/context-snapshot.schema.json)。

`get_fulltext` 的 `complete: false` 表示仍有已提取文本可取，用 `nextOffset` 继续；`indexState: "partial"` 表示 Zotero 只索引了部分页面，即使读完所有返回文本也不等于读完整篇。`get_attachment_path` 不传输文件，`exists: true` 也只证明文件存在于 Zotero 所在电脑。

### 错误处理

| 层次 | 状态 / 标记 | 含义 |
|---|---|---|
| HTTP | 200 | 已处理 JSON-RPC 请求；仍须检查 `error` 和 `result.isError` |
| HTTP | 202 | 通知或客户端响应已接收，无响应正文 |
| HTTP | 400 | 无效消息、不可用协议版本、非法批请求，或 `server/discover` 探测；解析错误也可能由 Zotero 提前返回 |
| HTTP | 403 | Bridge 拒绝 Origin 或 Host；Zotero 自身也可能先拒绝请求 |
| HTTP | 405 | 到达 Bridge 的非 POST 请求；附 `Allow: POST` |
| HTTP | 406 / 415 | 不接受 JSON 响应 / 请求 Content-Type 不支持 |
| JSON-RPC | `error.code` | `-32700` 解析失败、`-32600` 无效请求、`-32601` 未知方法、`-32602` 非法 RPC 参数或未知工具、`-32603` 内部错误、`-32000` 传输层拒绝 |
| 工具 | `result.isError: true` | 工具参数校验或执行失败；`content[0].text` 是 `{error: {code, message, details?}}` 的 JSON 字符串 |

工具参数不符合 schema 时返回工具错误 `INVALID_ARGUMENT`；例如 `tools/call` 缺少字符串 `name` 或 `arguments` 不是对象，则属于 JSON-RPC `-32602`。不要只依据 HTTP 200 判定调用成功。

后台下载的 `failed`／`not_found` 是任务对象的业务状态，不等同于查询工具的 `isError: true`。

## 实现原理

### 服务端与客户端的职责

[endpoint.ts](../packages/zotero/src/server/endpoint.ts) 注册入口，
[mcp.ts](../packages/zotero/src/server/mcp.ts) 分发协议请求，
[access.ts](../packages/zotero/src/server/access.ts) 检查访问边界。
[FulltextDownloads](../packages/zotero/src/tools/fulltext-download.ts) 管理内存任务、轮询结果和清理计时器；
Zotero 适配层负责实际下载。任务对外状态及保留期限见[下载任务契约](#下载任务契约)。

### Bridge 直接调用的 Zotero API

下载适配实现位于 [zotero/fulltext-download.ts](../packages/zotero/src/zotero/fulltext-download.ts)，
验证码回调位于 [publisher-challenge.ts](../packages/zotero/src/tools/publisher-challenge.ts)。核心调用为：

```typescript
const result = await Zotero.Attachments.downloadFirstAvailableFile(
  [request.kind === "pdf" ? { url: request.url } : { pageURL: request.url }],
  path,
  {
    enforceFileType: true,
    shouldDisplayCaptcha: request.allowCaptcha,
    onBeforeRequest: callbacks.onBeforeRequest,
    onRequestError: callbacks.onRequestError,
  },
);
```

| API | 本项目传参及用途 |
|---|---|
| `Zotero.Attachments.downloadFirstAvailableFile(urlResolvers, path, options)` | 参数映射见上方代码；成功对象中的 `url` 映射为 `sourceURL`。返回 `false` 且未记录验证错误时为 `not_found`；验证错误、异常或后续 PDF 校验失败为 `failed`。 |
| `Zotero.BrowserRequest.getEntryForURL(url)` | 403 回调中查询当前请求 URL 是否匹配 Zotero 内置的站点验证规则；无匹配时不申请验证重试。 |
| `Zotero.BrowserRequest.clearChallenge(url, {entry, allowViewer})` | 下一次请求前等待站点验证完成；`entry` 来自上面的规则查询，`allowViewer` 等于 `allowCaptcha`。这一步可打开 Zotero 验证窗口。 |
| `Zotero.MIME.sniffForMIMEType(sample)` | 下载后读取文件前 1024 字节并检查结果为 `application/pdf`；Zotero 下载 API 也支持 EPUB，因此本项目另做 PDF 校验。 |

临时路径、文件读取、大小检查和清理由 Zotero 运行环境中的 Mozilla API 完成：
`Services.uuid.generateUUID()` 生成文件标识，`PathUtils.join(PathUtils.tempDir, ...)` 生成路径，
`IOUtils.read / stat / remove` 读取、检查和清理文件。它们不操作 Zotero 文献库。
`get_fulltext_download` 只读 Bridge 内存中的任务状态，不再调用 Zotero 下载 API。

### Zotero 内部的下载调用链

以下是所核对 Zotero 源码中的内部行为，Bridge 不直接调用这些下层方法：

- 文章页由 `Zotero.Attachments.downloadFirstAvailableFile` 请求并处理跳转；需要从 HTML 找文件时，
  调用 `Zotero.Utilities.Internal.getFileFromDocument(doc)`。后者使用 `Zotero.Translate.Web`，
  以 `translate({libraryID: false, saveAttachments: true})` 提取附件链接；`libraryID: false` 表示不入库。
- 得到文件 URL 后使用 `Zotero.Attachments.downloadFile(url, path, options)`，先尝试
  `Zotero.HTTP.download`。若启用了文件类型检查，发生无效文件或 HTTP 403，且 URL 匹配站点规则，
  才转到 `Zotero.BrowserRequest.downloadPDF(url, path, options)`。
- `downloadPDF` 先通过 Zotero 的隐藏浏览器取得 PDF；隐藏下载失败、允许验证码窗口且检测到已知
  验证码时，再调用内部的 `downloadPDFViaViewer`。这与客户端 skill 的 `@Browser` 回退是两个机制。

对应上游源码固定于提交 `db41b99fddcc52d38897c59c161b6adaca036afb`：
[downloadFirstAvailableFile](https://github.com/zotero/zotero/blob/db41b99fddcc52d38897c59c161b6adaca036afb/chrome/content/zotero/xpcom/attachments.js#L1978)、
[downloadFile](https://github.com/zotero/zotero/blob/db41b99fddcc52d38897c59c161b6adaca036afb/chrome/content/zotero/xpcom/attachments.js#L1176)、
[getFileFromDocument](https://github.com/zotero/zotero/blob/db41b99fddcc52d38897c59c161b6adaca036afb/chrome/content/zotero/xpcom/utilities_internal.js#L1495)、
[BrowserRequest.downloadPDF](https://github.com/zotero/zotero/blob/db41b99fddcc52d38897c59c161b6adaca036afb/chrome/content/zotero/xpcom/browserRequest.js#L567)。
这些是 Zotero 内部 JavaScript API，升级 Zotero 时应重新核对；本实现不调用入库方法
`Zotero.Attachments.addFileFromURLs`，也不调用 `Zotero.Item.save` 或 `saveTx`。

### 页面 403 与验证回调

文章页面也可能先返回 403（例如 DOI 跳转到 ScienceDirect），尚未到 PDF 下载阶段。对于 Zotero
`BrowserRequest` 能识别的站点，错误回调只申请一次重试，在下一次 `onBeforeRequest` 中等待
`clearChallenge(..., {allowViewer: allowCaptcha})`。错误回调本身是同步接口，不能直接返回异步验证。
用户取消或验证超时作为 `failed` 返回，不把它报成没有全文。

### 客户端浏览器回退

全文获取策略由 [research-workflow.md](../shared/instructions/research-workflow.md) 维护，
[context-policy.md](../shared/instructions/context-policy.md) 提供服务端简要说明；构建时展开到客户端产物。
其他来源和现有附件不能提供全文时，先调用 Zotero 下载；下载失败或工具不可用时，
由客户端使用宿主内置浏览器读取全文 HTML 或下载 PDF。具体交互、引用和内容完整性要求以 skill 为准。

浏览器回退不是 Bridge 的 MCP 端点，也不是上文的 Zotero 隐藏浏览器。
它依赖宿主实际提供的浏览器工具；下载文件由宿主管理，不受 Bridge 的清理计时器管理。
Zotero、宿主内置浏览器和日常 Chrome／Edge 的登录状态不能假定互通；
机构登录或验证码须在实际使用的窗口完成。

Connector 从浏览器已加载的页面启动识别与保存；Bridge 仅传入一个文章／PDF resolver，
没有调用 `getFileResolvers` 组合 DOI、OA 和自定义解析器，也不调用 Connector 保存接口。
因此 Connector 保存成功不保证此下载接口成功，HTTP 403 也不能单独证明用户没有订阅权限。

## 安全边界

- **文献库只读**：不创建、修改或删除库内条目、笔记、标签、集合及附件，不触发同步。临时全文下载会请求外部网站并写入、清理临时 PDF；客户端浏览器回退也可能下载文件。
- **只在本机可访问**：Zotero 的 HTTP 服务器只监听 `127.0.0.1`，插件在注册端点前会确认这一点；浏览器网页的请求大多被 Zotero 直接断开，
  能到达插件的带 `Origin` 请求一律 403。
- **但没有身份验证**：本机上的任何程序和任何用户都能读取你的整个文献库并请求临时下载。只在你信任的电脑上启用；要停止桥接，在 Zotero 中禁用插件（**工具 → 插件**）。
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

## 发布到 GitHub

[Release packages 工作流](../.github/workflows/release.yml) 在 GitHub Release 发布时自动测试、打包、校验并上传附件，正式版和预发布版都支持。

1. 更新版本号，例如运行 `npm version 0.2.1 --no-git-tag-version`，同步修改 `package.json` 和 `package-lock.json`。插件清单中的版本由构建自动写入。
2. 提交并推送代码（首次使用时也要包含 `.github/workflows/release.yml`）。
3. 在 GitHub 的 **Releases → Draft a new release** 中，选择这次提交并创建与版本号一致的标签，例如 `v0.2.1`（也接受 `0.2.1`），填写说明后点击 **Publish release**。无需手动上传附件。
4. 在 **Actions → Release packages** 查看执行结果。成功后，该 Release 的 Assets 会出现三个安装包、`SKILL.md`、`updates.json` 和 `BUILD-INFO.json`（包含包大小及 SHA-256）。

源码使用 GitHub Release 自带的 Source code 下载入口，构建不再额外生成或上传 `source.zip`。

`updates.json` 由构建根据 XPI 自动生成，下载地址固定到本次标签，包含 XPI 的 SHA-256 与 Zotero 兼容范围。Zotero 的 `update_url` 指向最新正式 Release 的此附件，预发布版不会进入此更新入口。0.2.1 及更早版本使用占位地址，需要手动安装一次 0.2.2 或更新版本。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需配置个人访问令牌；仓库须启用 GitHub Actions，并允许工作流声明的 `contents: write` 权限。

保存草稿、编辑已发布 Release 或普通代码推送不会触发上传。Release 发布后到构建完成前，附件暂时不可用；测试、类型检查或产物校验失败时不会执行上传。临时失败可在 Actions 中选择 **Re-run failed jobs**；重新执行会替换该 Release 的同名附件，也可修复上传中断造成的缺失附件。若代码或版本号有误，应提交修复并用新版本标签发布。

## 相关文档

| 文档 | 内容 |
|---|---|
| [install-zotero.md](install-zotero.md) | 安装 Zotero 插件、设置页面、验证端点、修改端口 |
| [packages/codex/README.md](../packages/codex/README.md) | Codex 桌面插件：拖拽安装、Hook 信任、更新与卸载 |
| [packages/claude-desktop/README.md](../packages/claude-desktop/README.md) | Claude 桌面应用扩展：`.mcpb` 拖拽安装、聊天与 Cowork、故障排查 |
| [architecture.md](architecture.md) | 架构、协议细节、安全边界、设计决策与原计划差异 |
| [troubleshooting.md](troubleshooting.md) | 故障排查 |
| [acceptance.md](acceptance.md) | 验收清单与记录 |

## 许可证

作者：volatile-static。GNU GPL v3 或更新版本（GPL-3.0-or-later）许可证，见 [LICENSE](../LICENSE)。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
