# openclaw-satori-channel

**[English Documentation](README.md)**

---

### 概述

**openclaw-satori-channel** 是一个 [OpenClaw](https://openclaw.dev) 频道插件，通过 [Satori 协议](https://satori.chat/zh-CN/) 将你的 AI Agent 接入任意聊天平台，包括 QQ（[OneBot](https://onebot.dev/)）、Telegram、Discord、飞书、LINE 等。

典型部署方式是以 [Koishi](https://koishi.chat/) 作为中间层：Koishi 通过各平台适配器连接聊天平台，再通过 [`@koishijs/plugin-server-satori`](https://koishi.chat/zh-CN/plugins/develop/server-satori.html) 插件将所有已连接的 Bot 统一暴露为 Satori 协议端点，OpenClaw 再连接到该端点。

### 工作原理

```
QQ / 飞书 / Telegram / ...
        ↓  （平台适配器）
    Koishi 实例
        ↓  （@koishijs/plugin-server-satori）
  Satori 协议端点  (ws://localhost:5140/satori/v1/events)
        ↓
  openclaw-satori-channel
        ↓
     OpenClaw AI Agent
```

### 部署流程

**第一步 — 安装 Koishi**

参考 [Koishi 安装指南](https://koishi.chat/zh-CN/manual/starter/) 搭建 Koishi 实例。

**第二步 — 添加平台适配器**

在 Koishi 插件市场中安装并配置目标平台的适配器，例如：
- `adapter-onebot` — QQ（[OneBot](https://onebot.dev/) 协议）
- `adapter-feishu` — 飞书 / Lark
- `adapter-telegram` — Telegram
- `adapter-discord` — Discord

**第三步 — 启用 Satori 服务端插件**

在 Koishi 插件页面安装并启用 `@koishijs/plugin-server-satori`，配置其 `path` 参数（如 `/satori`）。启用后，所有已连接的 Bot 将通过以下端点暴露为 Satori 协议：

```
WebSocket:  ws://localhost:5140/satori/v1/events
HTTP API:   http://localhost:5140/satori/v1/
```

> Koishi 默认端口为 `5140`。插件的 `path` 参数必须与 OpenClaw 账号配置中的 `path` 字段保持一致。

**第四步 — 配置 OpenClaw**

在 `openclaw.json` 中添加 Satori 频道配置，并根据实际需求配置权限（详见[配置说明](#配置说明)）。

---

### 功能特性

- 基于 WebSocket 的实时事件流
- 断线自动重连（指数退避）
- 入站消息处理：文本、图片、语音、视频、文件、@提及
- 通过 Satori HTTP API 发送消息
- **权限管理**：私聊白名单、群组策略、@提及门控
- 多账号支持
- 完整状态跟踪（连接状态、重连次数、最后收发时间戳）

### 环境要求

- [OpenClaw](https://openclaw.dev) `>= 2026.0.0`
- Node.js `>= 18.0.0`
- 一个运行中的 [Satori 协议](https://satori.chat/zh-CN/)服务器 — 推荐使用安装了 [`@koishijs/plugin-server-satori`](https://koishi.chat/zh-CN/plugins/develop/server-satori.html) 的 [Koishi](https://koishi.chat/)

### 安装

将插件放到你的 OpenClaw 插件目录，并在 `openclaw.json` 中注册：

```json
{
  "plugins": {
    "allow": ["satori-channel"],
    "load": {
      "paths": ["/path/to/openclaw-satori-channel"]
    },
    "entries": {
      "satori-channel": { "enabled": true }
    }
  }
}
```

### 配置说明

在 `openclaw.json` 中添加 `channels.satori-channel` 配置节。**建议根据你的安全需求配置权限字段**（`groupPolicy`、`groupAllowFrom`、`requireMention`）以控制哪些用户可以与 Bot 交互。

```json
{
  "channels": {
    "satori-channel": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "host": "localhost",
          "port": 5140,
          "path": "/satori",
          "platform": "onebot",
          "selfId": "123456789",
          "token": "",
          "groupPolicy": "allowlist",
          "groupAllowFrom": ["你的QQ号"],
          "requireMention": true
        }
      }
    }
  }
}
```

> `path` 必须与 `@koishijs/plugin-server-satori` 中配置的 `path` 一致。
> `platform` 必须与 Koishi 中使用的平台标识符一致（如 `"onebot"`、`"feishu"`、`"telegram"`）。
> `selfId` 是 Bot 在对应平台的用户 ID。

#### 账号字段说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `host` | string | `"localhost"` | Satori 服务器地址 |
| `port` | number | `5140` | Satori 服务器端口 |
| `path` | string | `""` | 路径前缀，须与 Koishi satori-server 的 `path` 一致 |
| `platform` | string | `"unknown"` | 平台标识符，如 `"onebot"`、`"feishu"`、`"telegram"` |
| `selfId` | string | — | Bot 在对应平台的用户 ID |
| `token` | string | — | Satori 服务器的 Bearer 鉴权 token（如有配置） |
| `enabled` | boolean | `true` | 启用或禁用该账号 |
| `allowFrom` | string[] | — | 允许私聊的发送者 ID 列表（群组回退时也使用） |
| `defaultTo` | string | — | 默认出站消息的频道 ID |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | `"allowlist"` | 群消息接入策略 |
| `groupAllowFrom` | string[] | — | 群内允许的发送者 ID（为空时回退到 `allowFrom`） |
| `requireMention` | boolean | `true` | 为 `true` 时，群内只有 @Bot 才会回复 |

### 会话 Key 格式

每个会话由一个 agent 作用域的 session key 标识，格式如下：

```
agent:main:satori-channel:{platform}:{chatType}:{peerId}
```

| 段 | 可选值 | 说明 |
|----|--------|------|
| `platform` | `onebot`、`telegram`、`feishu`… | 与账号配置中的 `platform` 字段一致 |
| `chatType` | `direct`、`group` | `direct` 为私聊，`group` 为群聊/频道 |
| `peerId` | 发送者 ID（私聊）/ 频道 ID（群组） | 会话对端的唯一标识符 |

示例：

```
agent:main:satori-channel:onebot:direct:100000001
agent:main:satori-channel:onebot:group:200000001
agent:main:satori-channel:telegram:direct:100000001
agent:main:satori-channel:telegram:group:200000001
```

`platform` 段的作用是：当同一个 Satori 端点连接了多个平台账号时，区分来自不同平台的会话。

### 权限系统

插件实现了三道权限闸门。**用户需自行根据安全需求配置这些字段。**

**闸门 1 — 私聊 allowFrom**

只允许特定用户私聊 Bot：
```json
{ "allowFrom": ["111222333"] }
```
对所有人开放私聊：
```json
{ "allowFrom": ["*"] }
```

**闸门 2 — 群组策略**

只响应群内特定发送者（`"allowlist"` 为默认值）：
```json
{ "groupPolicy": "allowlist", "groupAllowFrom": ["111222333"] }
```
响应群内所有人：
```json
{ "groupPolicy": "open" }
```
忽略所有群消息：
```json
{ "groupPolicy": "disabled" }
```

**闸门 3 — @提及门控**

只在被 @ 时才回复（默认行为）：
```json
{ "requireMention": true }
```
无需 @ 也回复所有消息：
```json
{ "requireMention": false }
```

> 注意：`groupAllowFrom` 白名单中的发送者即使在 `requireMention: true` 时也无需 @ 即可触发 Bot。

### 相关链接

- [Koishi satori-server 插件文档](https://koishi.chat/zh-CN/plugins/develop/server-satori.html)
- [Satori 协议规范](https://satori.chat/zh-CN/protocol/)
- [OpenClaw 文档](https://openclaw.dev)

### 许可证

MIT — [Doiiars](https://github.com/DoiiarX)
