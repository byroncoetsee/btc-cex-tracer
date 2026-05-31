import * as tls from "tls";
import * as net from "net";

/**
 * Minimal Electrum protocol client for Fulcrum / ElectrumX.
 * Supports both TLS and plain TCP, remembers which works.
 */

interface ElectrumResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Push notification from a subscription (no id, has method). */
export interface ElectrumNotification {
  jsonrpc: string;
  method: string;
  params: unknown[];
}

// ---------------------------------------------------------------------------
// Connection helpers — remembers protocol per host:port
// ---------------------------------------------------------------------------

function connectSocket(host: string, port: number, timeoutMs: number, useTls: boolean): Promise<net.Socket> {
  return useTls ? connectTLS(host, port, timeoutMs) : connectPlain(host, port, timeoutMs);
}

function connectTLS(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error("TLS timeout"));
      }
    }, timeoutMs);

    const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      }
    });

    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      }
    });
  });
}

function connectPlain(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error("TCP timeout"));
      }
    }, timeoutMs);

    const socket = net.connect({ host, port }, () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      }
    });

    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// ElectrumSession — resilient connection with auto-reconnect & paced batching
// ---------------------------------------------------------------------------

const DEFAULT_CHUNK_SIZE = 20;
const INTER_CHUNK_DELAY_MS = 40;
const MAX_CHUNK_RETRIES = 2;
const RECONNECT_BACKOFF_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /connection closed|not connected|connection reset|timeout|ECONNRESET|EPIPE|socket hang up|write after end/i.test(msg);
}

export class ElectrumSession {
  private socket: net.Socket | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: ElectrumResponse) => void; reject: (e: Error) => void }>();
  private connecting: Promise<void> | null = null;
  private closed = false;

  /** Optional handler for subscription push notifications. */
  onNotification: ((n: ElectrumNotification) => void) | null = null;

  constructor(
    private host: string,
    private port: number,
    private timeoutMs = 30000,
    private useTls = false,
  ) {}

  get connected(): boolean {
    return this.socket !== null;
  }

  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.closed = false;
    this.connecting = this.open();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async open(): Promise<void> {
    const socket = await connectSocket(this.host, this.port, this.timeoutMs, this.useTls);
    socket.setEncoding("utf8");
    this.socket = socket;
    this.buf = "";

    socket.on("data", (chunk: string) => {
      this.buf += chunk;
      let idx: number;
      while ((idx = this.buf.indexOf("\n")) !== -1) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          // Subscription push notifications have "method" but no "id"
          if ("method" in msg && !("id" in msg)) {
            this.onNotification?.(msg as ElectrumNotification);
            continue;
          }
          const resp = msg as ElectrumResponse;
          const p = this.pending.get(resp.id);
          if (p) {
            this.pending.delete(resp.id);
            p.resolve(resp);
          }
        } catch {
          // skip malformed lines
        }
      }
    });

    const fail = (err: Error) => {
      if (this.socket === socket) this.socket = null;
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };

    socket.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    socket.on("close", () => fail(new Error("Connection closed")));
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new Error("Session closed");
    if (!this.socket) await this.connect();
  }

  private dropSocket(reason = "Connection reset"): void {
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.removeAllListeners();
      s.destroy();
    }
    const err = new Error(reason);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.buf = "";
  }

  /** Send a single RPC call and wait for its response. */
  call(method: string, params: unknown[] = []): Promise<ElectrumResponse> {
    return new Promise((resolve, reject) => {
      const sock = this.socket;
      if (!sock) {
        reject(new Error("Not connected"));
        return;
      }
      const id = this.nextId++;
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      try {
        sock.write(payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Send multiple RPC calls pipelined and collect responses.
   * Sends in small chunks with pacing to stay under the server's
   * per-connection write buffer, and transparently reconnects + retries
   * a chunk if the socket drops mid-flight.
   */
  async batch(calls: { method: string; params: unknown[] }[], chunkSize = DEFAULT_CHUNK_SIZE): Promise<ElectrumResponse[]> {
    const results: ElectrumResponse[] = new Array(calls.length);
    for (let i = 0; i < calls.length; i += chunkSize) {
      const chunk = calls.slice(i, i + chunkSize);
      const chunkResults = await this.sendChunk(chunk);
      for (let j = 0; j < chunkResults.length; j++) {
        results[i + j] = chunkResults[j];
      }
      if (i + chunkSize < calls.length) await delay(INTER_CHUNK_DELAY_MS);
    }
    return results;
  }

  private async sendChunk(chunk: { method: string; params: unknown[] }[], attempt = 0): Promise<ElectrumResponse[]> {
    try {
      await this.ensureConnected();
      return await Promise.all(chunk.map((c) => this.call(c.method, c.params)));
    } catch (err) {
      if (!this.closed && attempt < MAX_CHUNK_RETRIES && isTransientError(err)) {
        this.dropSocket();
        await delay(RECONNECT_BACKOFF_MS * (attempt + 1));
        try {
          await this.connect();
        } catch {
          // ensureConnected on the next attempt will try again
        }
        return this.sendChunk(chunk, attempt + 1);
      }
      throw err;
    }
  }

  close(): void {
    this.closed = true;
    this.dropSocket("Session closed");
  }
}

// ---------------------------------------------------------------------------
// ElectrumPool — multiple connections, work distributed across them
// ---------------------------------------------------------------------------

const POOL_SIZE = 10;
const POOL_RECONNECT_DELAY_MS = 30_000;

export class ElectrumPool {
  private sessions: ElectrumSession[] = [];
  private healthy: boolean[] = [];
  private reconnecting: boolean[] = [];
  private roundRobin = 0;
  private poolClosed = false;

  constructor(
    private host: string,
    private port: number,
    private timeoutMs = 30000,
    private useTls = false,
    private size = POOL_SIZE,
  ) {}

  /** Open all connections. Connections that fail are marked unhealthy and will reconnect in background. */
  async connect(): Promise<void> {
    this.poolClosed = false;
    const connectResults = await Promise.allSettled(
      Array.from({ length: this.size }, async () => {
        const s = new ElectrumSession(this.host, this.port, this.timeoutMs, this.useTls);
        await s.connect();
        return s;
      }),
    );

    for (let i = 0; i < this.size; i++) {
      const r = connectResults[i];
      if (r.status === "fulfilled") {
        this.sessions[i] = r.value;
        this.healthy[i] = true;
      } else {
        // create a placeholder session — will reconnect in background
        this.sessions[i] = new ElectrumSession(this.host, this.port, this.timeoutMs, this.useTls);
        this.healthy[i] = false;
        this.scheduleReconnect(i);
      }
      this.reconnecting[i] = false;
    }

    if (!this.sessions.some((_, i) => this.healthy[i])) {
      throw new Error("Failed to connect any pool sessions");
    }
  }

  /** How many connections are currently healthy. */
  get healthyCount(): number {
    return this.healthy.filter(Boolean).length;
  }

  private scheduleReconnect(idx: number): void {
    if (this.poolClosed || this.reconnecting[idx]) return;
    this.reconnecting[idx] = true;
    setTimeout(async () => {
      if (this.poolClosed) return;
      try {
        const s = new ElectrumSession(this.host, this.port, this.timeoutMs, this.useTls);
        await s.connect();
        // close old session if any
        this.sessions[idx]?.close();
        this.sessions[idx] = s;
        this.healthy[idx] = true;
      } catch {
        // still unhealthy — schedule another attempt
        this.scheduleReconnect(idx);
      } finally {
        this.reconnecting[idx] = false;
      }
    }, POOL_RECONNECT_DELAY_MS);
  }

  private markUnhealthy(idx: number): void {
    this.healthy[idx] = false;
    this.scheduleReconnect(idx);
  }

  /**
   * Attempt to immediately reconnect all unhealthy sessions.
   * Returns once at least one reconnects, or all attempts fail.
   */
  private async tryImmediateReconnect(): Promise<void> {
    const unhealthy = this.healthy
      .map((h, i) => (h ? -1 : i))
      .filter((i) => i >= 0);
    if (unhealthy.length === 0) return;

    const results = await Promise.allSettled(
      unhealthy.map(async (idx) => {
        const s = new ElectrumSession(this.host, this.port, this.timeoutMs, this.useTls);
        await s.connect();
        this.sessions[idx]?.close();
        this.sessions[idx] = s;
        this.healthy[idx] = true;
      }),
    );

    // if none recovered, that's fine — caller will get the "no healthy" error
    if (!results.some((r) => r.status === "fulfilled")) {
      throw new Error(`No healthy connections (${this.healthyCount}/${this.size} up)`);
    }
  }

  /** Pick the next healthy session round-robin. */
  private pick(): { session: ElectrumSession; idx: number } {
    const count = this.size;
    for (let attempt = 0; attempt < count; attempt++) {
      const idx = this.roundRobin % count;
      this.roundRobin++;
      if (this.healthy[idx]) {
        return { session: this.sessions[idx], idx };
      }
    }
    throw new Error(`No healthy connections (${this.healthyCount}/${this.size} up)`);
  }

  /** Send a single RPC call on any healthy connection. */
  async call(method: string, params: unknown[] = []): Promise<ElectrumResponse> {
    let picked: { session: ElectrumSession; idx: number };
    try {
      picked = this.pick();
    } catch {
      await this.tryImmediateReconnect();
      picked = this.pick();
    }
    const { session, idx } = picked;
    try {
      return await session.call(method, params);
    } catch (err) {
      if (isTransientError(err)) {
        this.markUnhealthy(idx);
        // retry once on another connection
        try {
          const fallback = this.pick();
          return await fallback.session.call(method, params);
        } catch {
          throw err; // original error
        }
      }
      throw err;
    }
  }

  /**
   * Distribute calls across all healthy connections.
   * Each connection gets a slice of the work, all slices run in parallel.
   */
  async batch(calls: { method: string; params: unknown[] }[]): Promise<ElectrumResponse[]> {
    if (calls.length === 0) return [];

    let healthyIdxs = this.healthy
      .map((h, i) => (h ? i : -1))
      .filter((i) => i >= 0);

    if (healthyIdxs.length === 0) {
      await this.tryImmediateReconnect();
      // re-check after reconnect attempt
      const recovered = this.healthy
        .map((h, i) => (h ? i : -1))
        .filter((i) => i >= 0);
      if (recovered.length === 0) {
        throw new Error(`No healthy connections (0/${this.size} up)`);
      }
      healthyIdxs.push(...recovered);
    }

    // distribute calls round-robin across healthy sessions
    const buckets: { calls: { method: string; params: unknown[] }[]; indices: number[] }[] =
      healthyIdxs.map(() => ({ calls: [], indices: [] }));

    for (let i = 0; i < calls.length; i++) {
      const bucket = buckets[i % healthyIdxs.length];
      bucket.calls.push(calls[i]);
      bucket.indices.push(i); // track original position
    }

    const results: ElectrumResponse[] = new Array(calls.length);

    // run all buckets in parallel — each bucket uses its own session's batch()
    const bucketResults = await Promise.allSettled(
      buckets.map(async (bucket, bIdx) => {
        const sessionIdx = healthyIdxs[bIdx];
        const session = this.sessions[sessionIdx];
        try {
          return await session.batch(bucket.calls);
        } catch (err) {
          if (isTransientError(err)) this.markUnhealthy(sessionIdx);
          throw err;
        }
      }),
    );

    // collect results, retry failed buckets on other connections
    const retries: { method: string; params: unknown[] }[] = [];
    const retryIndices: number[] = [];

    for (let bIdx = 0; bIdx < buckets.length; bIdx++) {
      const bucket = buckets[bIdx];
      const result = bucketResults[bIdx];
      if (result.status === "fulfilled") {
        for (let j = 0; j < bucket.indices.length; j++) {
          results[bucket.indices[j]] = result.value[j];
        }
      } else {
        // queue for retry
        for (let j = 0; j < bucket.calls.length; j++) {
          retries.push(bucket.calls[j]);
          retryIndices.push(bucket.indices[j]);
        }
      }
    }

    // retry failed calls on any healthy connection
    if (retries.length > 0) {
      let retried = false;
      if (this.healthyCount > 0) {
        try {
          const { session } = this.pick();
          const retryResults = await session.batch(retries);
          for (let i = 0; i < retryIndices.length; i++) {
            results[retryIndices[i]] = retryResults[i];
          }
          retried = true;
        } catch {
          // fall through to error fill
        }
      }
      if (!retried) {
        for (const idx of retryIndices) {
          if (!results[idx]) {
            results[idx] = {
              jsonrpc: "2.0",
              id: 0,
              error: { code: -1, message: "All connections failed" },
            };
          }
        }
      }
    }

    // safety net: fill any remaining undefined slots
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        results[i] = {
          jsonrpc: "2.0",
          id: 0,
          error: { code: -1, message: "No response received" },
        };
      }
    }

    return results;
  }

  close(): void {
    this.poolClosed = true;
    for (const s of this.sessions) s.close();
    this.sessions = [];
    this.healthy = [];
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

export async function electrumCall(
  host: string,
  port: number,
  method: string,
  params: unknown[] = [],
  timeoutMs = 8000,
  useTls = false,
): Promise<ElectrumResponse> {
  const session = new ElectrumSession(host, port, timeoutMs, useTls);
  await session.connect();
  try {
    return await session.call(method, params);
  } finally {
    session.close();
  }
}

export function parseNodeAddress(raw: string): { host: string; port: number } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+):(\d+)$/);
  if (match) {
    return { host: match[1], port: parseInt(match[2], 10) };
  }
  return { host: trimmed, port: 50002 };
}
