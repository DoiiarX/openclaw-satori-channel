# openclaw-satori-channel

**[中文文档](README.zh-CN.md)**

---

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

### References

- [Satori Protocol Specification](https://satori.chat/en-US/protocol/)
- [OpenClaw Documentation](https://openclaw.dev)

### License

MIT
