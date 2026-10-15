# Codex 手动验收

本脚本在**真实的 Codex（CLI 或桌面版）+ 正在运行的 Zotero** 上执行，结果填入 [docs/acceptance.md](../../../docs/acceptance.md)
中编号带 `C` 的行（I-C5、I-C6、E-C*、R-C*、S-C1、S-X1、F-C*、M-C1）。每一步都写明了预期结果；与预期不符时记为“失败”，
在“证据”中写下现象。

自动化部分（插件清单、Hook 结构、协议、快照格式）已经由 `npm test`、`tests/clients/plugin-manifests.test.ts` 和
`npm run test:zotero` 覆盖，这里只验证必须由真实客户端和真实模型完成的部分。

## 0. 准备

1. 构建并校验：`npm run build`、`npm run verify`，使用 `outputs/` 中的产物。
2. 按 [install-zotero.md](../../../docs/install-zotero.md) 安装 `zotero-ai-bridge.xpi`。在「Zotero AI Bridge」设置页确认状态为
   “运行中，地址 127.0.0.1:23119”。
3. 准备测试数据（建议在单独的 Zotero 测试配置文件或可随意改动的文献库中）：
   - 两篇标题容易区分的期刊论文 A、B，至少一篇标题含中文；
   - A 带一个有文字层的 PDF 附件，并有 2–3 条高亮批注；
   - 一个链接文件附件，路径含中文和空格（可选）。
4. 记录版本：

   ```powershell
   codex --version
   ```

   桌面版在 Settings 的关于页查看版本；Zotero 在「帮助 → 关于 Zotero」。填入 acceptance.md 第 0 节。

## 1. 安装（I-C5 / I-C6）

按 [install-codex.md](../../../docs/install-codex.md) 第 2–3 节操作。

| 步骤 | 预期 |
|---|---|
| `codex plugin marketplace add "<解压目录>"` | 输出 ``Added marketplace `zotero-ai-bridge-local` `` |
| `codex plugin add zotero-ai-bridge@zotero-ai-bridge-local`（或桌面版插件目录中安装） | 安装成功 |
| `codex plugin list --json -m zotero-ai-bridge-local` | `installed: true`，`enabled: true` |
| `codex mcp list --json` | 有 `zotero_bridge`，`url` 为 `http://127.0.0.1:23119/bridge/mcp` |
| CLI：启动 `codex`，输入 `/hooks` | 列出 `zotero-ai-bridge@zotero-ai-bridge-local:hooks/hooks.json:user_prompt_submit:0:0`，状态为需要审核；信任它 |
| 桌面版：新对话中出现 “Review hooks” 或在插件详情页 “Trust all” | 信任后 Hook 显示为已启用 |
| 新会话中输入 `/mcp` | `zotero_bridge` 已连接，列出 18 个工具 |

## 2. 端到端（E-C1 / E-C2 / E-C3）

每个场景都**新开一个会话**，并确保 Zotero 在会话开始前已经运行。

1. **E-C1**：在 Zotero 条目列表中选中论文 A，发送
   “我当前在 Zotero 中选中的是哪篇论文？请给出 libraryID 和 key。”
   - 发送时短暂显示 “Reading Zotero context”。
   - 回答给出 A 的正确标题和 libraryID + key（与 Zotero 中一致：可在条目上右键「复制条目链接」或用 `get_items` 核对），
     并且**没有**调用任何工具。
2. **E-C2**：打开 A 的 PDF，翻到第 3 页左右，选中一段文字，然后切换到 Codex 发送
   “我选中的这段话是什么意思？在第几页？”
   - 回答准确引用选中的文字，页码与阅读器中的页码标签一致。
3. **E-C3**：发送“在我的文献库中找关于 <A 的主题词> 的论文，读取第一篇的 PDF 并总结它的方法。”
   - 依次出现 `mcp__zotero_bridge__search_items`、`mcp__zotero_bridge__get_attachment_path`（可能还有 `get_items`）；
   - 用 Codex 自己的文件或 shell 工具读取 PDF（工作区外的文件可能需要批准）；
   - 引用中给出 `zotero://select/...` 链接或 libraryID + key。

## 3. 每轮刷新（R-C1 / R-C2）

1. **R-C1**：选中 A，发送“当前选中的是哪篇？顺便告诉我本轮 Zotero 快照的 snapshotId。”；然后在 Zotero 中改选 B，发送
   “那这篇呢？snapshotId 是多少？”
   - 第二个回答切换到 B；两个 snapshotId 不同（格式类似 `codex/s:…/t:…/n:<序号>/<时间>`，序号递增）。
2. **R-C2**：打开 A 的 PDF，发送“我在读哪篇？”；关闭阅读器标签页，再发送“现在呢？”
   - 第二个回答不再声称阅读器中打开着 A 的 PDF（快照 `focus` 为 `library` 或 `none`）。

## 4. 一致性（S-C1 / S-X1）

1. **S-C1**：选中 A，发送“请分 6 点详细总结当前论文的贡献，每点引用原文。”回答生成期间在 Zotero 中改选 B。
   - 整个回答始终针对 A，给出的 key 与本轮快照一致；
   - 下一条消息“现在选中的是哪篇？”回答 B。
2. **S-X1**：保持同一选择，分别在 Codex 和 Claude Code 中问 E-C1 的问题，两者给出的 libraryID + key、标题一致。

## 5. 失败继续（F-C1 / F-C2 / F-C3）

1. **F-C1**：完全退出 Zotero，新开 Codex 会话，发送“我当前在 Zotero 中选中的是哪篇论文？”
   - 界面显示 Hook 失败（例如 `MCP server 'zotero_bridge' is not connected`），但消息照常得到回答；
   - 模型说明当前 Zotero 状态未知或 Zotero 不可用，**不**编造选中的论文。
2. **F-C2**：启动 Zotero，新开会话确认正常；然后退出 Zotero，再发送一条消息。
   - Hook 失败、对话继续。
   - 重新启动 Zotero 后再发送一条消息，记录**同一会话**是否恢复（端点无状态，每次调用都是新的 HTTP 请求，预期可以恢复）；
     如果没有恢复，新开会话应恢复。注意与 F-C1 的区别：会话**开始时** Zotero 未运行，Codex 不会重连，只能新开会话。
3. **F-C3**：Zotero 运行中，在 Zotero 中禁用插件（**工具 → 插件**），发送消息。
   - Hook 失败（端点 404）、对话继续。重新启用插件后再发送一条消息，记录同一会话是否恢复。

## 6. 输入最小化（M-C1）

1. Zotero：「帮助 → 调试日志 → 启用」。
2. 在 Codex 中发送一条含独特词语的消息，例如“请记住暗号：紫色长颈鹿 7429”。
3. Zotero：「帮助 → 调试日志 → 查看输出日志」，搜索 `capture_prompt_context`：
   - 请求正文的 `arguments` 只有 `client`（`"codex"`）、`session_id`、`turn_id`；`params._meta` 中只有 Codex 自动附加的 `threadId`；
   - 在日志中搜索“紫色长颈鹿”和“7429”，**没有**结果；
   - 以 `[Zotero AI Bridge]` 开头的行只有方法、工具名、状态码、字节数和耗时（同时记录 M-2）。
4. 「帮助 → 调试日志」中清空输出日志并关闭调试日志。**不要**点「提交输出日志」。

## 7. 只读（O-4）

完成以上步骤后，在 Zotero 中查看 A、B 的「修改日期」，与开始前相同；没有新增条目、笔记或标签。

## 8. 清理

```powershell
codex plugin remove zotero-ai-bridge@zotero-ai-bridge-local
codex plugin marketplace remove zotero-ai-bridge-local
```

如需保留插件，则跳过本节。
