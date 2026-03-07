import { z } from "zod";
import type { OpenClawPluginApi, ChannelPlugin, ChannelAccountSnapshot, OpenClawConfig } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema, buildChannelConfigSchema } from "openclaw/plugin-sdk";
import { satoriConfigAdapter } from "./src/config.js";
import { satoriGatewayAdapter } from "./src/gateway.js";
import { satoriOutboundAdapter } from "./src/outbound.js";
import { satoriMessageActions } from "./src/actions.js";
import type { SatoriAccount } from "./src/types.js";

// ─── Channel config schema (Zod → JSON Schema for UI) ─────────────────────────

const SatoriAccountSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  path: z.string().optional(),
  token: z.string().optional(),
  platform: z.string().optional(),
  selfId: z.string().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  defaultTo: z.string().optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  requireMention: z.boolean().optional(),
});

const SatoriActionsSchema = z.object({
  reactions: z.boolean().optional(),
  messages: z.boolean().optional(),
  memberInfo: z.boolean().optional(),
  channelInfo: z.boolean().optional(),
});

const SatoriChannelSchema = z.object({
  enabled: z.boolean().optional(),
  defaultAccount: z.string().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  defaultTo: z.string().optional(),
  accounts: z.record(z.string(), SatoriAccountSchema.optional()).optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  requireMention: z.boolean().optional(),
  actions: SatoriActionsSchema.optional(),
});

// ─── Default runtime snapshot (initial state before gateway starts) ───────────

const defaultRuntime: ChannelAccountSnapshot = {
  accountId: "default",
  running: false,
  connected: false,
  reconnectAttempts: 0,
  lastStartAt: null,
  lastStopAt: null,
  lastError: null,
  lastConnectedAt: null,
  lastDisconnect: null,
  lastInboundAt: null,
  lastOutboundAt: null,
};

// ─── Channel plugin ───────────────────────────────────────────────────────────

const satoriChannelPlugin: ChannelPlugin<SatoriAccount> = {
  id: "satori-channel",

  meta: {
    id: "satori-channel",
    label: "Satori",
    selectionLabel: "Satori Protocol Channel",
    blurb:
      "Connect to any chat platform via the Satori Protocol SDK " +
      "(supports Telegram, Discord, QQ/OneBot, LINE, and more).",
    docsPath: "/channels/satori",
    order: 50,
    aliases: ["satori"],
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reply: true,
    edit: true,
    unsend: true,
    reactions: true,
  },

  reload: {
    configPrefixes: ["channels.satori-channel"],
    noopPrefixes: [],
  },

  // ── Config schema (drives UI rendering) ─────────────────────────────────────
  configSchema: buildChannelConfigSchema(SatoriChannelSchema),

  // ── Adapters ─────────────────────────────────────────────────────────────────
  config: satoriConfigAdapter,
  outbound: satoriOutboundAdapter,
  gateway: satoriGatewayAdapter,
  actions: satoriMessageActions,

  // ── Directory (known peers / groups from config) ───────────────────────────
  directory: {
    self: async () => null,

    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = satoriConfigAdapter.resolveAccount(cfg, accountId);
      const q = query?.trim().toLowerCase() ?? "";
      const ids = new Set<string>();
      for (const v of account.allowFrom ?? []) {
        const s = String(v).trim();
        if (s && s !== "*") ids.add(s);
      }
      return Array.from(ids)
        .filter(id => !q || id.includes(q))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map(id => ({ kind: "user" as const, id }));
    },

    listGroups: async ({ cfg, accountId, query, limit }) => {
      const account = satoriConfigAdapter.resolveAccount(cfg, accountId);
      const q = query?.trim().toLowerCase() ?? "";
      const ids = new Set<string>();
      for (const v of account.groupAllowFrom ?? []) {
        const s = String(v).trim();
        if (s && s !== "*") ids.add(s);
      }
      return Array.from(ids)
        .filter(id => !q || id.includes(q))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map(id => ({ kind: "group" as const, id }));
    },
  },

  // ── Status adapter ───────────────────────────────────────────────────────────
  status: {
    defaultRuntime,

    async probeAccount({ account }: { account: SatoriAccount; timeoutMs: number; cfg: OpenClawConfig }): Promise<{ reachable: boolean }> {
      try {
        const url = `http://${account.host}:${account.port}${account.path}/v1`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        return { reachable: res.status < 500 };
      } catch {
        return { reachable: false };
      }
    },

    buildAccountSnapshot({
      account,
      runtime,
      probe,
    }: {
      account: SatoriAccount;
      cfg: OpenClawConfig;
      runtime?: ChannelAccountSnapshot;
      probe?: unknown;
      audit?: unknown;
    }): ChannelAccountSnapshot {
      const probeResult = probe as { reachable: boolean } | undefined;
      return {
        // Static account properties
        accountId: account.id,
        enabled: account.enabled,
        configured: !!account.host && account.platform !== "unknown" && !!account.platform,
        baseUrl: `http://${account.host}:${account.port}${account.path}`,
        tokenSource: account.token ? "config" : undefined,
        mode: "websocket",
        allowFrom: account.allowFrom,
        allowUnmentionedGroups: !account.requireMention,
        // Extra fields read by the channels UI
        ...(account.groupAllowFrom ? { groupAllowFrom: account.groupAllowFrom } : {}),
        ...(account.groupPolicy ? { groupPolicy: account.groupPolicy } : {}),
        ...(account.selfId ? { selfId: account.selfId } : {}),
        ...(account.platform ? { platform: account.platform } : {}),
        // Probe result
        ...(probeResult != null ? { probe: probeResult } : {}),

        // Runtime-tracked fields (from ctx.setStatus in gateway/inbound)
        running: runtime?.running ?? false,
        connected: runtime?.connected ?? false,
        reconnectAttempts: runtime?.reconnectAttempts ?? 0,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        lastConnectedAt: runtime?.lastConnectedAt ?? null,
        lastDisconnect: runtime?.lastDisconnect ?? null,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
    },
  },

  // ── Setup adapter ─────────────────────────────────────────────────────────────
  setup: {
    applyAccountConfig({
      cfg,
      accountId,
      input,
    }: {
      cfg: OpenClawConfig;
      accountId: string;
      input: Record<string, unknown>;
    }): OpenClawConfig {
      const config = cfg as Record<string, unknown>;
      const channels = (config.channels as Record<string, unknown>) ?? {};
      const satori = (channels[`satori`] as Record<string, unknown>) ?? {};
      const accounts = (satori.accounts as Record<string, unknown>) ?? {};
      const existing = (accounts[accountId] as Record<string, unknown>) ?? {};

      const updated: Record<string, unknown> = { ...existing };
      if (input.httpHost) updated.host = input.httpHost;
      if (input.httpPort) updated.port = parseInt(String(input.httpPort), 10);
      if (input.webhookPath) updated.path = input.webhookPath;
      if (input.token) updated.token = input.token;

      return {
        ...config,
        channels: {
          ...channels,
          satori: {
            ...satori,
            accounts: {
              ...accounts,
              [accountId]: updated,
            },
          },
        },
      } as OpenClawConfig;
    },

    validateInput(): string | null {
      return null;
    },
  },
};

// ─── Openclaw plugin wrapper ──────────────────────────────────────────────────

const plugin = {
  id: "satori-channel",
  name: "Satori Protocol Channel",
  description:
    "Satori Protocol Channel Plugin for OpenClaw - supports Telegram, Discord, QQ and other platforms via Satori SDK",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel(satoriChannelPlugin);
  },
};

export default plugin;
export { plugin };
