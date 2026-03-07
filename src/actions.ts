import {
  createActionGate,
  jsonResult,
  readNumberParam,
  readStringParam,
  type ChannelMessageActionAdapter,
  type ChannelMessageActionContext,
  type ChannelMessageActionName,
  type ChannelToolSend,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import { resolveApiAccount, satoriGet, satoriPost } from "./api.js";

// ─── Actions config helper ─────────────────────────────────────────────────────
// Reads from cfg.channels["satori-channel"].actions

type SatoriActionsConfig = {
  reactions?: boolean;
  messages?: boolean;
  memberInfo?: boolean;
  channelInfo?: boolean;
};

function getActionsConfig(cfg: OpenClawConfig): SatoriActionsConfig {
  const ch = (cfg.channels as Record<string, unknown>)?.["satori-channel"] as Record<string, unknown> | undefined;
  return (ch?.["actions"] as SatoriActionsConfig) ?? {};
}

// ─── Param helpers ─────────────────────────────────────────────────────────────

function resolveChannelId(params: Record<string, unknown>): string {
  return (
    readStringParam(params, "channelId") ??
    readStringParam(params, "to", { required: true })
  );
}

// ─── Actions adapter ───────────────────────────────────────────────────────────

export const satoriMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }): ChannelMessageActionName[] => {
    const gate = createActionGate(getActionsConfig(cfg));
    const actions = new Set<ChannelMessageActionName>(["send"]);
    // Reactions: react + list reactions — enabled by default
    if (gate("reactions", true)) {
      actions.add("react");
      actions.add("reactions");
    }
    // Message ops: read history, edit, delete — enabled by default
    if (gate("messages", true)) {
      actions.add("read");
      actions.add("edit");
      actions.add("delete");
      actions.add("unsend");
    }
    // Member info — enabled by default
    if (gate("memberInfo", true)) {
      actions.add("member-info");
    }
    // Channel/guild info — enabled by default
    if (gate("channelInfo", true)) {
      actions.add("channel-info");
      actions.add("channel-list");
    }
    return Array.from(actions);
  },

  supportsAction: ({ action }): boolean =>
    [
      "send",
      "react", "reactions",
      "read", "edit", "delete", "unsend",
      "member-info",
      "channel-info", "channel-list",
    ].includes(action),

  extractToolSend: ({ args }): ChannelToolSend | null => {
    const action = typeof args.action === "string" ? args.action.trim() : "";
    if (action !== "send") return null;
    const to = typeof args.to === "string" ? args.to.trim() : undefined;
    if (!to) return null;
    return { to };
  },

  handleAction: async (ctx: ChannelMessageActionContext) => {
    const { action, params, cfg, accountId } = ctx;
    const account = resolveApiAccount(cfg, accountId);

    // ── send ──────────────────────────────────────────────────────────────────
    if (action === "send") {
      const to = readStringParam(params, "to", { required: true });
      const content = readStringParam(params, "message", { required: true, allowEmpty: true }) ?? "";
      const result = await satoriPost(account, "message.create", { channel_id: to, content });
      return jsonResult({ ok: true, result });
    }

    // ── member-info ─────────────────────────────────────────────────────────
    // mode="none": no target injected; guildId comes from params or is omitted
    if (action === "member-info") {
      const userId = readStringParam(params, "userId", { required: true });
      const guildId = readStringParam(params, "guildId");
      const result = await satoriGet(account, "guild.member.get", {
        ...(guildId != null ? { guild_id: guildId } : {}),
        user_id: userId,
      });
      return jsonResult(result);
    }

    // ── channel-list ─────────────────────────────────────────────────────────
    // mode="none": no target injected; guildId from params or omitted (returns all guilds/channels)
    if (action === "channel-list") {
      const guildId = readStringParam(params, "guildId");
      const next = readStringParam(params, "next");
      const result = await satoriGet(account, "channel.list", {
        ...(guildId != null ? { guild_id: guildId } : {}),
        ...(next != null ? { next } : {}),
      });
      return jsonResult(result);
    }

    // All remaining actions need a channelId injected by the framework:
    // mode="to" actions (react/reactions/read/edit/delete/unsend): framework sets args.to
    // mode="channelId" actions (channel-info): framework sets args.channelId
    const channelId = resolveChannelId(params);

    // ── react ─────────────────────────────────────────────────────────────────
    if (action === "react") {
      const messageId = readStringParam(params, "messageId", { required: true });
      const emoji = readStringParam(params, "emoji", { required: true });
      const remove = typeof params.remove === "boolean" ? params.remove : false;
      // Satori uses POST for both create and delete reactions
      const endpoint = remove ? "reaction.delete" : "reaction.create";
      await satoriPost(account, endpoint, {
        channel_id: channelId,
        message_id: messageId,
        emoji,
      });
      return jsonResult({ ok: true });
    }

    // ── reactions (list) ──────────────────────────────────────────────────────
    if (action === "reactions") {
      const messageId = readStringParam(params, "messageId", { required: true });
      const emoji = readStringParam(params, "emoji");
      const next = readStringParam(params, "next");
      const limit = readNumberParam(params, "limit", { integer: true });
      const result = await satoriGet(account, "reaction.list", {
        channel_id: channelId,
        message_id: messageId,
        ...(emoji != null ? { emoji } : {}),
        ...(next != null ? { next } : {}),
        ...(limit != null ? { limit } : {}),
      });
      return jsonResult(result);
    }

    // ── read (message history) ────────────────────────────────────────────────
    if (action === "read") {
      const next = readStringParam(params, "next");
      const limit = readNumberParam(params, "limit", { integer: true });
      const result = await satoriGet(account, "message.list", {
        channel_id: channelId,
        ...(next != null ? { next } : {}),
        ...(limit != null ? { limit } : {}),
      });
      return jsonResult(result);
    }

    // ── edit ──────────────────────────────────────────────────────────────────
    if (action === "edit") {
      const messageId = readStringParam(params, "messageId", { required: true });
      const content = readStringParam(params, "message", { required: true, allowEmpty: true }) ?? "";
      await satoriPost(account, "message.update", {
        channel_id: channelId,
        message_id: messageId,
        content,
      });
      return jsonResult({ ok: true });
    }

    // ── delete / unsend ───────────────────────────────────────────────────────
    if (action === "delete" || action === "unsend") {
      const messageId = readStringParam(params, "messageId", { required: true });
      await satoriPost(account, "message.delete", {
        channel_id: channelId,
        message_id: messageId,
      });
      return jsonResult({ ok: true });
    }

    // ── channel-info ─────────────────────────────────────────────────────────
    // mode="channelId": framework injects args.channelId = target
    if (action === "channel-info") {
      const result = await satoriGet(account, "channel.get", {
        channel_id: channelId,
      });
      return jsonResult(result);
    }

    throw new Error(`Action "${action}" is not supported by satori-channel.`);
  },
};
