import type {
  ChannelConfigAdapter,
  ChannelAccountSnapshot,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  setAccountEnabledInConfigSection,
  deleteAccountFromConfigSection,
} from "openclaw/plugin-sdk";
import type { SatoriAccount, SatoriAccountConfig } from "./types.js";

const CHANNEL_KEY = "satori-channel";

// ─── Internal helpers ──────────────────────────────────────────────────────────

function getChannelSection(cfg: OpenClawConfig): Record<string, unknown> {
  return ((cfg.channels as Record<string, unknown>)?.[CHANNEL_KEY] as Record<string, unknown>) ?? {};
}

function getRawAccounts(cfg: OpenClawConfig): Record<string, SatoriAccountConfig> {
  const section = getChannelSection(cfg);
  return (section["accounts"] as Record<string, SatoriAccountConfig>) ?? {};
}

function normalizeAllowFrom(raw?: string | string[]): string[] | undefined {
  if (!raw) return undefined;
  const arr = typeof raw === "string" ? [raw] : raw;
  return arr.length > 0 ? arr : undefined;
}

function buildAccount(id: string, raw: SatoriAccountConfig, root: SatoriAccountConfig): SatoriAccount {
  const rawPath = raw.path ?? root.path ?? "";
  const normalizedPath = rawPath === "/" ? "" : rawPath.replace(/\/+$/, "");

  return {
    id,
    host: raw.host ?? root.host ?? "localhost",
    port: raw.port ?? root.port ?? 5140,
    path: normalizedPath,
    token: raw.token ?? root.token,
    platform: raw.platform ?? root.platform ?? "unknown",
    selfId: raw.selfId ?? root.selfId,
    enabled: raw.enabled !== false,
    allowFrom: normalizeAllowFrom(raw.allowFrom ?? root.allowFrom),
    defaultTo: raw.defaultTo ?? root.defaultTo,
    groupPolicy: raw.groupPolicy ?? root.groupPolicy ?? "allowlist",
    groupAllowFrom: normalizeAllowFrom(raw.groupAllowFrom ?? root.groupAllowFrom),
    requireMention: raw.requireMention ?? root.requireMention ?? true,
  };
}

function resolveAccountId(
  cfg: OpenClawConfig,
  accountId?: string | null
): string {
  const section = getChannelSection(cfg);
  const accounts = getRawAccounts(cfg);
  return (
    accountId ??
    (section["defaultAccount"] as string | undefined) ??
    Object.keys(accounts)[0] ??
    "default"
  );
}

// ─── Config Adapter ────────────────────────────────────────────────────────────

export const satoriConfigAdapter: ChannelConfigAdapter<SatoriAccount> = {
  listAccountIds(cfg: OpenClawConfig): string[] {
    return Object.keys(getRawAccounts(cfg));
  },

  resolveAccount(cfg: OpenClawConfig, accountId?: string | null): SatoriAccount {
    const section = getChannelSection(cfg);
    const accounts = getRawAccounts(cfg);
    const id = resolveAccountId(cfg, accountId);
    const raw: SatoriAccountConfig = accounts[id] ?? {};
    return buildAccount(id, raw, section as SatoriAccountConfig);
  },

  defaultAccountId(cfg: OpenClawConfig): string {
    return resolveAccountId(cfg, undefined);
  },

  // ── Enable / disable ─────────────────────────────────────────────────────────

  setAccountEnabled({ cfg, accountId, enabled }: { cfg: OpenClawConfig; accountId: string; enabled: boolean }): OpenClawConfig {
    return setAccountEnabledInConfigSection({
      cfg,
      sectionKey: CHANNEL_KEY,
      accountId,
      enabled,
    });
  },

  // ── Delete ───────────────────────────────────────────────────────────────────

  deleteAccount({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }): OpenClawConfig {
    return deleteAccountFromConfigSection({
      cfg,
      sectionKey: CHANNEL_KEY,
      accountId,
    });
  },

  // ── State checks ─────────────────────────────────────────────────────────────

  isEnabled(account: SatoriAccount): boolean {
    return account.enabled;
  },

  isConfigured(account: SatoriAccount): boolean {
    return !!account.host && account.platform !== "unknown" && !!account.platform;
  },

  unconfiguredReason(account: SatoriAccount): string {
    if (!account.platform || account.platform === "unknown") {
      return 'Satori platform not set. Add channels.satori.accounts.<id>.platform (e.g. "telegram", "onebot")';
    }
    return "Satori host not set. Add channels.satori.accounts.<id>.host";
  },

  // ── Snapshot ─────────────────────────────────────────────────────────────────

  describeAccount(account: SatoriAccount, _cfg: OpenClawConfig): ChannelAccountSnapshot {
    return {
      accountId: account.id,
      enabled: account.enabled,
      configured: !!account.host && account.platform !== "unknown" && !!account.platform,
      baseUrl: `http://${account.host}:${account.port}${account.path}`,
      tokenSource: account.token ? "config" : undefined,
      mode: "websocket",
      allowFrom: account.allowFrom,
      // runtime-tracked fields start as null; status.buildAccountSnapshot fills them in
      lastInboundAt: null,
      lastOutboundAt: null,
    };
  },

  // ── Allow-from / default-to ──────────────────────────────────────────────────

  resolveAllowFrom({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }): Array<string | number> | undefined {
    const section = getChannelSection(cfg);
    const accounts = getRawAccounts(cfg);
    const id = resolveAccountId(cfg, accountId);
    const raw: SatoriAccountConfig = accounts[id] ?? {};

    const combined = new Set<string>();
    const add = (v?: string | string[]) => {
      if (typeof v === "string") combined.add(v);
      else if (Array.isArray(v)) v.forEach((e) => combined.add(e));
    };

    add(raw.allowFrom);
    add(section["allowFrom"] as string | string[] | undefined);

    return combined.size > 0 ? [...combined] : undefined;
  },

  resolveDefaultTo({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }): string | undefined {
    const section = getChannelSection(cfg);
    const accounts = getRawAccounts(cfg);
    const id = resolveAccountId(cfg, accountId);
    const raw: SatoriAccountConfig = accounts[id] ?? {};
    return raw.defaultTo ?? (section["defaultTo"] as string | undefined);
  },
};
