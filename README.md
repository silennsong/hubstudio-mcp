# hubstudio-mcp

**English** | [简体中文](README.zh-CN.md)

An MCP server that lets Claude Code, Codex, Cursor and other MCP clients drive the [Hubstudio](https://www.hubstudio.cn/) fingerprint browser: open and close environments, then navigate, click, type, take screenshots and read text on the pages inside them. Several environments can be connected at once, and switching between them needs no restart or config change.

How it works: the server calls Hubstudio's local API (default `http://127.0.0.1:6873`) to open an environment, receives its `debuggingPort`, and attaches Playwright to that browser over CDP.

## What you can ask your agent to do

- "List my Hubstudio environments tagged US and tell me which ones are open."
- "Open environment 12, go to the seller dashboard and read me today's order count."
- "Open these three environments and take a screenshot of the home page in each."

## Requirements

- The Hubstudio client is running and logged in. The local API starts with the client.
- Your Hubstudio plan allows opening environments through the API. The free plan may return error code 26.
- Node.js 18 or later.

## Install

### Let your agent do it

Paste this into Claude Code, Codex, Cursor, or any agent that can run shell commands:

```text
Read https://github.com/silennsong/hubstudio-mcp and install this MCP server for me by following its AGENTS.md. When you finish, tell me how to use it.
```

### Manual install

```bash
git clone https://github.com/silennsong/hubstudio-mcp.git
cd hubstudio-mcp
npm install
```

No browser download is needed. The server attaches to the browser Hubstudio already ships.

Then register it with your agent, replacing the path with your clone directory.

Claude Code:

```bash
claude mcp add hubstudio --scope user -- node "/absolute/path/to/hubstudio-mcp/index.js"
```

Codex:

```bash
codex mcp add hubstudio -- node "/absolute/path/to/hubstudio-mcp/index.js"
```

Cursor, Claude Desktop, Gemini CLI and other clients that use an `mcpServers` config:

```json
{ "mcpServers": { "hubstudio": { "command": "node", "args": ["/absolute/path/to/hubstudio-mcp/index.js"] } } }
```

Restart the agent afterwards. If your Hubstudio API is not at the default address, set the `HUBSTUDIO_PORT` environment variable, or set `HUBSTUDIO_API` to the full base URL.

### Update

```bash
git pull
npm install
```

Then restart the agent.

## Tools

| Tool | What it does |
|---|---|
| `hub_list_envs` | List environments and their open/closed status. Filter by name, tag, remark or serial number. |
| `hub_open_env` | Open an environment and connect to it, optionally opening URLs. An environment already opened through the API is simply reconnected. |
| `hub_close_env` | Disconnect and close an environment. |
| `hub_switch_env` / `hub_connected_envs` | Change the active environment / list the connected ones. |
| `hub_tabs` | List tabs, or select, open and close a tab. |
| `hub_navigate` `hub_click` `hub_fill` `hub_press_key` `hub_select_option` `hub_hover` `hub_scroll` `hub_wait` | Act on the page. |
| `hub_screenshot` `hub_get_text` `hub_get_html` `hub_list_interactive` `hub_evaluate` | Read the page. |

An environment can be named by its containerCode, its exact name, or its serial number. Every page tool takes an optional `env` argument; without it the tool acts on the active environment. This means you can control several environments in one session without switching back and forth.

Elements can be located with `selector` (a CSS or Playwright selector) or with `text` (the visible text). Text matching prefers links and buttons with that name over plain text.

The server also sends usage instructions to the client when it connects, so the agent knows the usual workflow and the common error codes without reading this page.

## Known limitations

- An environment **opened by hand** in the Hubstudio client cannot be taken over through the API unless Hubstudio support enables that permission for your account, according to the official docs. Environments opened through the API have no such limit and can be reconnected at any time.
- Environments that use the Firefox kernel (Firebrowser) cannot be opened through the API.
- When Hubstudio launches an environment it opens and closes some tabs of its own. For that reason this server navigates to the startup URLs itself instead of passing them to Hubstudio, and if the bound tab is closed it moves to the newest usable tab.
- Each API endpoint is limited to 100 calls per minute. Every launch counts as one open against your Hubstudio quota.

## Troubleshooting

| Message | Meaning |
|---|---|
| `Cannot reach the Hubstudio local API` | The Hubstudio client is not running or not logged in, or the API is on a different port. |
| `code 26` | The current plan does not allow opening environments through the API. |
| `already open in the Hubstudio client` | The environment was opened by hand. Close it in the client, then retry. |

## Testing

```bash
node test/client.mjs
```

prints the tool names, and works without Hubstudio running. To call tools in order and print the results:

```bash
node test/client.mjs '[["hub_list_envs",{"limit":3}]]'
```

Screenshots are saved to `test/`.

## Disclaimer

This is an unofficial project. It is not affiliated with or endorsed by Hubstudio. Environments usually hold real logged-in accounts, so you are responsible for what your agent does in them and for following the terms of the sites you automate.

## License

MIT. See [LICENSE](LICENSE).
