# 在 Codex 中安装

适用于 Codex CLI 和 Codex 桌面版（IDE 扩展不支持插件，只能用第 6 节的手动配置，且没有 Hook）。
本文的命令在 codex-cli 0.162.0-alpha.17.2（Windows 11）上用临时 `CODEX_HOME` / `HOME` 实际执行过（见第 8 节）。

先完成 [install-zotero.md](install-zotero.md)，并确认 Zotero 正在运行。

> **多人共用的电脑上不要安装本插件（或不要信任它的 Hook）。** Codex 无法验证 `127.0.0.1:23119` 上的程序真是 Zotero：
> Zotero 未运行时，其他程序或其他用户可以占用这个端口，通过 Hook 把任意文字注入每一条消息（见 [install-zotero.md](install-zotero.md) 第 7 节）。

## 1. 插件包结构

`outputs/zotero-ai-bridge-codex.zip` 解压后的根目录就是插件根目录，同时也是一个只含这一个插件的本地市场：

```
zotero-ai-bridge-codex/
├── .agents/plugins/marketplace.json   本地市场：name = zotero-ai-bridge-local，plugin path = "./"
├── .codex-plugin/plugin.json          插件清单
├── .mcp.json                          MCP 服务器 zotero_bridge → http://127.0.0.1:23119/bridge/mcp
├── hooks/hooks.json                   UserPromptSubmit → capture_prompt_context
├── skills/zotero/SKILL.md             使用说明（Codex 中显示为 zotero-ai-bridge:zotero）
├── assets/icon.svg
└── README.md
```

为什么是 `.codex-plugin/plugin.json` + `.mcp.json`，而不是原计划的根目录 `plugin.json` + `mcp.json`，以及为什么服务器名是
`zotero_bridge`，见 [architecture.md](architecture.md) 的“与原计划的差异”。

## 2. 安装插件

1. 把 zip 解压到一个长期保留的目录，例如 `%USERPROFILE%\zotero-ai-bridge\codex`。Codex 会记住这个目录作为市场来源，
   安装时再把插件复制到 `~/.codex/plugins/cache/zotero-ai-bridge-local/zotero-ai-bridge/<版本>/`。
2. 注册本地市场：

   ```powershell
   codex plugin marketplace add "$env:USERPROFILE\zotero-ai-bridge\codex"
   ```

   输出应为 ``Added marketplace `zotero-ai-bridge-local` from <目录>.``。这一步会在 `~/.codex/config.toml` 中写入
   `[marketplaces.zotero-ai-bridge-local]`（`source_type = "local"`）。
   如果 `codex` 不在 PATH 中，桌面版自带的 CLI 位于 `%LOCALAPPDATA%\OpenAI\Codex\bin\<版本目录>\codex.exe`。
3. 安装（二选一）：
   - **CLI**：

     ```powershell
     codex plugin add zotero-ai-bridge@zotero-ai-bridge-local
     ```

     写入 `[plugins."zotero-ai-bridge@zotero-ai-bridge-local"] enabled = true`。
   - **桌面版**：重启 Codex 桌面版，打开 Plugins（插件目录），在来源中选择 “Zotero AI Bridge (local)”，打开
     Zotero AI Bridge 并安装。桌面版的插件目录也提供 “Add marketplace”，可以代替第 2 步。
4. 检查：

   ```powershell
   codex plugin list --json -m zotero-ai-bridge-local   # installed: true, enabled: true
   codex mcp list --json                                 # 出现 zotero_bridge，url 为 /bridge/mcp
   ```

## 3. 信任 Hook（必须）

Codex 不会自动信任第三方插件的 Hook。未信任的 Hook 不运行，此时 Codex 照常回答，只是没有每轮的 Zotero 快照。
信任方式任选其一：

- **桌面版**：输入框上方出现 “Review hooks · 1 need approval” 时点开，选择允许；或在插件详情页的 Hooks 部分点 “Trust all”；
  或在 **Settings > Hooks** 的 “From Plugins” 分组中信任。
- **CLI**：在会话中输入 `/hooks`，信任
  `zotero-ai-bridge@zotero-ai-bridge-local:hooks/hooks.json:user_prompt_submit:0:0`。

信任记录保存在 `~/.codex/config.toml` 的 `[hooks.state."<上述键>"] trusted_hash = "sha256:..."`。这个哈希覆盖 Hook 的
`server`、`tool`、`input`、`timeout`、`statusMessage`。**Hook 定义有任何改动（例如升级到改了 Hook 的新版本）都会使信任失效**，
需要重新信任；只改版本号或其他文件不影响信任。

Hook 发送给 Zotero 的内容只有：

```json
{ "client": "codex", "session_id": "${session_id}", "turn_id": "${turn_id}" }
```

不发送提示词、工作目录或对话记录路径。超时为 5 秒；失败（Zotero 未运行、超时等）不会阻止消息发送。

## 4. 在新对话中验证

技能、MCP 工具和 Hook 只对**新会话**生效。

1. 确认 Zotero 已经运行，然后新建一个 Codex 对话（CLI：重新启动 `codex`；桌面版：New chat）。
2. 在 Zotero 中选中一篇论文（或打开它的 PDF 并选中一段文字）。
3. 发送：“我当前在 Zotero 中选中的是哪篇论文？请给出 libraryID 和 key。”
   - 发送时界面短暂显示 “Reading Zotero context”。
   - 回答应给出正确的标题以及 libraryID + key，并且不需要先调用工具。
4. 在 Zotero 中改选另一篇论文，再发送“那这篇呢？”，回答应切换到新论文。
5. 发送“搜索我的文献库中关于 <主题> 的论文”，Codex 应调用 `mcp__zotero_bridge__search_items`。

完整的验收步骤见 [tests/clients/codex/README.md](../tests/clients/codex/README.md)，结果记录在 [acceptance.md](acceptance.md)。

## 5. 更新与卸载

- **更新**：用新版本的文件替换第 2 步的目录内容，然后重新执行
  `codex plugin add zotero-ai-bridge@zotero-ai-bridge-local`（会安装新版本并替换缓存）。
  `codex plugin marketplace upgrade` 只适用于 Git 市场，对本地目录会报错 “is not configured as a Git marketplace”。
  更新后重启 Codex 桌面版或新开 CLI 会话；如果 Hook 定义有变化，需要重新信任。
- **卸载**：

  ```powershell
  codex plugin remove zotero-ai-bridge@zotero-ai-bridge-local
  codex plugin marketplace remove zotero-ai-bridge-local
  ```

- **非默认端口**：编辑市场目录中的 `.mcp.json`，把 `23119` 改成实际端口，然后按“更新”重新执行 `codex plugin add`。
  只改 `.mcp.json` 不会使 Hook 信任失效。

## 6. 不安装插件：手动配置

把 [examples/codex-config.toml.example](../examples/codex-config.toml.example) 中的内容追加到 `~/.codex/config.toml`：

```toml
[mcp_servers.zotero_bridge]
url = "http://127.0.0.1:23119/bridge/mcp"
startup_timeout_sec = 10
tool_timeout_sec = 30
```

Zotero 设置页「Zotero AI Bridge」中的「复制 Codex 配置」按钮复制的是与示例文件相同的两段：上面的服务器段，加上下文所述的
可选 Hook 段（端口为 Zotero 实际端口）。**手动配置与 Codex 插件二选一**：已安装插件时不要使用它。

也可以用命令添加服务器（只写入 `url`，超时使用 Codex 默认值）：

```powershell
codex mcp add zotero_bridge --url http://127.0.0.1:23119/bridge/mcp
```

命令随后提示的 `codex mcp login zotero_bridge` 不需要执行：桥接没有登录或令牌。

示例文件中还有等价的 `[[hooks.UserPromptSubmit]]` Hook 配置（同样需要在 `/hooks` 或 Settings > Hooks 中信任）。

注意：

- **服务器名必须是 `zotero_bridge`。** 不要把本项目注册成 `[mcp_servers.zotero]`，这个名字常被其他 Zotero MCP 服务器占用。
- **不要与插件同时使用。** 排查时要知道：两者同时存在时，`config.toml` 中的同名条目优先级高于插件，插件 `.mcp.json` 中的设置
  （例如改过的端口）会被忽略；手动添加的 Hook 段还会让每轮调用两次。改用插件前删除 `config.toml` 中的这两段；改用手动配置前卸载插件。
- 不要设置 `default_tools_approval_mode`、`enabled_tools` 或 `disabled_tools`。如果一定要用 `enabled_tools`，必须包含
  `capture_prompt_context`，否则 Hook 调用也会被过滤掉。

## 7. 常见问题（Codex）

| 现象 | 原因与处理 |
|---|---|
| 每轮都没有 Zotero 快照，界面显示 Hook “Failed” 或需要审核 | Hook 未信任或定义已改动：按第 3 节重新信任。 |
| Hook 失败，提示 `MCP server 'zotero_bridge' is not connected` | 会话开始时 Zotero 没有运行。Codex 的 Hook 不会等待或重连服务器，**先启动 Zotero，再新开会话**。 |
| 会话中第一条消息没有快照，之后正常 | 可能是服务器还没完成初始化：Codex 的 Hook 不等待服务器连接（源码分析，未实测）。重发即可。 |
| 插件目录中看不到插件 | 重启桌面版；确认 `marketplace add` 的目录下直接有 `.agents/plugins/marketplace.json`。 |
| `codex mcp list` 中 `zotero_bridge` 指向别的地址 | `config.toml` 中有同名手动条目，它优先于插件；修正或删除它。 |

更多见 [troubleshooting.md](troubleshooting.md)。

## 8. 已做的验证与未验证项

2026-10-15 在临时目录中用真实的 `codex.exe`（0.162.0-alpha.17.2，Windows 11）验证，`HOME`、`USERPROFILE`、`CODEX_HOME`
全部指向临时目录。真实的 `~/.codex/config.toml` 不含本项目的任何条目；插件安装、Hook 发现与信任语义这几组命令前后它的
SHA-256 相同（验证期间同时运行的 Codex 桌面版自己改写过一次该文件，内容与本项目无关）。记录见 [acceptance.md](acceptance.md)
I-C1 – I-C4：

- `codex plugin marketplace add <插件目录>` 接受插件根目录内的 `.agents/plugins/marketplace.json` 和 `"path": "./"`，
  市场名 `zotero-ai-bridge-local`；目录路径含中文和空格时同样成功。
- `codex plugin list --available --json` 显示 `zotero-ai-bridge@zotero-ai-bridge-local`，版本 0.1.0。
- `codex plugin add zotero-ai-bridge@zotero-ai-bridge-local` 安装到缓存目录并启用；修改版本号后再次执行会安装新版本。
- `codex mcp list --json` 显示服务器 `zotero_bridge`（streamable_http，`startup_timeout_sec` 10，`tool_timeout_sec` 30）。
- `codex debug prompt-input` 的技能列表中出现 `zotero-ai-bridge:zotero`。
- 通过 `codex app-server` 的 `hooks/list` 查询到插件 Hook：键
  `zotero-ai-bridge@zotero-ai-bridge-local:hooks/hooks.json:user_prompt_submit:0:0`，`handlerType` 为 `mcpTool`，
  `server` 为 `zotero_bridge`，`timeoutSec` 为 5，`trustStatus` 为 `untrusted`（需要用户信任），无警告和错误。
- 信任语义（在临时 `config.toml` 中写入 `hooks/list` 报告的 `currentHash` 模拟信任）：只改版本号后重新 `plugin add`，
  仍为 `trusted`；把 Hook 的 `timeout` 改成 6，变为 `modified`（需要重新信任）；恢复 Hook、只改 `.mcp.json` 的端口，仍为 `trusted`。
- `codex plugin marketplace upgrade zotero-ai-bridge-local` 报 “is not configured as a Git marketplace”；修改目录内容后重新
  `codex plugin add` 会安装新版本（缓存目录按版本号新建）。
- 手动配置示例作为 `config.toml` 时，`codex mcp list` 显示 `zotero_bridge`，`hooks/list` 显示来源为 user 的同一 Hook；
  `codex mcp add zotero_bridge --url ...` 写入 `[mcp_servers.zotero_bridge]`。
- `codex plugin remove`、`codex plugin marketplace remove` 正常卸载。

尚未验证（需要在真实 Codex 与运行中的 Zotero 上完成，见 [acceptance.md](acceptance.md)）：Hook 在真实对话中的执行、
桌面版界面中的安装与信任流程、端到端问答。
