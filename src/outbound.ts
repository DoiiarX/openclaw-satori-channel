import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import type { SatoriAccount } from "./types.js";
import { satoriConfigAdapter } from "./config.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildApiHeaders(account: SatoriAccount): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Satori-Platform": account.platform,
  };
  if (account.selfId) headers["Satori-User-ID"] = account.selfId;
  if (account.token) headers["Authorization"] = `Bearer ${account.token}`;
  return headers;
}

async function satoriMessageCreate(
  cfg: OpenClawConfig,
  accountId: string | null | undefined,
  channelId: string,
  content: string
): Promise<{ id?: string }> {
  const account: SatoriAccount = satoriConfigAdapter.resolveAccount(cfg, accountId);
  const apiBase = `http://${account.host}:${account.port}${account.path}/v1`;

  const response = await fetch(`${apiBase}/message.create`, {
    method: "POST",
    headers: buildApiHeaders(account),
    body: JSON.stringify({ channel_id: channelId, content }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Satori message.create error ${response.status}: ${body}`);
  }

  return response.json().catch(() => ({})) as Promise<{ id?: string }>;
}

// ─── Outbound Adapter ──────────────────────────────────────────────────────────

export const satoriOutboundAdapter: ChannelOutboundAdapter = {
  /**
   * Use "direct" mode so OpenClaw sends each message immediately via our
   * sendText / sendMedia methods without going through a gateway queue.
   */
  deliveryMode: "direct",

  async sendText(ctx: ChannelOutboundContext) {
    const { cfg, to, text, accountId } = ctx;
    const data = await satoriMessageCreate(cfg, accountId, to, text);
    return {
      channel: "satori-channel" as "satori-channel" & string,
      messageId: data.id ?? `satori-${Date.now()}`,
      channelId: to,
    };
  },

  async sendMedia(ctx: ChannelOutboundContext) {
    const { cfg, to, text, mediaUrl, accountId } = ctx;

    // Build a Satori content string that embeds the media element followed by
    // an optional text caption.
    const parts: string[] = [];

    if (mediaUrl) {
      // Determine element type from URL extension heuristic
      const lower = mediaUrl.toLowerCase();
      if (/\.(mp3|ogg|wav|m4a|aac|flac)(\?.*)?$/.test(lower)) {
        parts.push(`<audio src="${mediaUrl}"/>`);
      } else if (/\.(mp4|webm|mov|mkv|avi)(\?.*)?$/.test(lower)) {
        parts.push(`<video src="${mediaUrl}"/>`);
      } else {
        // Default to image
        parts.push(`<img src="${mediaUrl}"/>`);
      }
    }

    if (text) parts.push(text);

    const content = parts.join("\n").trim() || text;
    const data = await satoriMessageCreate(cfg, accountId, to, content);

    return {
      channel: "satori-channel" as "satori-channel" & string,
      messageId: data.id ?? `satori-${Date.now()}`,
      channelId: to,
    };
  },
};
