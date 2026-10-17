# Zotero Reading Bridge preferences pane. Zotero 11 merges all plugin FTL files into one namespace,
# so every message ID starts with "zotero-reading-bridge-".

zotero-reading-bridge-pref-endpoint-heading = Local MCP Endpoint
zotero-reading-bridge-pref-status-label = Status:
# $port (String) - port of Zotero's HTTP server
zotero-reading-bridge-pref-status-running = Running on 127.0.0.1:{ $port }
zotero-reading-bridge-pref-status-server-not-running = Zotero's local HTTP server is not running, so the endpoint cannot be served. Make sure the server is enabled and its port is not used by another program, then restart Zotero.
zotero-reading-bridge-pref-status-loopback-unverified = Not started: could not verify that Zotero's HTTP server only accepts connections from this computer (127.0.0.1).
# $error (String) - English error description from the plugin
zotero-reading-bridge-pref-status-error = Error: { $error }
zotero-reading-bridge-pref-status-unavailable = The plugin is not running. Reopen this window after enabling Zotero Reading Bridge.
zotero-reading-bridge-pref-address-label = Address:
zotero-reading-bridge-pref-copy-address =
    .label = Copy Address
zotero-reading-bridge-pref-port-note = The address always shows the port Zotero is actually using. Changing Zotero's HTTP server port requires restarting Zotero and updating client configurations.

zotero-reading-bridge-pref-clients-heading = Connect AI Clients
zotero-reading-bridge-pref-codex-description = Codex desktop: drag zotero-reading-bridge-codex.zip into Plugins → Add → New Plugin.
zotero-reading-bridge-pref-claude-description = Claude desktop: drag zotero-reading-bridge-claude-desktop.mcpb into Settings → Extensions.
zotero-reading-bridge-pref-copied = Copied to the clipboard.

zotero-reading-bridge-pref-security-heading = Security
zotero-reading-bridge-pref-security-note = The endpoint only listens on this computer (127.0.0.1) and never changes your library. Research PDF downloads contact publishers using the network access of this computer and write temporary files; publishers may open CAPTCHA windows. It has no password, so while it is on, any program running on this computer can read your Zotero library, notes and attachment file paths. AI clients cannot verify that they are talking to Zotero either: while Zotero is not running, another program or user on this computer can take its port and feed instructions into every message through the client hooks. On a shared computer, do not install the Codex or Claude Desktop client plugins. To turn the endpoint off, disable Zotero Reading Bridge in Tools → Plugins.
zotero-reading-bridge-pref-debug-note = When Zotero's debug output logging is on, Zotero itself records incoming requests and, while tools run, the paths and file names of attachments, database query values (such as item URLs and search terms) and full-text search terms. Turn debug output off while using AI clients, and review or redact debug output before submitting it.
