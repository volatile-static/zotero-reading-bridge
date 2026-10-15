# Zotero AI Bridge 首选项面板。Zotero 11 会把所有插件的 FTL 文件合并到同一个命名空间，
# 因此每个消息 ID 都以 "zotero-ai-bridge-" 开头。

zotero-ai-bridge-pref-endpoint-heading = 本地 MCP 端点
zotero-ai-bridge-pref-status-label = 状态：
# $port (String) - Zotero HTTP 服务器的端口
zotero-ai-bridge-pref-status-running = 运行中，地址 127.0.0.1:{ $port }
zotero-ai-bridge-pref-status-server-not-running = Zotero 的本地 HTTP 服务器未运行，无法提供端点。请确认该服务器已启用且端口未被其他程序占用，然后重启 Zotero。
zotero-ai-bridge-pref-status-loopback-unverified = 未启动：无法确认 Zotero 的 HTTP 服务器只接受本机（127.0.0.1）的连接。
# $error (String) - 插件给出的英文错误说明
zotero-ai-bridge-pref-status-error = 错误：{ $error }
zotero-ai-bridge-pref-status-unavailable = 插件未运行。启用 Zotero AI Bridge 后请重新打开此窗口。
zotero-ai-bridge-pref-address-label = 地址：
zotero-ai-bridge-pref-alias-label = 别名（同一端点）：
zotero-ai-bridge-pref-copy-address =
    .label = 复制地址
zotero-ai-bridge-pref-port-note = 这里始终显示 Zotero 实际使用的端口。修改 Zotero HTTP 服务器端口需要重启 Zotero，并同步更新各客户端的配置。

zotero-ai-bridge-pref-clients-heading = 连接 AI 客户端
zotero-ai-bridge-pref-codex-description = Codex：Zotero AI Bridge 的 Codex 插件已包含此服务器及其提示词钩子。插件和手动配置二选一，不要同时使用。手动配置时，请把复制的配置（服务器和可选的钩子）添加到 ~/.codex/config.toml。
zotero-ai-bridge-pref-copy-codex =
    .label = 复制 Codex 配置
zotero-ai-bridge-pref-claude-description = Claude Code：Zotero AI Bridge 的 Claude Code 插件已包含此服务器及其提示词钩子。插件和手动注册二选一，不要同时使用。手动注册时，请运行该命令，并把钩子设置加入 Claude Code 的 settings.json。
zotero-ai-bridge-pref-copy-claude =
    .label = 复制 Claude Code 命令
zotero-ai-bridge-pref-copy-claude-hook =
    .label = 复制钩子设置
zotero-ai-bridge-pref-copied = 已复制到剪贴板。

zotero-ai-bridge-pref-security-heading = 安全
zotero-ai-bridge-pref-security-note = 该端点只监听本机（127.0.0.1），并且是只读的：不会修改你的文献库。它没有密码，因此在开启期间，本机上运行的任何程序都可以读取你的 Zotero 文献库、笔记和附件文件路径。AI 客户端也无法确认连接的确实是 Zotero：Zotero 未运行时，本机其他程序或其他用户可以占用这个端口，并通过客户端的钩子把指令注入每一条消息。在多人共用的电脑上，请不要安装 Codex 或 Claude Code 客户端插件。要关闭端点，请在「工具 → 插件」中禁用 Zotero AI Bridge。
zotero-ai-bridge-pref-debug-note = 开启 Zotero 的调试输出日志时，Zotero 自身会记录收到的请求，并在工具运行时记录附件的路径和文件名、数据库查询的参数（如条目网址、检索词）以及全文检索词。使用 AI 客户端期间请关闭调试输出；提交调试输出前请先检查并删除这些内容。
