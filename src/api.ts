import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { SatoriAccount } from "./types.js";
import { satoriConfigAdapter } from "./config.js";

// ─── Account helpers ───────────────────────────────────────────────────────────

export function resolveApiAccount(
  cfg: OpenClawConfig,
  accountId?: string | null
): SatoriAccount {
  return satoriConfigAdapter.resolveAccount(cfg, accountId);
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

export function buildApiHeaders(account: SatoriAccount): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Satori-Platform": account.platform,
  };
  if (account.selfId) headers["Satori-User-ID"] = account.selfId;
  if (account.token) headers["Authorization"] = `Bearer ${account.token}`;
  return headers;
}

export function buildApiBase(account: SatoriAccount): string {
  return `http://${account.host}:${account.port}${account.path}/v1`;
}

/**
 * Satori GET request.
 * Throws on non-2xx responses.
 */
export async function satoriGet(
  account: SatoriAccount,
  endpoint: string,
  query?: Record<string, string | number | undefined>
): Promise<unknown> {
  const url = new URL(`${buildApiBase(account)}/${endpoint}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), { headers: buildApiHeaders(account) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Satori ${endpoint} error ${res.status}: ${body}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * Satori POST request.
 * All Satori write operations (including deletions) use POST.
 * Throws on non-2xx responses.
 */
export async function satoriPost(
  account: SatoriAccount,
  endpoint: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${buildApiBase(account)}/${endpoint}`, {
    method: "POST",
    headers: buildApiHeaders(account),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Satori ${endpoint} error ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}
