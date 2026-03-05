// Satori Protocol type definitions
// Spec: https://satori.chat/zh-CN/protocol/

export const SatoriOpcode = {
  /** Inbound: event payload */
  EVENT: 0,
  /** Outbound: heartbeat ping */
  PING: 1,
  /** Inbound: heartbeat pong */
  PONG: 2,
  /** Outbound: authentication */
  IDENTIFY: 3,
  /** Inbound: authentication success */
  READY: 4,
  /** Inbound: SDK metadata update */
  META: 5,
} as const;

export type SatoriOpcodeValue = (typeof SatoriOpcode)[keyof typeof SatoriOpcode];

// ─── Satori Resources ─────────────────────────────────────────────────────────

export type SatoriUser = {
  id: string;
  name?: string;
  nick?: string;
  avatar?: string;
  is_bot?: boolean;
};

export type SatoriChannel = {
  id: string;
  /** 0 = text/group, 1 = direct/DM */
  type?: number;
  name?: string;
};

export type SatoriGuild = {
  id: string;
  name?: string;
  avatar?: string;
};

export type SatoriMember = {
  user?: SatoriUser;
  nick?: string;
  avatar?: string;
  joined_at?: number;
};

export type SatoriMessage = {
  id?: string;
  content?: string;
  channel?: SatoriChannel;
  guild?: SatoriGuild;
  member?: SatoriMember;
  user?: SatoriUser;
  created_at?: number;
  updated_at?: number;
  quote?: SatoriMessage;
};

export type SatoriLogin = {
  user?: SatoriUser;
  self_id?: string;
  platform?: string;
  /** 0=offline, 1=online, 2=connecting, 3=disconnecting, 4=reconnecting */
  status?: number;
  features?: string[];
};

// ─── WebSocket Signal ──────────────────────────────────────────────────────────

export type SatoriSignal<T = unknown> = {
  op: SatoriOpcodeValue;
  body?: T;
};

export type SatoriEvent = {
  sn?: number;
  type?: string;
  timestamp?: number;
  login?: SatoriLogin;
  channel?: SatoriChannel;
  guild?: SatoriGuild;
  member?: SatoriMember;
  message?: SatoriMessage;
  operator?: SatoriUser;
  user?: SatoriUser;
};

export type SatoriReadyBody = {
  logins: SatoriLogin[];
  proxy_urls?: string[];
};

// ─── Plugin Account Config ─────────────────────────────────────────────────────

/** Raw account configuration as stored in OpenClaw config */
export type SatoriAccountConfig = {
  host?: string;
  port?: number;
  /** Base path prefix for the Satori server, e.g. "/satori". Defaults to "". */
  path?: string;
  token?: string;
  /** Satori platform identifier, e.g. "telegram", "discord", "onebot" */
  platform?: string;
  /** Bot self user ID on the platform */
  selfId?: string;
  enabled?: boolean;
  allowFrom?: string | string[];
  defaultTo?: string;
  /** Controls whether group messages are processed. Default: "allowlist" */
  groupPolicy?: "open" | "allowlist" | "disabled";
  /** Sender IDs allowed to interact in group chats */
  groupAllowFrom?: string | string[];
  /** If true, bot only replies in groups when directly @mentioned. Default: true */
  requireMention?: boolean;
};

/** Resolved and validated account */
export type SatoriAccount = {
  id: string;
  host: string;
  port: number;
  /** Normalized base path, e.g. "" or "/satori" (no trailing slash). */
  path: string;
  token?: string;
  platform: string;
  selfId?: string;
  enabled: boolean;
  allowFrom?: string[];
  defaultTo?: string;
  groupPolicy: "open" | "allowlist" | "disabled";
  groupAllowFrom?: string[];
  requireMention: boolean;
};
