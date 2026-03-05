# openclaw-satori-channel

**[中文文档](README.zh-CN.md)**

---

### Overview

**openclaw-satori-channel** is an [OpenClaw](https://openclaw.dev) channel plugin that connects your AI agent to any chat platform supported by the [Satori Protocol](https://satori.chat/) — including QQ (OneBot), Telegram, Discord, Feishu, LINE, and more.

The typical deployment uses [Koishi](https://koishi.chat/) as the intermediary: Koishi connects to your chat platforms via their respective adapters, then exposes all connected bots through the [`@koishijs/plugin-server-satori`](https://koishi.chat/zh-CN/plugins/develop/server-satori.html) plugin as a unified Satori endpoint. OpenClaw then connects to that endpoint.

### How It Works

```
QQ / Feishu / Telegram / ...
        ↓  (platform adapters)
    Koishi instance
        ↓  (@koishijs/plugin-server-satori)
  Satori Protocol endpoint  (ws://localhost:5140/satori/v1/events)
        ↓
  openclaw-satori-channel
        ↓
     OpenClaw AI Agent
```

### Deployment Flow

**Step 1 — Install Koishi**

Follow the [Koishi installation guide](https://koishi.chat/en-US/manual/starter/) to set up a Koishi instance.

**Step 2 — Add platform adapters**

In the Koishi plugin marketplace, install and configure the adapters for your target platforms, for example:
- `adapter-onebot` for QQ
- `adapter-feishu` for Feishu / Lark
- `adapter-telegram` for Telegram
- `adapter-discord` for Discord

**Step 3 — Enable the Satori server plugin**

In Koishi's plugin page, install and enable `@koishijs/plugin-server-satori`. Configure its `path` setting (e.g. `/satori`). This exposes all connected bots as a Satori protocol endpoint at:

```
WebSocket:  ws://localhost:5140/satori/v1/events
HTTP API:   http://localhost:5140/satori/v1/
```

> The default Koishi port is `5140`. The path must match the `path` field in your OpenClaw account config.

**Step 4 — Configure OpenClaw**

Add the Satori channel to your `openclaw.json` and configure permissions to suit your needs (see [Configuration](#configuration) below).

---

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
- A running [Satori Protocol](https://satori.chat/) server — [Koishi](https://koishi.chat/) with [`@koishijs/plugin-server-satori`](https://koishi.chat/zh-CN/plugins/develop/server-satori.html) is recommended

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

Add a `channels.satori` section to your `openclaw.json`. **It is recommended to configure the permission fields** (`groupPolicy`, `groupAllowFrom`, `requireMention`) to control who can interact with the bot.

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
          "groupAllowFrom": ["your_qq_number"],
          "requireMention": true
        }
      }
    }
  }
}
```

> The `path` value must match the `path` configured in `@koishijs/plugin-server-satori`.
> The `platform` value must match the platform identifier used by Koishi (e.g. `"onebot"`, `"feishu"`, `"telegram"`).
> The `selfId` is the bot's own user ID on the platform.

#### Account Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | `"localhost"` | Satori server host |
| `port` | number | `5140` | Satori server port |
| `path` | string | `""` | Base path prefix, must match Koishi satori-server `path` |
| `platform` | string | `"unknown"` | Platform identifier, e.g. `"onebot"`, `"feishu"`, `"telegram"` |
| `selfId` | string | — | Bot's own user ID on the platform |
| `token` | string | — | Bearer token for Satori server authentication (if configured) |
| `enabled` | boolean | `true` | Enable or disable this account |
| `allowFrom` | string[] | — | Sender IDs allowed for DMs (and group fallback) |
| `defaultTo` | string | — | Default channel ID for outbound messages |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | `"allowlist"` | Group message access policy |
| `groupAllowFrom` | string[] | — | Sender IDs allowed in groups (falls back to `allowFrom`) |
| `requireMention` | boolean | `true` | If `true`, bot only replies in groups when directly @mentioned |

### Permission System

The plugin implements a three-gate permission system. **Users are responsible for configuring these to match their security requirements.**

**Gate 1 — DM allowFrom**

Only allow specific users to DM the bot:
```json
{ "allowFrom": ["111222333"] }
```
Allow everyone:
```json
{ "allowFrom": ["*"] }
```

**Gate 2 — Group policy**

Only reply to specific senders in groups (`"allowlist"` is the default):
```json
{ "groupPolicy": "allowlist", "groupAllowFrom": ["111222333"] }
```
Reply to all senders in groups:
```json
{ "groupPolicy": "open" }
```
Ignore all group messages:
```json
{ "groupPolicy": "disabled" }
```

**Gate 3 — Mention gating**

Only reply when the bot is directly @mentioned (default behavior):
```json
{ "requireMention": true }
```
Reply to all messages without requiring a mention:
```json
{ "requireMention": false }
```

> Note: senders listed in `groupAllowFrom` bypass the mention requirement even when `requireMention: true`.

### References

- [Koishi satori-server plugin](https://koishi.chat/zh-CN/plugins/develop/server-satori.html)
- [Satori Protocol Specification](https://satori.chat/en-US/protocol/)
- [OpenClaw Documentation](https://openclaw.dev)

### License

MIT — [Doiiars](https://github.com/DoiiarX)
