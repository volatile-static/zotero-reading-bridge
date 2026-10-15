# Claude Code 手动注册示例（不安装插件时使用）

> **二选一：要么安装 Claude Code 插件，要么按本页手动注册，不要同时使用。**
> Claude Code 按 URL 对 MCP 服务器去重，手动注册（local / project / user 作用域）的优先级高于插件。两者同时存在时，
> 插件自带的 `plugin:zotero-ai-bridge:zotero` 服务器会被隐藏，插件 Hook 找不到服务器，每轮都会报非阻塞错误。
> 已在 Claude Code 2.1.295 的临时配置目录中用 `claude mcp list` 实测：同时存在时只列出手动注册的服务器（去重按 URL，与名字无关）。

## 1. 注册 MCP 服务器

推荐使用 user 作用域，这样在所有项目目录中都可用：

```powershell
claude mcp add --transport http --scope user zotero_bridge http://127.0.0.1:23119/bridge/mcp
```

- 服务器名用 `zotero_bridge`（与 Codex 相同），不要用 `zotero`：很多人已经用 `zotero` 注册了别的 Zotero MCP 服务器。Claude Code 中同名
  服务器按 local > project > user 的优先级互相覆盖，某个项目里另有 local / project 作用域的 `zotero` 时，那个服务器会顶替本桥接，
  Hook 也会调用到它。注册前先用 `claude mcp list` 检查是否已有同名服务器。
- 不加 `--scope` 时默认是 local 作用域，只对当前项目目录生效（写入 `~/.claude.json` 中该项目的条目）。
- 端口以 Zotero 设置中「Zotero AI Bridge」页面显示的实际地址为准（默认 23119）。
- 只使用 `127.0.0.1`，不要写 `localhost`：Zotero 只监听 IPv4 回环地址，而 `localhost` 可能先解析到 `::1`。
- 不需要任何请求头或令牌；桥接只读，只接受本机连接。

检查：

```powershell
claude mcp get zotero_bridge
claude mcp list
```

Zotero 运行时应显示已连接；Zotero 未运行时显示连接失败（ECONNREFUSED），这是预期行为。会话内可用 `/mcp` 查看状态和工具列表。

## 2. 可选：每轮自动附加当前 Zotero 选择

把下面的 `hooks` 段合并到 `~/.claude/settings.json`（Windows：`%USERPROFILE%\.claude\settings.json`）。如果文件中已经有
`hooks.UserPromptSubmit`，把这个对象追加到已有数组中，不要覆盖别的 Hook。`server` 必须等于第 1 步注册的名字 `zotero_bridge`。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "mcp_tool",
            "server": "zotero_bridge",
            "tool": "capture_prompt_context",
            "input": {
              "client": "claude-code",
              "session_id": "${session_id}",
              "prompt_id": "${prompt_id}"
            },
            "timeout": 5,
            "statusMessage": "Reading Zotero context"
          }
        ]
      }
    ]
  }
}
```

说明：

- Hook 只发送客户端名、会话 id 和 prompt id，不发送提示词、工作目录或对话记录。
- `timeout` 是整数秒。超过 5 秒时 Claude Code 会取消这次 Hook 并丢弃输出，本轮回答不受影响。
- Zotero 未运行或桥接未连接时，Hook 产生非阻塞错误，消息照常发送，只是没有 Zotero 快照。
- Claude Code 没有逐个 Hook 的信任步骤；在会话中用 `/hooks` 可以查看已加载的 Hook。

## 3. 移除

```powershell
claude mcp remove zotero_bridge --scope user
```

**再从 `~/.claude/settings.json` 删除第 2 步加入的 Hook 对象**（`server` 为 `zotero_bridge` 的那一个）。只删除服务器而留下 Hook 的话，
之后每条消息都会报一次“找不到服务器”的非阻塞错误，改用插件后也一样。之后如需改用插件，参见 `docs/install-claude-code.md`。

早期版本的说明把手动服务器注册为 `zotero`；如果你是按那时的说明配置的，用 `claude mcp remove` 加上旧名字和 `--scope user` 删除它，
并删除 `server` 为 `zotero` 的 Hook，再按上面的步骤以 `zotero_bridge` 重新注册。
