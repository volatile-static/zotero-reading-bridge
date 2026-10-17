# Zotero Reading Bridge

**Bridging the gap — from papers to insight.**

Let your AI assistant read your Zotero library. Ask Claude or Codex about the paper you have open, your highlights and
notes, or anything in your collections. It works with the papers already on your computer.

The bridge is **read-only**. It never changes, deletes or uploads anything in your library.

## What you need

- **Zotero 11**
- **Claude Desktop** or the **Codex** desktop app
- Download the installation files from the [latest release](https://github.com/volatile-static/zotero-reading-bridge/releases/latest):
  - [Zotero plugin (.xpi)](https://github.com/volatile-static/zotero-reading-bridge/releases/latest/download/zotero-reading-bridge.xpi)
  - [Claude Desktop extension (.mcpb)](https://github.com/volatile-static/zotero-reading-bridge/releases/latest/download/zotero-reading-bridge-claude-desktop.mcpb), plus the optional but recommended [Zotero skill (SKILL.md)](https://github.com/volatile-static/zotero-reading-bridge/releases/latest/download/SKILL.md)
  - [Codex plugin (.zip)](https://github.com/volatile-static/zotero-reading-bridge/releases/latest/download/zotero-reading-bridge-codex.zip)

## Install

**1. Zotero**

1. Open Zotero and choose **Tools → Plugins**.
2. Drag `zotero-reading-bridge.xpi` into the window and confirm.
3. Keep Zotero open whenever you want to use your AI assistant with it.

**2. Your AI assistant** (one or both)

- **Claude Desktop:** open **Settings → Extensions**, drag in `zotero-reading-bridge-claude-desktop.mcpb` and click
  **Install**. This extension provides the connection and tools needed to read Zotero.
- **Codex:** open **Customize → Plugins → Add → New Plugin**, drag in `zotero-reading-bridge-codex.zip` and click
  **Add plugin**. If Codex asks you to review hooks, approve them.

**Optional, recommended for Claude: install the Zotero skill.** Open **Settings → Capabilities → Skills**, click
**Upload skill** and choose `SKILL.md`. Upload the file directly; no ZIP is needed. The Claude extension does not
bundle this skill, so it is installed separately. Codex already includes it in its plugin.

The extension works without the skill: Claude can still search your library and read papers, notes and annotations.
The skill adds a consistent research workflow: refresh the current selection whenever you ask about “this paper,”
read the full text before answering document questions, identify sources, and explain when text or files cannot be
accessed. It adds instructions, not extra tools or permissions, and does not replace the extension. If you install
it, upload the new `SKILL.md` when updating the extension as well.

You don't need to unzip anything or edit any settings.

## Try it

Start a new chat and ask, for example:

- "Summarize the paper I have open in Zotero."
- "What did I highlight in this PDF?"
- "Find papers in my Zotero library about protein folding."
- "Compare the methods of the papers I selected."

## If something doesn't work

- Make sure Zotero is open, then start a new chat.
- In Zotero, check that **Tools → Plugins** shows Zotero Reading Bridge as enabled.
- Restart the AI app.

To update, drag in the new files the same way. To uninstall, remove the plugin in Zotero and in your AI app.

## Privacy

Everything stays on your computer. The bridge only answers programs running on the same computer. However, any
program on this computer can read your library while Zotero is open, so only install it on a computer you trust.

## For developers

开发文档（中文）：[docs/development.md](docs/development.md)

## Credits

- GPT-6 Astra
- Claude Opus 5.5

## License

© volatile-static. Licensed under [GPL-3.0-or-later](LICENSE).
