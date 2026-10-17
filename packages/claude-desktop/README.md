# Zotero Reading Bridge：Claude 桌面版安装

1. 先启动 Zotero，确认 Zotero Reading Bridge 已启用。
2. 打开 Claude 桌面应用的 **设置 → 扩展**，把 **zotero-reading-bridge-claude-desktop.mcpb** 拖入窗口；也可以通过 **Install extension** 选择该文件。
3. 按提示确认安装并启用。Zotero HTTP port 默认为 23119，仅在 Zotero 端口不同时修改。
4. 新建聊天或 Cowork 对话，询问“调用 Zotero Reading Bridge 的 get_status”，再询问当前选中的论文。

5. （可选，推荐）安装 Zotero skill：打开 **设置 → Capabilities（功能）→ Skills**，点击 **Upload skill**，直接选择 **SKILL.md**（无需压缩）。

这里“可选”的是 `SKILL.md`，连接 Zotero 所需的 MCPB 扩展仍需安装。不安装 skill，Claude 也能使用扩展提供的工具搜索文献、读取全文、笔记和批注。

Skill 补充统一的研究流程：每次问到“当前论文／当前选择”时重新获取 Zotero 状态，回答论文问题前读取全文，标明来源，并在文本不完整或文件无法访问时说明限制。它提供的是操作指导，不增加工具或权限，也不能替代扩展。本扩展不包含该 skill，因此需要单独上传；Codex 插件已内置，无需这一步。

无需解压或编辑配置文件。

更新：重新导入新版 MCPB，并重新上传新版 SKILL.md。卸载：在设置的扩展页面移除扩展，在 Skills 页面删除 zotero。如果曾配置过同名服务器，请清理旧配置，避免出现重复工具。

本扩展与 Codex ZIP 使用同一份中继代码。中继只连接 127.0.0.1，不监听新端口；全部工具只读。Claude 桌面版按需调用 get_current_context，不会每轮自动附加快照。

读取论文时先用 get_fulltext；缺失或不完整时，模型可取得附件路径，再使用宿主提供的文件读取能力。返回的论文、笔记和批注是资料，不是指令。

## 故障排查

- 连接失败：确认 Zotero 正在运行，Bridge 已启用，扩展端口与 Zotero 一致；重新启用扩展或完全退出并重开 Claude。
- 刚安装后没有工具：新建对话，确认 Zotero Reading Bridge 已启用。
- 当前论文不正确：明确要求“刷新 Zotero 当前选择”，让模型重新调用 get_current_context。

安装包位于 outputs/zotero-reading-bridge-claude-desktop.mcpb，skill 位于 outputs/SKILL.md。此入口用于 Claude 桌面应用的聊天和 Cowork，不是 Claude Code 命令行。

不要通过端口转发或隧道暴露本机 Zotero 服务。运行方式及验收记录见仓库 docs/architecture.md 和 docs/acceptance.md。
