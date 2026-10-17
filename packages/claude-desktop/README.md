# Zotero AI Bridge：Claude 桌面应用扩展

让 Claude 桌面应用（聊天 / Cowork）以**只读**方式访问本机 Zotero。Claude 桌面应用的本地 MCP 服务器和扩展只能是 stdio 命令，
所以本扩展带一个零依赖的 Node 中继程序 `server/zotero-relay.js`：它从标准输入读取 JSON-RPC 消息，逐条 POST 到
`http://127.0.0.1:<端口>/bridge/mcp`，再把 Zotero 的 JSON 响应写回标准输出。

- 中继是 Claude 桌面应用启动的子进程，通过管道通信，**不监听任何端口**；目标主机固定为 `127.0.0.1`，只有端口可以设置（默认 23119）。
- 请求不带 `Origin` 头，User-Agent 为 `zotero-ai-bridge-relay/<版本>`。
- Claude 桌面应用没有 Hook，不会在每条消息前自动附加 Zotero 快照；需要当前选择时，模型调用 `get_current_context`。

安装、手动配置（`claude_desktop_config.json`）与无 Hook 技能的用法见仓库中的 `docs/install-claude-desktop.md`。

## 文件

| 文件 | 作用 |
|---|---|
| `manifest.json` | MCPB 扩展清单：`server.type` 为 `node`，启动命令 `node ${__dirname}/server/zotero-relay.js --port ${user_config.port}` |
| `server/zotero-relay.js` | 构建时由 `src/` 打包成的单个 CommonJS 文件，只使用 Node 内置模块 |
| `README.md` | 本说明 |

## 安全提示

桥接没有身份验证：本机任何程序都能读取文献库。只在你信任的电脑上使用；不要通过局域网、端口转发、反向代理或隧道暴露
23119 端口，也不要把中继改成监听端口的服务。多人共用的电脑上，Zotero 未运行时其他程序可以占用这个端口冒充桥接。
