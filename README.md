# openclaw-satori-channel

[English](#english) | [中文](#中文)

---

## English

### Overview

**openclaw-satori-channel** is an [OpenClaw](https://openclaw.dev) channel plugin that connects your AI agent to any chat platform supported by the [Satori Protocol](https://satori.chat/) — including QQ (OneBot), Telegram, Discord, LINE, and more.

### Features

- WebSocket-based real-time event streaming
- Automatic reconnection with exponential backoff
- Inbound message handling: text, images, audio, video, files, mentions
- Outbound message delivery via Satori HTTP API
- **Permission management**: DM allowlist, group policy, mention gating
- Multi-account support
- Full status tracking (connected, reconnect attempts, last inbound/outbound timestamps)

### Requirements

- [OpenClaw](https://openclaw.dev) `>= 2026.0.0`
- Node.js `>= 18.0.0`
- A running [Satori Protocol](https://satori.chat/) server (e.g. [Koishi](https://koishi.chat/))

### Installation

Place this plugin in your OpenClaw plugins directory and register it in `openclaw.json`:

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

### Configuration

Add a `channels.satori` section to your `openclaw.json`:

```json
{
  "channels": {
    "satori": {
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
          "groupAllowFrom": ["987654321"],
          "requireMention": true
        }
      }
    }
  }
}
```

#### Account Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | `"localhost"` | Satori server host |
| `port` | number | `5140` | Satori server port |
| `path` | string | `""` | Base path prefix, e.g. `"/satori"` |
| `platform` | string | `"unknown"` | Platform identifier, e.g. `"onebot"`, `"telegram"` |
| `selfId` | string | — | Bot's own user ID on the platform |
| `token` | string | — | Bearer token for Satori server authentication |
| `enabled` | boolean | `true` | Enable or disable this account |
| `allowFrom` | string[] | — | Sender IDs allowed for DMs (and group fallback) |
| `defaultTo` | string | — | Default channel ID for outbound messages |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | `"allowlist"` | Group message access policy |
| `groupAllowFrom` | string[] | — | Sender IDs allowed in groups (falls back to `allowFrom`) |
| `requireMention` | boolean | `true` | If `true`, bot only replies in groups when directly @mentioned |

### Permission System

The plugin implements a three-gate permission system:

**Gate 1 — DM allowFrom**
- If `allowFrom` is set, only listed sender IDs can interact via DM.
- Use `"*"` to allow everyone.

**Gate 2 — Group policy**
- `"disabled"`: All group messages are dropped.
- `"allowlist"` *(default)*: Only senders in `groupAllowFrom` (or `allowFrom` as fallback) are processed. Empty list drops all group messages.
- `"open"`: All group messages are processed regardless of sender.

**Gate 3 — Mention gating**
- If `requireMention: true` *(default)*, the bot only replies in groups when directly @mentioned.
- Exception: senders in the allowlist (`commandAuthorized`) bypass the mention requirement.

---

## 中文

### 概述

**openclaw-satori-channel** 是一个 [OpenClaw](https://openclaw.dev) 频道插件，通过 [Satori 协议](https://satori.chat/zh-CN/) 将你的 AI Agent 接入任意聊天平台，包括 QQ（OneBot）、Telegram、Discord、LINE 等。

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
- 一个运行中的 [Satori 协议](https://satori.chat/zh-CN/)服务器（如 [Koishi](https://koishi.chat/)）

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

在 `openclaw.json` 中添加 `channels.satori` 配置节：

```json
{
  "channels": {
    "satori": {
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
          "groupAllowFrom": ["987654321"],
          "requireMention": true
        }
      }
    }
  }
}
```

#### 账号字段说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `host` | string | `"localhost"` | Satori 服务器地址 |
| `port` | number | `5140` | Satori 服务器端口 |
| `path` | string | `""` | 路径前缀，如 `"/satori"` |
| `platform` | string | `"unknown"` | 平台标识符，如 `"onebot"`、`"telegram"` |
| `selfId` | string | — | Bot 在对应平台的用户 ID |
| `token` | string | — | Satori 服务器的 Bearer 鉴权 token |
| `enabled` | boolean | `true` | 启用或禁用该账号 |
| `allowFrom` | string[] | — | 允许私聊的发送者 ID 列表（群组回退时也使用） |
| `defaultTo` | string | — | 默认出站消息的频道 ID |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | `"allowlist"` | 群消息接入策略 |
| `groupAllowFrom` | string[] | — | 群内允许的发送者 ID（为空时回退到 `allowFrom`） |
| `requireMention` | boolean | `true` | 为 `true` 时，群内只有 @Bot 才会回复 |

### 权限系统

插件实现了三道权限闸门：

**闸门 1 — 私聊 allowFrom**
- 设置 `allowFrom` 后，只有列表中的发送者才能通过私聊触发 Bot。
- 填写 `"*"` 则对所有人开放。

**闸门 2 — 群组策略**
- `"disabled"`：丢弃所有群消息。
- `"allowlist"`（默认）：只处理 `groupAllowFrom`（或回退到 `allowFrom`）中的发送者。列表为空时丢弃所有群消息。
- `"open"`：处理所有群消息，不限发送者。

**闸门 3 — @提及门控**
- `requireMention: true`（默认）时，Bot 在群内只有被 @ 时才会回复。
- 例外：在白名单中的发送者（`commandAuthorized`）不受此限制。

### 协议参考

- [Satori 协议规范](https://satori.chat/zh-CN/protocol/)
- [OpenClaw 文档](https://openclaw.dev)

### 许可证

MIT
