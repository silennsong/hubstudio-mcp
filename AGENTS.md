# AGENTS.md

Instructions for AI agents. Read the section that matches what the user asked you to do: install this server, use it, or change its code.

## Installing it for a user

1. **Check Node.js.** Run `node -v`. Version 18 or later is required. If it is missing or older, stop and tell the user.
2. **Clone to a permanent directory.** The agent's MCP config will point at this path, so do not use a temp directory. If the user has no preference, use `~/hubstudio-mcp`.

   ```bash
   git clone https://github.com/silennsong/hubstudio-mcp.git ~/hubstudio-mcp
   cd ~/hubstudio-mcp
   npm install
   ```

   Do not run `playwright install`. This server uses `playwright-core` to attach to the browser Hubstudio ships, so no browser download is needed.
3. **Check that the server starts.** From the repo root:

   ```bash
   node test/client.mjs
   ```

   It should print 19 tool names starting with `hub_list_envs`. This works without Hubstudio running.
4. **Register it with the user's agent, using the absolute path.**
   - Claude Code: `claude mcp add hubstudio --scope user -- node "<absolute path>/index.js"`
   - Codex: `codex mcp add hubstudio -- node "<absolute path>/index.js"`
   - Clients with an `mcpServers` JSON config (Cursor, Claude Desktop, Gemini CLI): add `{ "hubstudio": { "command": "node", "args": ["<absolute path>/index.js"] } }` under `mcpServers`. Merge it into the existing file; do not overwrite other servers.
5. **Check the Hubstudio side.** This call lists one environment and opens nothing:

   ```bash
   node test/client.mjs '[["hub_list_envs",{"limit":1}]]'
   ```

   - `Cannot reach the Hubstudio local API`: the Hubstudio client is not running or not logged in. Ask the user to start it. The install itself is still complete.
   - If the user's API is on another port, set `HUBSTUDIO_PORT` (or `HUBSTUDIO_API` for a full base URL) in the MCP server's environment.
6. **Tell the user** to restart the agent or start a new session, that the tools are named `hub_*`, and give one example request such as "list my Hubstudio environments".

Do not open an environment just to test the install unless the user agrees. Each launch counts against their Hubstudio quota and starts a browser holding a real account.

## Using the tools

The server sends these same points to the client as MCP instructions, so they are normally already in your context.

- Typical flow: `hub_list_envs` to find the environment, `hub_open_env` to launch and connect (it becomes the active environment), page tools to work, `hub_close_env` when the task is done.
- Name an environment by containerCode, exact name, or serialNumber. Page tools take an optional `env`; without it they act on the active environment.
- On an unfamiliar page, call `hub_list_interactive` or `hub_get_text` first instead of guessing selectors. Use `text` for links and buttons and `selector` for inputs.
- Pages load through the environment's proxy and can be slow. Wait for an element with `hub_wait` and raise `timeoutMs` before deciding a page is broken.
- Reuse connected environments (`hub_connected_envs`) instead of reopening them. Each endpoint of the local API allows about 100 calls per minute.
- Open only the environments the user asked for. Confirm with the user before anything that submits, publishes, pays, or deletes.
- `code 26` means the plan does not allow API launch. `already open in the Hubstudio client` means the user must close that environment in the client first.

## Changing the code

- The whole server is `index.js`: ESM, no build step, Node 18 or later. Dependencies are `@modelcontextprotocol/sdk`, `playwright-core` and `zod`. Do not add or upgrade dependencies unless the task requires it.
- Register tools through the `tool()` helper, which turns thrown errors into MCP error results. Throw errors that say what the user or agent should do next.
- Every page tool takes `env` (`envArg`) and resolves its session with `getSession(env)`. Element targeting goes through `locate()`.
- Hubstudio returns HTTP 200 for failures and reports them in the `code` field; `hub()` already handles this.
- After adding or changing a tool, update the tool table in both `README.md` and `README.zh-CN.md`, the `INSTRUCTIONS` string in `index.js` if the workflow changed, and the tool count in this file.
- Test with `node test/client.mjs '<JSON array of [tool, args]>'`. Calls that open an environment need the user's Hubstudio client and their consent.
