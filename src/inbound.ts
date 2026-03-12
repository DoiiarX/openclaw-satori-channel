import type { ChannelGatewayContext } from "openclaw/plugin-sdk";
import type { SatoriAccount, SatoriEvent } from "./types.js";

// Local simplified types (avoid internal SDK dependencies)
interface InboundMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  text?: string;
  [key: string]: unknown;
}

interface MsgContext {
  message?: InboundMessage;
  CommandAuthorized?: boolean;
  [key: string]: unknown;
}

// ─── Content parsing ───────────────────────────────────────────────────────────

/**
 * Strip Satori XML-like element tags to produce plain text suitable for the
 * agent prompt.  Rich elements (images, audio, video) are replaced with
 * human-readable placeholders; mention tags are expanded to @<id>.
 */
export function extractTextFromContent(content: string): string {
  let text = content
    // Media elements → readable placeholders
    .replace(/<img\b[^>]*?\/>/gi, "[图片]")
    .replace(/<audio\b[^>]*?\/>/gi, "[语音]")
    .replace(/<video\b[^>]*?\/>/gi, "[视频]")
    .replace(/<file\b[^>]*?\/>/gi, "[文件]")
    // Mentions
    .replace(/<at\b[^>]*?id="([^"]*)"[^>]*?\/>/gi, "@$1")
    .replace(/<at\b[^>]*?\/>/gi, "@someone")
    // Channel mentions
    .replace(/<sharp\b[^>]*?id="([^"]*)"[^>]*?\/>/gi, "#$1")
    // Layout elements
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, "");

  // Decode basic HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  return text.trim();
}

/** Media information extracted from Satori content */
type MediaInfo = {
  url: string;
  type: "image" | "audio" | "video" | "file";
};

/** Extract all media URLs and types from a Satori message content string. */
function extractAllMedia(content: string): MediaInfo[] {
  const media: MediaInfo[] = [];
  const patterns: Array<{ regex: RegExp; type: MediaInfo["type"] }> = [
    { regex: /<img\b[^>]*?\bsrc="([^"]+)"[^>]*?\/>/gi, type: "image" },
    { regex: /<audio\b[^>]*?\bsrc="([^"]+)"[^>]*?\/>/gi, type: "audio" },
    { regex: /<video\b[^>]*?\bsrc="([^"]+)"[^>]*?\/>/gi, type: "video" },
    { regex: /<file\b[^>]*?\bsrc="([^"]+)"[^>]*?\/>/gi, type: "file" },
  ];

  for (const { regex, type } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      media.push({ url: match[1], type });
    }
  }

  return media;
}

/** Extract the first media URL found in a Satori message content string. */
function extractMediaUrl(content: string): string | undefined {
  const media = extractAllMedia(content);
  return media.length > 0 ? media[0].url : undefined;
}

// ─── HTTP helper ───────────────────────────────────────────────────────────────

function buildApiHeaders(
  account: SatoriAccount
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Satori-Platform": account.platform,
  };
  if (account.selfId) headers["Satori-User-ID"] = account.selfId;
  if (account.token) headers["Authorization"] = `Bearer ${account.token}`;
  return headers;
}

// ─── Event dispatcher ──────────────────────────────────────────────────────────

/**
 * Process a single Satori event and dispatch an AI reply when appropriate.
 *
 * Currently handles:
 *   - `message-created` → build MsgContext and dispatch via channelRuntime
 *
 * Other event types are silently ignored; extend the switch as needed.
 */
export async function handleSatoriEvent(
  event: SatoriEvent,
  ctx: ChannelGatewayContext<SatoriAccount>
): Promise<void> {
  const { cfg, accountId, account, log, channelRuntime } = ctx;

  if (!channelRuntime) {
    log?.warn(
      `[satori:${accountId}] channelRuntime is not available — inbound events cannot be dispatched`
    );
    return;
  }

  if (event.type !== "message-created") {
    log?.debug?.(`[satori:${accountId}] Ignoring event type: ${event.type}`);
    return;
  }

  const message = event.message;
  if (!message?.content) {
    log?.debug?.(`[satori:${accountId}] message-created has no content, skipping`);
    return;
  }

  // ── Resolve identifiers ────────────────────────────────────────────────────
  const sender =
    event.user ?? event.member?.user ?? message.user;
  const channel = event.channel ?? message.channel;
  const guild = event.guild ?? message.guild;

  const senderId = sender?.id ?? "unknown";
  const senderName =
    event.member?.nick ?? sender?.name ?? sender?.nick ?? senderId;
  const channelId = channel?.id ?? "";

  // Channel.type 1 = DM, 0 = group text channel
  const isDirect = channel?.type === 1;
  const chatType: "direct" | "group" = isDirect ? "direct" : "group";

  // ── Gate 1: DM allowFrom ───────────────────────────────────────────────────
  if (isDirect) {
    const allowFrom = account.allowFrom;
    if (allowFrom && allowFrom.length > 0) {
      const allowed =
        allowFrom.includes("*") ||
        allowFrom.includes(senderId) ||
        allowFrom.some(id => String(id) === senderId);
      if (!allowed) {
        log?.debug?.(`[satori:${accountId}] DM dropped: sender ${senderId} not in allowFrom`);
        return;
      }
    }
  }

  // ── Gate 2: Group policy + groupAllowFrom ──────────────────────────────────
  if (!isDirect) {
    const groupPolicy = account.groupPolicy;
    if (groupPolicy === "disabled") {
      log?.debug?.(`[satori:${accountId}] Group message dropped: groupPolicy=disabled`);
      return;
    }
    if (groupPolicy === "allowlist") {
      const groupAllowFrom = account.groupAllowFrom ?? [];
      const allowFrom = account.allowFrom ?? [];
      const effectiveList = groupAllowFrom.length > 0 ? groupAllowFrom : allowFrom;
      if (effectiveList.length === 0) {
        log?.debug?.(`[satori:${accountId}] Group message dropped: groupPolicy=allowlist but groupAllowFrom is empty`);
        return;
      }
      // Check channelId (group ID), not senderId
      const allowed = effectiveList.includes("*") ||
        effectiveList.includes(channelId) ||
        effectiveList.some(id => String(id) === channelId);
      if (!allowed) {
        log?.debug?.(`[satori:${accountId}] Group message dropped: channel ${channelId} not in groupAllowFrom`);
        return;
      }
    }
  }

  // ── Build content context ──────────────────────────────────────────────────
  const bodyText = extractTextFromContent(message.content);
  const allMedia = extractAllMedia(message.content);
  const mediaUrl = allMedia.length > 0 ? allMedia[0].url : undefined;
  const mediaType = allMedia.length > 0 ? allMedia[0].type : undefined;
  const mediaUrls = allMedia.length > 0 ? allMedia.map(m => m.url) : undefined;
  const mediaTypes = allMedia.length > 0 ? allMedia.map(m => m.type) : undefined;

  // ── Session key (agent-scoped, platform-aware) ─────────────────────────────
  // Format: agent:main:satori-channel:{platform}:{direct|group}:{peerId}
  // The platform segment (e.g. "onebot", "telegram") disambiguates accounts
  // across different platforms connected via the same Satori endpoint.
  const platform = account.platform.toLowerCase();
  const peerId = (isDirect ? senderId : channelId).toLowerCase();
  const sessionKey = `agent:main:satori-channel:${platform}:${chatType}:${peerId}`;

  // ── Quote / reply context ──────────────────────────────────────────────────
  const quote = message.quote;
  const replyToId = quote?.id;
  const replyToBody = quote?.content
    ? extractTextFromContent(quote.content)
    : undefined;
  const replyToSender = quote?.user?.name ?? quote?.user?.id;

  // ── Gate 3: requireMention (groups only) ──────────────────────────────────
  // Compute CommandAuthorized before mention check so authorized senders bypass it
  // Uses allowFrom (sender IDs), not groupAllowFrom (group/channel IDs)
  const allowFrom = account.allowFrom ?? [];
  const commandAuthorized =
    allowFrom.includes("*") ||
    allowFrom.includes(senderId) ||
    allowFrom.some(id => String(id) === senderId);

  if (!isDirect && account.requireMention) {
    const selfId = account.selfId;
    const wasMentioned = selfId
      ? /<at\b[^>]*?id="([^"]*)"[^>]*?\/>/gi.test(message.content ?? "") &&
        new RegExp(`<at\\b[^>]*?id="${selfId}"[^>]*?\\/>`, "i").test(message.content ?? "")
      : false;
    if (!wasMentioned && !commandAuthorized) {
      log?.debug?.(`[satori:${accountId}] Group message dropped: requireMention=true, not mentioned`);
      return;
    }
  }

  // ── Construct MsgContext ───────────────────────────────────────────────────
  const msgCtx: MsgContext = {
    Body: bodyText,
    BodyForAgent: bodyText,
    RawBody: bodyText,
    CommandBody: bodyText,
    From: isDirect
      ? `satori-channel:${platform}:direct:${senderId}`
      : `satori-channel:${platform}:group:${channelId}`,
    To: channelId,
    SessionKey: sessionKey,
    AccountId: accountId,
    MessageSid: message.id,
    ChatType: chatType,
    Provider: "satori-channel",
    SenderId: senderId,
    SenderName: senderName,
    ...(mediaUrl ? { MediaUrl: mediaUrl } : {}),
    ...(mediaType ? { MediaType: mediaType } : {}),
    ...(mediaUrls ? { MediaUrls: mediaUrls } : {}),
    ...(mediaTypes ? { MediaTypes: mediaTypes } : {}),
    ...(replyToId ? { ReplyToId: replyToId } : {}),
    ...(replyToBody ? { ReplyToBody: replyToBody } : {}),
    ...(replyToSender ? { ReplyToSender: replyToSender } : {}),
    ...(guild?.name ? { GroupSubject: guild.name } : guild ? { GroupSubject: guild.id } : {}),
    ...(channel?.name ? { GroupChannel: channel.name } : {}),
  };

  // ── Deliver callback: send reply via Satori HTTP API ──────────────────────
  const apiBase = `http://${account.host}:${account.port}${account.path}/v1`;
  const headers = buildApiHeaders(account);

  const deliver = async (payload: { text?: string }): Promise<void> => {
    const text = payload.text?.trim();
    if (!text) return;

    let response: Response;
    try {
      response = await fetch(`${apiBase}/message.create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ channel_id: channelId, content: text }),
      });
    } catch (err) {
      log?.error(
        `[satori:${accountId}] HTTP request to message.create failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log?.error(
        `[satori:${accountId}] message.create returned ${response.status}: ${body}`
      );
    }
  };

  // ── Dispatch ───────────────────────────────────────────────────────────────
  ctx.setStatus({ ...ctx.getStatus(), lastInboundAt: Date.now() });

  try {
    const ctx: MsgContext & { CommandAuthorized: boolean } = {
      ...msgCtx,
      CommandAuthorized: commandAuthorized,
    };
    await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx,
      cfg,
      dispatcherOptions: { deliver },
    });
  } catch (err) {
    log?.error(
      `[satori:${accountId}] dispatchReplyWithBufferedBlockDispatcher error: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
