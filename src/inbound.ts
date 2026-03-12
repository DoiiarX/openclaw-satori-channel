import type { ChannelGatewayContext } from "openclaw/plugin-sdk";
import type { SatoriAccount, SatoriEvent } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

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
 * Check if image understanding is available (imageModel or media.image configured)
 */
function hasImageCapability(cfg: any): boolean {
  // Check if imageModel is configured
  if (cfg?.agents?.defaults?.imageModel) {
    return true;
  }

  // Check if media.image is enabled
  if (cfg?.tools?.media?.image?.enabled !== false) {
    // If explicitly enabled or has models configured
    if (cfg?.tools?.media?.image?.enabled === true ||
        cfg?.tools?.media?.image?.models?.length > 0 ||
        cfg?.tools?.media?.models?.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Strip Satori XML-like element tags to produce plain text suitable for the
 * agent prompt. Rich elements (images, audio, video) are replaced with
 * human-readable placeholders.
 *
 * @param content - Satori message content with XML tags
 * @param includeUrls - If true, include URLs/paths in placeholders for MCP tool access
 */
export function extractTextFromContent(content: string, includeUrls = false): string {
  let text = content;

  if (includeUrls) {
    // Include URLs/paths in placeholders for MCP tools (when no native image capability)
    text = text
      .replace(/<img\b[^>]*?\bsrc="([^"]+)"[^>]*?\/>/gi, "[图片: $1]")
      .replace(/<audio\b[^>]*?\bsrc="([^"]+)"[^>]*?\/>/gi, "[语音: $1]")
      .replace(/<video\b[^>]*?\bsrc="([^"]+)"[^>]*?\/>/gi, "[视频: $1]")
      .replace(/<file\b[^>]*?\bsrc="([^"]+)"[^>]*?\/>/gi, "[文件: $1]")
      // Fallback for media without src attribute
      .replace(/<img\b[^>]*?\/>/gi, "[图片]")
      .replace(/<audio\b[^>]*?\/>/gi, "[语音]")
      .replace(/<video\b[^>]*?\/>/gi, "[视频]")
      .replace(/<file\b[^>]*?\/>/gi, "[文件]");
  } else {
    // Simple placeholders (when native image capability exists)
    text = text
      .replace(/<img\b[^>]*?\/>/gi, "[图片]")
      .replace(/<audio\b[^>]*?\/>/gi, "[语音]")
      .replace(/<video\b[^>]*?\/>/gi, "[视频]")
      .replace(/<file\b[^>]*?\/>/gi, "[文件]");
  }

  text = text
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

// ─── Media download ────────────────────────────────────────────────────────────

/**
 * Download media from URL to a temporary directory with read-only permissions.
 * Supports both HTTP(S) URLs and data URIs (base64).
 *
 * @param url - Media URL or data URI
 * @param type - Media type (image/audio/video/file)
 * @returns Local file path or undefined on failure
 */
async function downloadMedia(
  url: string,
  type: string,
  log?: { debug?: (msg: string) => void; error?: (msg: string) => void }
): Promise<string | undefined> {
  try {
    // Decode HTML entities in URL (e.g., &amp; -> &)
    const decodedUrl = url
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Create media directory in OpenClaw workspace (accessible and secure)
    const homeDir = os.homedir();
    const mediaDir = path.join(homeDir, ".openclaw", "workspace", "satori-media");
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true, mode: 0o755 });
    }

    // Sanitize filename to prevent path traversal attacks
    const sanitizedFilename = `${crypto.randomUUID()}`;

    // Handle data URI (base64)
    if (decodedUrl.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(decodedUrl);
      if (!match) {
        log?.error?.("Invalid data URI format");
        return undefined;
      }

      const [, mimeType, base64Data] = match;
      const ext = getExtensionFromMimeType(mimeType) || getDefaultExtension(type);
      const filename = `${sanitizedFilename}${ext}`;
      const filepath = path.join(mediaDir, filename);

      const buffer = Buffer.from(base64Data, "base64");
      fs.writeFileSync(filepath, buffer, { mode: 0o444 }); // Read-only
      log?.debug?.(`Downloaded data URI to ${filepath} (${buffer.length} bytes)`);
      return filepath;
    }

    // Handle HTTP(S) URL
    if (decodedUrl.startsWith("http://") || decodedUrl.startsWith("https://")) {
      const urlObj = new URL(decodedUrl);
      const ext = path.extname(urlObj.pathname) || getDefaultExtension(type);
      const filename = `${sanitizedFilename}${ext}`;
      const filepath = path.join(mediaDir, filename);

      // Download file
      const response = await fetch(decodedUrl);
      if (!response.ok) {
        log?.error?.(`Failed to download ${decodedUrl}: ${response.status}`);
        return undefined;
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(filepath, Buffer.from(buffer), { mode: 0o444 }); // Read-only (no write/execute)
      log?.debug?.(`Downloaded ${decodedUrl} to ${filepath} (${buffer.byteLength} bytes)`);
      return filepath;
    }

    log?.error?.(`Unsupported URL scheme: ${decodedUrl}`);
    return undefined;
  } catch (err) {
    log?.error?.(`Media download error: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string | undefined {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "application/pdf": ".pdf",
  };
  return map[mimeType.toLowerCase()];
}

/**
 * Get default extension based on media type
 */
function getDefaultExtension(type: string): string {
  const map: Record<string, string> = {
    image: ".jpg",
    audio: ".mp3",
    video: ".mp4",
    file: ".bin",
  };
  return map[type] || ".bin";
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
  // Check if image capability is available to decide format
  const includeUrls = !hasImageCapability(cfg);
  const allMedia = extractAllMedia(message.content);
  const mediaUrl = allMedia.length > 0 ? allMedia[0].url : undefined;
  const mediaType = allMedia.length > 0 ? allMedia[0].type : undefined;
  const mediaUrls = allMedia.length > 0 ? allMedia.map(m => m.url) : undefined;
  const mediaTypes = allMedia.length > 0 ? allMedia.map(m => m.type) : undefined;

  // ── Download media to local temp directory ────────────────────────────────
  let mediaPath: string | undefined;
  let mediaPaths: string[] | undefined;

  if (allMedia.length > 0) {
    log?.debug?.(`[satori:${accountId}] Attempting to download ${allMedia.length} media file(s)`);

    // Download first media (for MediaPath)
    mediaPath = await downloadMedia(allMedia[0].url, allMedia[0].type, log);
    if (!mediaPath) {
      log?.warn?.(`[satori:${accountId}] Failed to download primary media, will use URL fallback`);
    }

    // Download all media (for MediaPaths)
    const downloadPromises = allMedia.map(m => downloadMedia(m.url, m.type, log));
    const downloadedPaths = await Promise.all(downloadPromises);
    mediaPaths = downloadedPaths.filter((p): p is string => p !== undefined);

    if (mediaPaths.length === 0) {
      log?.warn?.(`[satori:${accountId}] All media downloads failed, message will use original URLs`);
      mediaPaths = undefined;
    } else if (mediaPaths.length < allMedia.length) {
      log?.warn?.(`[satori:${accountId}] ${allMedia.length - mediaPaths.length} media download(s) failed`);
    }
  }

  // ── Replace URLs with local paths in XML tags ─────────────────────────────
  let processedContent = message.content;
  if (includeUrls && mediaPaths && mediaPaths.length > 0) {
    // Replace src URLs with local paths in XML tags
    for (let i = 0; i < allMedia.length && i < mediaPaths.length; i++) {
      if (mediaPaths[i]) {
        // Escape special regex characters in URL
        const urlEscaped = allMedia[i].url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`src="${urlEscaped}"`, 'g');
        processedContent = processedContent.replace(regex, `src="${mediaPaths[i]}"`);
      }
    }
  }

  // ── Build body text ────────────────────────────────────────────────────────
  const bodyText = extractTextFromContent(processedContent, includeUrls);

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
  // In groups, requireMention applies to everyone (no bypass for allowFrom users)
  // allowFrom is only for private chat access control (Gate 1)
  if (!isDirect && account.requireMention) {
    const selfId = account.selfId;
    const wasMentioned = selfId
      ? /<at\b[^>]*?id="([^"]*)"[^>]*?\/>/gi.test(message.content ?? "") &&
        new RegExp(`<at\\b[^>]*?id="${selfId}"[^>]*?\\/>`, "i").test(message.content ?? "")
      : false;
    if (!wasMentioned) {
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
    ...(mediaPath ? { MediaPath: mediaPath } : {}),
    ...(mediaPaths ? { MediaPaths: mediaPaths } : {}),
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
