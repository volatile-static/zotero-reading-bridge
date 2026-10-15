# Claude Code 手动验收

本脚本在**真实的 Claude Code CLI + 正在运行的 Zotero** 上执行，结果填入 [docs/acceptance.md](../../../docs/acceptance.md)
中编号带 `K` 的行（I-K4、I-K5、E-K*、R-K*、S-K1、F-K*、M-K1），以及与 Codex 对照的 S-X1。每一步都写明了预期结果；
与预期不符时记为“失败”，在“证据”中写下现象。

自动化部分（插件清单、Hook 结构、协议、快照格式）已经由 `npm test`、`tests/clients/plugin-manifests.test.ts` 和
`npm run test:zotero` 覆盖；插件结构已用 `claude plugin validate --strict --json` 校验（acceptance.md B-6）。

## 0. 准备

1. 构建并校验：`npm run build`、`npm run verify`，使用 `outputs/` 中的产物。
2. 按 [install-zotero.md](../../../docs/install-zotero.md) 安装 `zotero-ai-bridge.xpi`，设置页状态为“运行中，地址 127.0.0.1:23119”。
3. 测试数据与 [Codex 脚本](../codex/README.md) 第 0 节相同（论文 A、B，A 带 PDF 和批注）。
4. 确认**没有**手动注册同一地址（插件与手动注册二选一）：

   ```powershell
   claude --version
   claude mcp list
   ```

   如果列表中有指向 `http://127.0.0.1:23119/bridge/mcp` 的非插件服务器，先 `claude mcp remove <名称>`（按其作用域加 `--scope`），
   并从 `~/.claude/settings.json` 删除引用该名称的手动 `UserPromptSubmit` Hook（否则每条消息都会报一次找不到服务器）。

## 1. 安装（I-K4 / I-K5）

按 [install-claude-code.md](../../../docs/install-claude-code.md) 第 3 节操作。

| 步骤 | 预期 |
|---|---|
| `claude plugin marketplace add "<解压目录>"` | “Successfully added marketplace: zotero-ai-bridge-local” |
| `claude plugin install zotero-ai-bridge@zotero-ai-bridge-local` | “Successfully installed plugin … (scope: user)” |
| `claude plugin details zotero-ai-bridge@zotero-ai-bridge-local` | Skills (1) zotero、Hooks (1) UserPromptSubmit、MCP servers (1) zotero |
| `claude mcp list` | `plugin:zotero-ai-bridge:zotero: http://127.0.0.1:23119/bridge/mcp (HTTP)` 显示已连接 |
| 启动 `claude`，输入 `/mcp` | `plugin:zotero-ai-bridge:zotero` 已连接，18 个工具 |
| 输入 `/hooks` | UserPromptSubmit 下有来自插件的 `mcp_tool` Hook |
| I-K5：在 Claude 桌面应用的 Code 标签页中打开同一项目 | 记录是否出现该插件的技能、服务器与 Hook |

## 2. 端到端（E-K1 / E-K2 / E-K3）

每个场景都新开一个会话，Zotero 已经运行。

1. **E-K1**：在 Zotero 条目列表中选中论文 A，发送
   “我当前在 Zotero 中选中的是哪篇论文？请给出 libraryID 和 key。”
   - 回答给出 A 的正确标题和 libraryID + key，并且**没有**调用任何工具。
2. **E-K2**：打开 A 的 PDF，翻到第 3 页左右，选中一段文字，然后切换到 Claude Code 发送
   “我选中的这段话是什么意思？在第几页？”
   - 回答准确引用选中的文字，页码与阅读器中的页码标签一致。
3. **E-K3**：发送“在我的文献库中找关于 <A 的主题词> 的论文，读取第一篇的 PDF 并总结它的方法。”
   - 依次调用 `mcp__plugin_zotero-ai-bridge_zotero__search_items`、`mcp__plugin_zotero-ai-bridge_zotero__get_attachment_path`；
   - 用 Read 工具读取 PDF（项目目录外的文件会请求权限）；
   - 引用中给出 `zotero://select/...` 链接或 libraryID + key。

## 3. 每轮刷新（R-K1 / R-K2）

1. **R-K1**：选中 A，发送“当前选中的是哪篇？顺便告诉我本轮 Zotero 快照的 snapshotId。”；改选 B，发送
   “那这篇呢？snapshotId 是多少？”
   - 第二个回答切换到 B；两个 snapshotId 不同（格式类似 `claude-code/s:…/p:…/n:<序号>/<时间>`，序号递增）。
2. **R-K2**：打开 A 的 PDF，发送“我在读哪篇？”；关闭阅读器标签页，再发送“现在呢？”
   - 第二个回答不再声称阅读器中打开着 A 的 PDF。

## 4. 一致性（S-K1 / S-X1）

1. **S-K1**：选中 A，发送“请分 6 点详细总结当前论文的贡献，每点引用原文。”回答生成期间在 Zotero 中改选 B。
   - 整个回答始终针对 A，给出的 key 与本轮快照一致；下一条消息“现在选中的是哪篇？”回答 B。
2. **S-X1**：与 [Codex 脚本](../codex/README.md) 第 4 节对照，记录在同一行。

## 5. 失败继续（F-K1 – F-K4）

1. **F-K1**：完全退出 Zotero，启动新会话，发送“我当前在 Zotero 中选中的是哪篇论文？”
   - 出现非阻塞的 Hook 错误提示，消息照常得到回答；模型说明当前 Zotero 状态未知，**不**编造选中的论文。
2. **F-K2**：启动 Zotero，在 `/mcp` 中重新连接 `plugin:zotero-ai-bridge:zotero`，再发送 E-K1 的问题 → 恢复正常。
   然后在会话中途退出 Zotero 再发送一条消息 → 非阻塞错误、对话继续。重新启动 Zotero 后再发送一条消息，记录是否自动恢复；
   未恢复时在 `/mcp` 中重新连接后应恢复。
3. **F-K3**：Zotero 运行中，在 Zotero 中禁用插件（**工具 → 插件**），发送消息 → 非阻塞错误（端点 404）、对话继续；重新启用插件后恢复。
4. **F-K4（第一条消息）**：Zotero 运行中，启动 `claude` 后**立即**发送 E-K1 的问题。
   - 记录第一轮是否带有快照（回答是否不调用工具就给出正确论文）。按对 Claude Code 2.1.295 的静态分析，Hook 会在 5 秒内等待
     仍在连接的服务器；如果本轮没有快照，消息也应照常发送，第二条消息应恢复正常。

## 6. 输入最小化（M-K1）

1. Zotero：「帮助 → 调试日志 → 启用」。
2. 在 Claude Code 中发送一条含独特词语的消息，例如“请记住暗号：紫色长颈鹿 7429”。
3. Zotero：「帮助 → 调试日志 → 查看输出日志」，搜索 `capture_prompt_context`：
   - 请求正文的 `arguments` 只有 `client`（`"claude-code"`）、`session_id`、`prompt_id`；
   - 在日志中搜索“紫色长颈鹿”和“7429”，**没有**结果；
   - 以 `[Zotero AI Bridge]` 开头的行只有方法、工具名、状态码、字节数和耗时（同时记录 M-2）。
4. 清空输出日志并关闭调试日志。**不要**点「提交输出日志」。

## 7. 只读（O-4）

完成以上步骤后，在 Zotero 中查看 A、B 的「修改日期」，与开始前相同；没有新增条目、笔记或标签。

## 8. 清理

```powershell
claude plugin uninstall zotero-ai-bridge@zotero-ai-bridge-local
claude plugin marketplace remove zotero-ai-bridge-local
```

如需保留插件，则跳过本节。
