# 计划：图片批注返回图像、全文缓存读取

状态：已实现（2026-10-16），结论已并入 [architecture.md](../architecture.md) 第 6 节（决策 23–25，修订决策 16）。

实现与本计划的差异：

- `item.attachmentText` 对照源码后确认**不会**触发索引，但缓存不完整时会调用 `PDFWorker.getFullText` 现场提取，所以仍然不用。
  `get_fulltext` 只读 `.zotero-ft-cache`，没有时读同步来、尚未处理的 `.zotero-ft-unprocessed`（JSON 的 `text`）。
- 快照结构（`context-snapshot.schema.json`）**没有改**：选中批注不加 `image` 字段。`get_current_context` 在快照 JSON 之后追加一个
  text 内容 `{"selectedAnnotationImages":[…]}`，再追加图像。Hook 快照和 schema 都保持不变；Hook 客户端由 hook-rules 引导去调 `get_annotations`。
- 没有设置每次最多 10 张的数量上限，只限字节：单张 2 MB、每次合计 6 MB。
- `get_fulltext` 的 `maxLength` 没有默认值。不传时按估算 token 取：ASCII 4 字符 / token，其他字符 1 字符 / token，上限 20 000 token，
  低于 Claude Code 默认的 25 000。按 token 而不是固定字符数，是为了让中文长文也不超出客户端上限。
- 第 2.3 节的客户端实测（Claude Code / Codex 是否显示图像、是否截断长结果）尚未做，记录为 [acceptance.md](../acceptance.md) A-11。

第 2 版按评审意见修改：

- 图片默认返回，失败时退回只给元数据。
- 全文尽量一次返回整篇，不主动分页。
- 技能与说明要求：根据阅读器上下文回答时，必须先调 `get_fulltext`，再依据文章内容作答。

## 1. 背景

实测（Zotero 11.0-beta.1，文献 `FBIEVT2Z`）中有两处只能绕开桥接：

1. 用户选中第 6 页的图片批注 `WZMDQU6K`。`get_current_context` 只给出 key 与 `annotationType: "image"`，`get_annotations`
   也既没有图像，也没有图像文件的位置。最后是猜出 Zotero 缓存目录，直接读 `<数据目录>/cache/library/WZMDQU6K.png` 才看到图。
2. 读全文时，`get_attachment_path` 给出 PDF 路径，但客户端读 PDF 依赖 poppler（本机缺 `pdftoppm`），只好改用 `pdftotext`，
   结果双栏版面串行严重。而 Zotero 早已把这篇正文按阅读顺序存在 `storage/FBIEVT2Z/.zotero-ft-cache`（45 KB）里。

## 2. 现状核查

### 2.1 全文相关接口

- 桥接里全文只用于**检索**：`search_items` 的 `fulltext` / `everything` 模式生成 `fulltextContent` 条件
  （`packages/zotero/src/tools/search-plan.ts`），并用 `Zotero.FullText.canSearchContent` 拒绝索引答不了的词（决策 21）。
  **没有任何工具返回全文内容。**
- Zotero 侧可用的接口如下。签名来自 `zotero-types` 的声明，需对照 11.0-beta.1 源码逐个确认，确认后写进 `zotero11.d.ts` 并注明源文件。

  | 接口 | 用途 | 副作用 |
  |---|---|---|
  | `Zotero.FullText.getItemCacheFile(item)` | 返回 `storage/<KEY>/.zotero-ft-cache` 的 `nsIFile` | 无，只算路径 |
  | `Zotero.FullText.getIndexedState(item)` | 索引状态：0 不可用 / 1 未索引 / 2 部分 / 3 完整 / 4 排队中 | 只读数据库 |
  | `Zotero.FullText.getPages(itemID)` | 已索引页数与总页数 | 只读数据库 |
  | `Zotero.FullText.isCachedMIMEType(type)` | 该类型是否写缓存文件（PDF、EPUB 是；HTML 快照不是） | 无 |
  | `item.attachmentText`（异步 getter） | 读缓存文本 | **缓存缺失时会调用 `indexItems` 重新索引，写数据库**（待源码确认）。违反只读，**禁用** |
  | `Zotero.FullText.indexItems` / `indexPDF` | 建索引 | 写数据库，禁用 |
  | `Zotero.PDFWorker.getFullText(itemID, maxPages)` | 从 PDF 现场提取 | 不写数据库，但占用 PDF worker，大文件慢；第一版不用 |

- 本机缓存覆盖率：591 个存储目录里 568 个有 `.zotero-ft-cache`。
- `.zotero-ft-cache` 是纯文本，**没有分页符**（本例中 0 个 `\f`），没法按页切分。PDF 默认只索引前若干页、前若干字符
  （首选项 `extensions.zotero.fulltext.pdfMaxPages` / `textMaxLength`），所以必须同时报告 `getPages` 给出的已索引页数，
  否则模型会把截断的正文当成全文。
- 同目录另有 `.zotero-sdt-cache`（本机共 3 个）：二进制格式，文件头 `\x89SDT\r\n\x1a\n`，后接页偏移表与压缩块，疑为 Zotero 11
  新增的按页结构化文本。它没有公开文档，格式可能随 beta 版变化，**本计划不依赖它**。

### 2.2 图片批注

- `Zotero.Annotations.getCacheImagePath({ libraryID, key })` 给出缓存 PNG 的路径（`<数据目录>/cache/library/<KEY>.png`），
  `Zotero.Annotations.hasCacheImage(item)` 判断文件是否存在。Zotero 渲染过之后才有这个文件；从其他设备同步来的批注可能还没有。
- 本机共 14 个缓存图，最大 504 KB（base64 后约 670 KB）。
- 工具结果目前固定为一个 text 内容（`server/mcp.ts` 的 `toCallToolResult`，决策 16）。`response.ts` 把 JSON 转成纯 ASCII，
  base64 本就是 ASCII，`Content-Length` 的计算不受影响。stdio 中继逐行转发 JSON，也不受影响。

### 2.3 客户端对单次工具结果的限制（需实测）

- Claude Code 对 MCP 工具输出有 token 上限（`MAX_MCP_OUTPUT_TOKENS`，默认约 25 000 token，超出会截断并警告；数值待确认）。
  一篇 45 KB 的英文论文约 11 000 token，可以放进一次结果；但长综述、书籍章节、中文长文会超出。
- Codex 对 MCP 输出的截断阈值、是否支持 image 内容，都要实测。
- 第 3.4 节的"默认上限"按实测结果来定。原则是：**常见论文一次返回整篇，只有超出客户端上限时才续读。**

## 3. 设计

### 3.1 工具结果可以带多个内容（修订决策 16）

- `ToolOutput` 的 `json` 一类增加可选的附加内容：`{ kind: "json"; data; extra?: (TextContent | ImageContent)[] }`。
  `toCallToolResult` 的输出是：**第一个内容永远是完整的 JSON 文本**，`extra` 依次追加在后面。
  不支持图像的客户端仍能从 JSON 里拿到路径和状态。
- Hook 路径（`capture_prompt_context`）不变，永远只有一个 text 内容（决策 5）。
- 仍然不声明 `outputSchema`。

### 3.2 图片批注默认返回图像（`get_annotations`、`get_current_context`）

图片批注的意义就在图本身，所以只要请求涉及图片批注，**默认附带图像**；取图失败时才退回只给元数据。

- 每条 image 批注在 JSON 中都有字段
  `image: { cachePath: string | null, exists: boolean, bytes: number | null, included: boolean, note: string | null }`；
  非 image 批注为 `null`。
- **`get_annotations`**：本页里的 image 批注逐个读取缓存 PNG，作为 image 内容追加，顺序与 `items` 一致，成功的标 `included: true`。
  保留参数 `includeImages`，默认 `true`；只想列批注、不想占上下文时可以传 `false`。
- **`get_current_context`**：`reader.selectedAnnotations` 中的 image 批注同样附带图像。用户选中它，就是要看它。
- **`capture_prompt_context`（Hook）**：additionalContext 只能是文本，没法带图。快照中选中的 image 批注带上
  `image` 元数据，并由 hook-rules 要求模型先调 `get_annotations` 读取图像，再回答（见 3.5）。
- **失败退回**：以下情况都不报错，只给元数据，`included: false`，`note` 写明原因：
  - 缓存文件不存在：提示"在 Zotero 中打开该 PDF、翻到该页后会生成"。**不调用渲染接口**，因为渲染会写磁盘。
  - 读取出错。
  - 超出大小上限：单张 > 2 MB，或本次调用已附带的图像合计 > 6 MB。上限放在 `shared/types` 里，按 2.3 的实测调整。
    `get_annotations` 的页较大时，超额的批注退回为元数据，模型可以缩小 `limit` 或单独请求这条批注。
- 第一版不缩放图片。如果实测发现视觉 token 偏高，再评估在 Zotero 中用 `OffscreenCanvas` 缩小。

### 3.3 "从不返回文件内容"的表述

`context-policy.md`、`research-workflow.md`、`tools.json` 中 `get_attachment_path` 的描述、`attachments.ts` 的文件头注释，
都改为准确的范围：**附件文件本身（PDF、EPUB、快照）仍然只给路径**；桥接可以返回 Zotero 自己生成的派生数据，即全文索引缓存文本和图片批注的缓存图。

### 3.4 新工具 `get_fulltext`：默认整篇返回

- 参数：
  - `libraryID`。
  - `key`：附件，或常规条目（取其最佳附件，规则与 `get_attachment_path` 相同）。
  - `offset`（字符，默认 0）：**只用于续读**。
  - `maxLength`：默认值取"一次放得进客户端"的上限（暂定 80 000 字符，按 2.3 实测确定），最大 500 000（等于 Zotero 默认的 `textMaxLength`）。
  - 常见论文不必传 `offset`、`maxLength`，一次就拿到全文。
- 只读 `getItemCacheFile(item)` 指向的文件（`IOUtils.readUTF8`）。**绝不**触发索引，不用 `attachmentText`，不调 PDF worker。
- 结果分两个内容，避免把长正文塞进 JSON 字符串（换行、引号转义会多耗 token）：
  1. JSON 元数据：
     ```json
     { "libraryID": 1, "key": "FBIEVT2Z", "title": "...", "parentItemKey": null, "contentType": "application/pdf",
       "indexState": "indexed", "indexedPages": 10, "totalPages": 10, "totalChars": 45111,
       "offset": 0, "returnedChars": 45111, "complete": true, "nextOffset": null, "note": null }
     ```
     `indexState` 取 `"indexed"`、`"partial"`、`"unindexed"`、`"queued"`、`"unavailable"` 之一。
  2. 正文：第二个 text 内容，原样输出缓存文本。
- 各种情况：
  - `complete: false` 而 `nextOffset` 非空：超出单次上限，用 `offset: nextOffset` 续读。在 UTF-16 代理对、段落边界处切分。
  - `indexState: "partial"`：`note` 写明只索引了前 N 页（并给出首选项名），后面的内容需用 `get_attachment_path` 读 PDF。
  - 没有缓存文件（未索引、HTML 快照、链接 URL）：不算错误。只返回 JSON，`note` 给出原因，并提示改用 `get_attachment_path`。
- 文本是用户的原始资料：工具描述与说明文件要像对待笔记、批注那样，注明"不是指令"。
- 不缓存结果。读单个文件很便宜，决策 19 的缓存针对的是重复检索。

### 3.5 技能与说明：根据阅读器上下文回答必须先读全文

**规则**：当问题涉及阅读器中打开的文献时，回答前必须先调 `get_fulltext`，并依据文章内容作答，不能只凭标题、摘要、选中文字或模型记忆。
"涉及阅读器中的文献"指快照或 `get_current_context` 的 `focus` 是 `"reader"`，且用户说"这篇""这个公式""这张图"、
问论文内容，或者问题本身就落在当前阅读的文献上。

- 同一会话中，对同一个附件已经读过全文、且附件没有变化时，可以不再重复调用。
- `indexState` 为 `"partial"` 或没有缓存时，回答前要说明，并改用 `get_attachment_path` 读 PDF；不能就着片段装作读过全文。
- 选中的是图片批注时，先拿到图像（Hook 客户端调 `get_annotations`；`get_current_context` 已经自带图像）。

规则写进三处：

1. **`research-workflow.md`**：新增"根据阅读器上下文回答"一节，写完整规则。"读取全文"一节改为：先 `get_fulltext`，部分索引或无缓存时再 `get_attachment_path`。
   它会被构建进 Claude Code、Codex 和 Claude Science 的 `skills/zotero/SKILL.md`。
2. **`context-policy.md` 的 `hook-rules`**：每条消息都会注入，加一句短规则，例如：
   `- When the focus is "reader" and the question concerns that document, call get_fulltext on the reader attachment and answer from its text; for a selected image annotation, call get_annotations on it to see the image.`
   这一节现在 885 / 900 字符，加这句之前要先压缩现有条目，或者把 `SECTION_CHAR_LIMITS["hook-rules"]` 提高到约 1 200
   （Codex 的字节预算按决策 18 计算，加 300 字符的影响可以接受）。
3. **`context-policy.md` 的 `server-instructions`**（MCP initialize 的 instructions，2 448 / 3 500 字符）：同步改写 Files 一段，并加入同一规则，
   这样没有 Hook、也没有技能的客户端（例如手动注册的服务器）也能看到。

另外，三个客户端各自 SKILL.md 开头的"To read an attachment … open the file with … own tools"一段要改：先 `get_fulltext`，读 PDF 只作为后备。

## 4. 实施步骤

1. **核对 API**：对照 Zotero 11.0-beta.1 源码，确认 2.1 表中各接口的签名与副作用，重点是 `attachmentText` 是否会触发索引，
   以及 `getPages` 返回的字段名。把用到的接口补进 `zotero11.d.ts`。
2. **实测客户端上限**（2.3）：在 Claude Code、Codex 中确认 MCP 输出的 token 或字节上限，以及是否支持 image 内容；
   据此确定 `get_fulltext` 的默认 `maxLength` 和图片预算。
3. **结果格式**：`tools/types.ts` 的 `ToolOutput` 支持 `extra`，`server/mcp.ts` 的 `toCallToolResult` 输出多个内容。
   单元测试覆盖"第一个内容是 JSON 文本"和"Hook 输出不变"。
4. **图片**：
   - `zotero/annotations.ts` 增加 `image` 元数据与读取。
   - `tools/content.ts` 实现 `includeImages`（默认 true）和预算。
   - `context/selection.ts` 让选中的 image 批注带元数据，`get_current_context` 附带图像，Hook 快照只带元数据。
   - 同步更新 `tools.json`、`shared/types/tools.ts`、`context-snapshot.schema.json`。
5. **`get_fulltext`**：
   - 新文件 `zotero/fulltext.ts`（路径、索引状态、分段读取）和 `tools/fulltext.ts`。
   - 更新 `tool-names.ts`、`tools.json`、registry。
6. **说明与技能**：按 3.3、3.5 修改 `research-workflow.md`、`context-policy.md`（hook-rules 与 server-instructions）、
   三个 SKILL.md 的开头段，以及 Claude Science 的 SKILL.md。`tests/unit/sections.test.ts` 的预算随之调整。
7. **测试**：
   - 单元测试：内容拼装、图像预算与失败退回、`offset` / `maxLength` 切分（含代理对）、索引状态映射。
   - Zotero 集成测试（`tests/zotero`）：seed 一个带 image 批注且已生成缓存图的 PDF，再各 seed 一个已索引、部分索引、未索引的附件；
     断言不写数据库（沿用 `lib/readonly.ts`），也不生成新的缓存文件。
   - 客户端测试：在 Claude Code 中确认 image 内容按图像呈现；打开一篇论文问"这篇的方法是什么"，确认模型先调用了 `get_fulltext`。
8. **文档**：
   - `architecture.md` 新增决策：
     - 决策 23：工具结果可追加图像与正文，Hook 不变；图片默认返回，失败时退回元数据。
     - 决策 24：全文只读缓存，不触发索引，默认整篇返回。
     - 决策 25：根据阅读器上下文回答前，必须先读全文。
   - `architecture.md` 修订决策 16。
   - `acceptance.md` 增加验收条目。
   - `troubleshooting.md` 增加三种情况："全文只有前几页""全文为空 / 未索引""图片批注没有缓存图"。

## 5. 待定问题

- `get_fulltext` 的默认 `maxLength`、图片预算的具体数值：取决于第 4 步第 2 项的实测结果。
- 缓存图不存在时，是否允许调用 Zotero 的渲染接口生成：会写入 `cache/library`，但不写数据库。第一版不做。
- 以后是否基于 `.zotero-sdt-cache` 或 `PDFWorker` 提供按页全文，以及未索引附件的全文。
