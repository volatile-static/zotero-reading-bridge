# Zotero Reading Bridge：Codex 桌面版安装

1. 先启动 Zotero，确认 Zotero Reading Bridge 已启用。
2. 打开 Codex 的 **Customize → Plugins → Add → New Plugin**。
3. 把 **zotero-reading-bridge-desktop.zip** 拖入窗口，点击 **Add plugin**，按提示完成安装并启用。
4. 新建本地对话，询问“读取我当前在 Zotero 中选中的论文，给出 libraryID 和 key”。

无需解压、注册本地市场或编辑配置文件。此包需要本机可用的 Node.js 18+。

插件内置只读 MCP 中继、研究技能和上下文 Hook。自动快照取决于宿主的 Hook 支持与信任；若出现 Review hooks，按界面提示审核。没有快照时，模型可调用 get_current_context 获取当前选择。

更新：拖入新版 ZIP，按界面提示更新。卸载：在插件详情页移除。

安装包由开发命令 npm run package:desktop-plugin 生成，位于 outputs/zotero-reading-bridge-desktop.zip；同次构建的 Claude 桌面扩展位于 outputs/zotero-reading-bridge-claude-desktop.mcpb。旧名称安装包已于 2026-10-17 验证导入成功；新名称安装包需重新导入。

如果曾按旧说明配置过同名服务器或 Hook，请移除旧配置，避免重复工具或旧配置覆盖插件。

中继只连接本机 127.0.0.1:23119，不监听新端口，所有工具只读。先启动 Zotero，再使用插件；不要将端点暴露到公网。
