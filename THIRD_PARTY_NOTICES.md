# 第三方声明（Third-Party Notices）

Zotero Reading Bridge 本身以 GNU GPL v3 或更新版本（GPL-3.0-or-later）许可证发布（见 `LICENSE`）。

## 发布产物中不包含第三方代码

`outputs/` 中的发布产物（Zotero 插件 `zotero-reading-bridge.xpi`、Codex 插件包、Claude Code 插件包、Claude Science 技能目录）
只包含本项目自己的代码、配置和文档。下表中的依赖全部是**开发依赖**，只在构建、类型检查和测试时使用，不会被打包进任何产物：
esbuild 只打包本仓库内的 TypeScript 源文件，Zotero 插件运行时没有任何 npm 运行时依赖。

`outputs/source.zip` 是源码归档，不含 `node_modules`。

## 开发依赖

| 包 | 版本 | 许可证 | 用途 | 来源 |
|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT | 协议测试中的官方 MCP 客户端 | https://github.com/modelcontextprotocol/typescript-sdk |
| `@types/archiver` | 8.0.0 | MIT | 类型定义 | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/node` | 24.19.2 | MIT | 类型定义 | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/yauzl` | 3.4.0 | MIT | 类型定义 | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `archiver` | 8.0.0 | MIT | 构建脚本生成 zip / xpi | https://github.com/archiverjs/node-archiver |
| `esbuild` | 0.28.2 | MIT | 打包 TypeScript 源码 | https://github.com/evanw/esbuild |
| `tsx` | 4.23.15 | MIT | 运行 TypeScript 脚本与测试 | https://github.com/privatenumber/tsx |
| `typescript` | 6.0.3 | Apache-2.0 | 类型检查 | https://github.com/microsoft/TypeScript |
| `yauzl` | 3.4.0 | MIT | 校验生成的压缩包 | https://github.com/thejoshwolfe/yauzl |
| `zotero-types` | 4.1.3 | MIT | Zotero API 类型定义（仅编译期） | https://github.com/windingwind/zotero-types |

这些包的传递依赖同样只存在于 `node_modules` 中，许可证信息见各包自带的 `LICENSE` 文件。

## 运行时使用但不分发的软件

- **Zotero**（AGPL-3.0）：本插件在运行时调用 Zotero 桌面版公开和内部的 JavaScript API（如 `Zotero.Server`、`Zotero.Items`、
  `Zotero.Reader`），以及 Zotero 自带的 HTTP 服务器。Zotero 的任何代码都没有被复制或打包进本项目。
- **Codex**、**Claude Code**、**Claude Science**：本项目只提供它们读取的插件配置文件和技能说明，不包含、不修改它们的任何组件。

## 仅作参考、未复制代码的项目

- **Claudero**（https://github.com/MuiseDestiny/zotero-claudero，AGPL-3.0-or-later）：开发时阅读过其源码，用于了解
  Zotero 阅读器上下文的读取方式等思路。本项目**没有复制** Claudero 的任何代码；相关实现依据 Zotero 11 源码独立编写。
- 其他公开的 Zotero 插件与 MCP 项目仅作为对比参考，同样没有复制代码。
