import WebSocket from "ws";
import type { ChannelGatewayAdapter, ChannelGatewayContext } from "openclaw/plugin-sdk";
import { handleSatoriEvent } from "./inbound.js";
import { setAccountFeatures } from "./features.js";
import { buildApiBase, buildApiHeaders } from "./api.js";
import { SatoriOpcode } from "./types.js";
import type { SatoriAccount, SatoriEvent, SatoriReadyBody, SatoriSignal } from "./types.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Heartbeat interval required by the Satori spec (10 s). */
const PING_INTERVAL_MS = 10_000;
/** Initial reconnect delay. Doubles on each failure, capped at MAX. */
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

// ─── Gateway Adapter ───────────────────────────────────────────────────────────

export const satoriGatewayAdapter: ChannelGatewayAdapter<SatoriAccount> = {
  /**
   * Open and maintain a WebSocket connection to the Satori event gateway.
   *
   * Lifecycle:
   *  1. Connect to `ws://<host>:<port><path>/v1/events`
   *  2. Send IDENTIFY with token + optional session-recovery `sn`
   *  3. Send PING every 10 s; receive PONG
   *  4. On READY: mark connected
   *  5. On EVENT: dispatch to `handleSatoriEvent`
   *  6. On disconnect: exponential-backoff reconnect until aborted
   *
   * Returns when the `abortSignal` fires and the socket is closed.
   */
  async startAccount(ctx: ChannelGatewayContext<SatoriAccount>): Promise<void> {
    const { account, accountId, log, abortSignal } = ctx;

    /** Last received sequence number — used for session recovery on reconnect */
    let lastSn: number | undefined;
    let reconnectDelay = RECONNECT_BASE_MS;
    let reconnectAttempts = 0;

    // ── Prefetch features via login.get before connecting ──────────────────────
    // This ensures listActions() never runs with an empty feature cache.
    try {
      const r = await fetch(`${buildApiBase(account)}/login.get`, {
        method: "POST",
        headers: buildApiHeaders(account),
        body: "{}",
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const data = await r.json() as Record<string, unknown>;
        const features = data.features;
        if (Array.isArray(features) && features.length > 0) {
          setAccountFeatures(accountId, features as string[]);
          log?.info(`[satori:${accountId}] Features (prefetch): ${(features as string[]).join(", ")}`);
        }
      }
    } catch {
      // Non-fatal: server may not be up yet; features will be populated on READY
    }

    // ── Mark running ───────────────────────────────────────────────────────────
    ctx.setStatus({
      ...ctx.getStatus(),
      running: true,
      connected: false,
      lastStartAt: Date.now(),
      lastError: null,
    });

    /**
     * Single connection attempt. Resolves when the connection closes (or is
     * aborted), at which point the caller decides whether to retry.
     */
    async function runConnection(): Promise<"reconnect" | "done"> {
      if (abortSignal.aborted) return "done";

      const wsUrl = `ws://${account.host}:${account.port}${account.path}/v1/events`;
      log?.info(`[satori:${accountId}] Connecting → ${wsUrl}`);

      return new Promise<"reconnect" | "done">((resolve) => {
        let ws: WebSocket;

        try {
          ws = new WebSocket(wsUrl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log?.error(`[satori:${accountId}] Failed to create WebSocket: ${msg}`);
          ctx.setStatus({ ...ctx.getStatus(), lastError: msg });
          resolve("reconnect");
          return;
        }

        let pingTimer: ReturnType<typeof setInterval> | undefined;
        let settled = false;

        const settle = (result: "reconnect" | "done") => {
          if (settled) return;
          settled = true;
          if (pingTimer) clearInterval(pingTimer);
          resolve(result);
        };

        const send = (signal: SatoriSignal): void => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(signal));
          }
        };

        // ── Abort handler ────────────────────────────────────────────────────
        abortSignal.addEventListener(
          "abort",
          () => {
            if (pingTimer) clearInterval(pingTimer);
            if (
              ws.readyState !== WebSocket.CLOSED &&
              ws.readyState !== WebSocket.CLOSING
            ) {
              ws.close(1000, "shutdown");
            }
            settle("done");
          },
          { once: true }
        );

        // ── WebSocket events ─────────────────────────────────────────────────
        ws.on("open", () => {
          if (abortSignal.aborted) {
            ws.close(1000, "shutdown");
            return;
          }

          reconnectDelay = RECONNECT_BASE_MS; // reset on successful TCP connect
          log?.info(`[satori:${accountId}] Handshaking…`);

          // Send IDENTIFY (with optional session-recovery sn)
          send({
            op: SatoriOpcode.IDENTIFY,
            body: {
              ...(account.token ? { token: account.token } : {}),
              ...(lastSn !== undefined ? { sn: lastSn } : {}),
            },
          });

          // Start heartbeat
          pingTimer = setInterval(() => {
            send({ op: SatoriOpcode.PING });
          }, PING_INTERVAL_MS);
        });

        ws.on("message", (rawData) => {
          let signal: SatoriSignal;
          try {
            signal = JSON.parse(rawData.toString()) as SatoriSignal;
          } catch {
            log?.warn(`[satori:${accountId}] Received unparseable WebSocket frame`);
            return;
          }

          switch (signal.op) {
            case SatoriOpcode.EVENT: {
              const event = signal.body as SatoriEvent | undefined;
              if (!event) break;
              if (typeof event.sn === "number") lastSn = event.sn;
              // Fire-and-forget; errors are caught inside handleSatoriEvent
              handleSatoriEvent(event, ctx).catch((err) => {
                log?.error(
                  `[satori:${accountId}] Unhandled error in event handler: ${
                    err instanceof Error ? err.message : String(err)
                  }`
                );
              });
              break;
            }

            case SatoriOpcode.READY: {
              reconnectAttempts = 0;
              ctx.setStatus({
                ...ctx.getStatus(),
                connected: true,
                reconnectAttempts: 0,
                lastConnectedAt: Date.now(),
                lastError: null,
              });
              // Seed features from READY body (fast path)
              const readyBody = signal.body as SatoriReadyBody | undefined;
              const readyFeatures = readyBody?.logins?.[0]?.features;
              if (Array.isArray(readyFeatures) && readyFeatures.length > 0) {
                setAccountFeatures(accountId, readyFeatures);
              }
              // Authoritative fetch via login.get (may return a superset)
              fetch(`${buildApiBase(account)}/login.get`, {
                method: "POST",
                headers: buildApiHeaders(account),
                body: "{}",
              })
                .then((r) => r.json())
                .then((data: unknown) => {
                  const features = (data as Record<string, unknown>)?.features;
                  if (Array.isArray(features) && features.length > 0) {
                    setAccountFeatures(accountId, features as string[]);
                    log?.info(`[satori:${accountId}] Features: ${(features as string[]).join(", ")}`);
                  }
                })
                .catch(() => {/* non-fatal */});
              log?.info(`[satori:${accountId}] Connected`);
              break;
            }

            case SatoriOpcode.PONG: {
              log?.debug?.(`[satori:${accountId}] PONG`);
              break;
            }

            case SatoriOpcode.META: {
              log?.debug?.(`[satori:${accountId}] META update`);
              break;
            }

            default:
              break;
          }
        });

        ws.on("error", (err) => {
          log?.error(`[satori:${accountId}] WebSocket error: ${err.message}`);
          ctx.setStatus({ ...ctx.getStatus(), lastError: err.message });
          // "close" will fire after "error" — let it handle the settle
        });

        ws.on("close", (code, reason) => {
          if (pingTimer) clearInterval(pingTimer);
          const reasonStr = reason?.toString() || "";
          log?.info(
            `[satori:${accountId}] Disconnected (code=${code}${
              reasonStr ? ` reason=${reasonStr}` : ""
            })`
          );
          ctx.setStatus({
            ...ctx.getStatus(),
            connected: false,
            lastDisconnect: {
              at: Date.now(),
              status: code,
              ...(reasonStr ? { error: reasonStr } : {}),
            },
          });
          settle(abortSignal.aborted ? "done" : "reconnect");
        });
      });
    }

    // ── Main reconnect loop ────────────────────────────────────────────────────
    while (!abortSignal.aborted) {
      const outcome = await runConnection();

      if (outcome === "done" || abortSignal.aborted) break;

      // Exponential back-off before next attempt
      reconnectAttempts++;
      ctx.setStatus({ ...ctx.getStatus(), reconnectAttempts });

      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      log?.info(`[satori:${accountId}] Reconnecting in ${delay} ms…`);

      await new Promise<void>((res) => {
        const t = setTimeout(res, delay);
        abortSignal.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true });
      });
    }

    // ── Mark stopped ───────────────────────────────────────────────────────────
    ctx.setStatus({
      ...ctx.getStatus(),
      running: false,
      connected: false,
      lastStopAt: Date.now(),
    });
    log?.info(`[satori:${accountId}] Gateway stopped`);
  },

  async stopAccount(ctx: ChannelGatewayContext<SatoriAccount>): Promise<void> {
    // The abort signal drives shutdown; nothing extra needed here.
    ctx.log?.info(`[satori:${ctx.accountId}] Stop requested`);
  },
};
