# hubstudio-mcp

让 Claude Code 等 MCP 客户端直接操作 Hubstudio 指纹浏览器：打开或关闭环境，在网页上导航、点击、输入、截图、读文字。可以同时连接多个环境，切换不需要重启或改配置。

原理：用 Hubstudio 本地 API（默认 `http://127.0.0.1:6873`）打开环境，拿到 `debuggingPort`，再用 Playwright 通过 CDP 连上浏览器。

## 前提
- Hubstudio 客户端已登录，并且开着（本地 API 随客户端启动）
- 账号套餐允许通过 API 打开环境（免费版可能返回错误码 26）
- Node.js 18 或更高版本

## 安装
这是私有仓库，安装的人需要有仓库访问权限，并且本机 git 能访问 GitHub（例如已运行过 `gh auth login`）。

```bash
git clone https://github.com/silennsong/hubstudio-mcp.git
cd hubstudio-mcp
npm install
```

然后在各 Agent 里注册，路径换成 clone 下来的目录：

```bash
claude mcp add hubstudio --scope user -- node "<clone目录>/index.js"
```

其他 Agent（Cursor、Claude Desktop、Gemini CLI 等）的 `mcpServers` 配置：

```json
{ "mcpServers": { "hubstudio": { "command": "node", "args": ["<clone目录>/index.js"] } } }
```

API 地址不是默认值时，可以设置环境变量 `HUBSTUDIO_PORT`，或用 `HUBSTUDIO_API` 指定完整地址。

## 更新
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

## 已知限制
- 客户端里**手动打开**的环境，按官方文档需要找 Hubstudio 客服开通权限后，才能通过 API 接管。由 API 打开的环境没有这个限制，可以随时重新连接。
- 使用 Firefox 内核（Firebrowser）的环境不能通过 API 打开。
- Hubstudio 启动环境时会自己打开、再关掉一些标签页。所以启动时要打开的网址由本服务自己导航，不交给 Hubstudio 打开；绑定的标签页如果被关闭，会自动切换到最新的可用标签页。
- 每个接口限 100 次/分钟；每打开一次环境，计入一次客户端的打开次数。

## 测试
`node test/client.mjs '[["hub_list_envs",{"keyword":"0921"}]]'`：按顺序调用工具并打印结果，截图保存到 `test/`。
