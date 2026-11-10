# hubstudio-mcp

[English](README.md) | **简体中文**

让 Claude Code、Codex、Cursor 等 MCP 客户端直接操作 [Hubstudio](https://www.hubstudio.cn/) 指纹浏览器：打开或关闭环境，在环境里的网页上导航、点击、输入、截图、读文字。可以同时连接多个环境，切换不需要重启或改配置。

原理：用 Hubstudio 本地 API（默认 `http://127.0.0.1:6873`）打开环境，拿到 `debuggingPort`，再用 Playwright 通过 CDP 连上浏览器。

## 可以让 Agent 做什么

- “列出我 Hubstudio 里标签是 US 的环境，告诉我哪些开着。”
- “打开 12 号环境，进卖家后台，把今天的订单数读给我。”
- “把这三个环境都打开，每个环境的首页截一张图。”

## 前提

- Hubstudio 客户端已登录，并且开着。本地 API 随客户端启动。
- 账号套餐允许通过 API 打开环境。免费版可能返回错误码 26。
- Node.js 18 或更高版本。

## 安装

### 让 Agent 帮你装

把下面这段话发给 Claude Code、Codex、Cursor 或任何能执行命令行的 Agent：

```text
请阅读 https://github.com/silennsong/hubstudio-mcp ，按仓库里 AGENTS.md 的步骤帮我把这个 MCP 装好，装完告诉我怎么用。
```

### 手动安装

```bash
git clone https://github.com/silennsong/hubstudio-mcp.git
cd hubstudio-mcp
npm install
```

不需要另外下载浏览器，本服务连接的是 Hubstudio 自带的浏览器。

然后在 Agent 里注册，路径换成 clone 下来的目录。

Claude Code：

```bash
claude mcp add hubstudio --scope user -- node "/你的绝对路径/hubstudio-mcp/index.js"
```

Codex：

```bash
codex mcp add hubstudio -- node "/你的绝对路径/hubstudio-mcp/index.js"
```

Cursor、Claude Desktop、Gemini CLI 等使用 `mcpServers` 配置的客户端：

```json
{ "mcpServers": { "hubstudio": { "command": "node", "args": ["/你的绝对路径/hubstudio-mcp/index.js"] } } }
```

注册后重启 Agent。API 地址不是默认值时，可以设置环境变量 `HUBSTUDIO_PORT`，或用 `HUBSTUDIO_API` 指定完整地址。

### 更新

```bash
git pull
npm install
```

然后重启 Agent。

## 工具

| 工具 | 作用 |
|---|---|
| `hub_list_envs` | 列出环境和打开状态，可以按名称、标签、备注、序号搜索 |
| `hub_open_env` | 打开环境并连接，可以顺带打开网址；如果环境已经由 API 打开，会直接重新连上 |
| `hub_close_env` | 断开连接并关闭环境 |
| `hub_switch_env` / `hub_connected_envs` | 切换当前操作的环境 / 查看已连接的环境 |
| `hub_tabs` | 标签页列表，切换、新建、关闭标签页 |
| `hub_navigate` `hub_click` `hub_fill` `hub_press_key` `hub_select_option` `hub_hover` `hub_scroll` `hub_wait` | 网页操作 |
| `hub_screenshot` `hub_get_text` `hub_get_html` `hub_list_interactive` `hub_evaluate` | 读取页面 |

指定环境时，可以用 containerCode、环境名称或序号。网页操作工具都有可选参数 `env`；不填时，操作当前激活的环境。所以同时控制多个环境时，不需要来回切换。

定位元素时可以用 `selector`（CSS 或 Playwright 选择器），也可以用 `text`（按可见文字）。按文字定位会优先匹配同名的链接和按钮。

服务在连接时还会把使用说明发给客户端，所以 Agent 不读这个页面，也知道常规流程和常见错误码的含义。

## 已知限制

- 客户端里**手动打开**的环境，按官方文档需要找 Hubstudio 客服开通权限后，才能通过 API 接管。由 API 打开的环境没有这个限制，可以随时重新连接。
- 使用 Firefox 内核（Firebrowser）的环境不能通过 API 打开。
- Hubstudio 启动环境时会自己打开、再关掉一些标签页。所以启动时要打开的网址由本服务自己导航，不交给 Hubstudio 打开；绑定的标签页如果被关闭，会自动切换到最新的可用标签页。
- 每个接口限 100 次/分钟；每打开一次环境，计入一次客户端的打开次数。

## 常见报错

| 报错信息 | 含义 |
|---|---|
| `Cannot reach the Hubstudio local API` | Hubstudio 客户端没开或没登录，或者 API 不在默认端口 |
| `code 26` | 当前套餐不允许通过 API 打开环境 |
| `already open in the Hubstudio client` | 这个环境是手动打开的，先在客户端里关掉，再重试 |

## 测试

```bash
node test/client.mjs
```

打印全部工具名，Hubstudio 没开也能运行。按顺序调用工具并打印结果：

```bash
node test/client.mjs '[["hub_list_envs",{"limit":3}]]'
```

截图保存到 `test/`。

## 声明

这是非官方项目，与 Hubstudio 没有隶属或背书关系。环境里通常是登录着的真实账号，Agent 在里面做的操作由你自己负责，也请遵守所操作网站的规则。

## 许可证

MIT，见 [LICENSE](LICENSE)。
