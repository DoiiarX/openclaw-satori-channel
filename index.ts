import { z } from "zod";
import type { OpenClawPluginApi, ChannelPlugin, ChannelAccountSnapshot, OpenClawConfig } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema, buildChannelConfigSchema } from "openclaw/plugin-sdk";
import { satoriConfigAdapter } from "./src/config.js";
import { satoriGatewayAdapter } from "./src/gateway.js";
import { satoriOutboundAdapter } from "./src/outbound.js";
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

const SatoriChannelSchema = z.object({
  enabled: z.boolean().optional(),
  defaultAccount: z.string().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  defaultTo: z.string().optional(),
  accounts: z.record(z.string(), SatoriAccountSchema.optional()).optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  requireMention: z.boolean().optional(),
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
    edit: false,
    unsend: false,
  },

  reload: {
    configPrefixes: ["channels.satori"],
    noopPrefixes: [],
  },

  // ── Config schema (drives UI rendering) ─────────────────────────────────────
  configSchema: buildChannelConfigSchema(SatoriChannelSchema),

  // ── Adapters ─────────────────────────────────────────────────────────────────
  config: satoriConfigAdapter,
  outbound: satoriOutboundAdapter,
  gateway: satoriGatewayAdapter,

  // ── Status adapter ───────────────────────────────────────────────────────────
  status: {
    defaultRuntime,

    buildAccountSnapshot({
      account,
      runtime,
    }: {
      account: SatoriAccount;
      cfg: OpenClawConfig;
      runtime?: ChannelAccountSnapshot;
      probe?: unknown;
      audit?: unknown;
    }): ChannelAccountSnapshot {
      return {
        // Static account properties
        accountId: account.id,
        enabled: account.enabled,
        configured: !!account.host && account.platform !== "unknown" && !!account.platform,
        baseUrl: `http://${account.host}:${account.port}${account.path}`,
        tokenSource: account.token ? "config" : undefined,
        mode: "websocket",
        allowFrom: account.allowFrom,

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
