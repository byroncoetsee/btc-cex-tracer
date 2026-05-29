import * as tls from "tls"
import * as net from "net"

/**
 * Minimal Electrum protocol client for Fulcrum / ElectrumX.
 * Supports both TLS (port 50002) and plain TCP (port 50001).
 */

interface ElectrumResponse {
  jsonrpc: string
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

/** Try TLS first; on any TLS failure fall back to plain TCP. */
function connectSocket(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        socket.destroy()
        reject(new Error(`Connection timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)

    const socket = tls.connect(
      { host, port, rejectUnauthorized: false },
      () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(socket)
        }
      },
    )

    socket.on("error", () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        socket.destroy()
        // Any TLS failure → retry with plain TCP
        connectPlain(host, port, timeoutMs).then(resolve, reject)
      }
    })
  })
}

function connectPlain(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        socket.destroy()
        reject(new Error(`Plain TCP connection timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)

    const socket = net.connect({ host, port }, () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(socket)
      }
    })

    socket.on("error", (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })
  })
}

// ---------------------------------------------------------------------------
// ElectrumSession — single connection, pipelined requests
// ---------------------------------------------------------------------------

export class ElectrumSession {
  private socket: net.Socket | null = null
  private buf = ""
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (r: ElectrumResponse) => void; reject: (e: Error) => void }
  >()

  constructor(
    private host: string,
    private port: number,
    private timeoutMs = 30000,
  ) {}

  async connect(): Promise<void> {
    this.socket = await connectSocket(this.host, this.port, this.timeoutMs)
    this.socket.setEncoding("utf8")
    this.buf = ""

    this.socket.on("data", (chunk: string) => {
      this.buf += chunk
      // process all complete lines
      let idx: number
      while ((idx = this.buf.indexOf("\n")) !== -1) {
        const line = this.buf.slice(0, idx)
        this.buf = this.buf.slice(idx + 1)
        try {
          const msg = JSON.parse(line) as ElectrumResponse
          const p = this.pending.get(msg.id)
          if (p) {
            this.pending.delete(msg.id)
            p.resolve(msg)
          }
        } catch {
          // skip malformed lines
        }
      }
    })

    this.socket.on("error", (err) => {
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })

    this.socket.on("close", () => {
      const err = new Error("Connection closed")
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.socket = null
    })
  }

  /** Send a single RPC call and wait for its response. */
  call(method: string, params: unknown[] = []): Promise<ElectrumResponse> {
    if (!this.socket) throw new Error("Not connected")
    const id = this.nextId++
    const payload =
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, this.timeoutMs)

      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer)
          resolve(r)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })

      this.socket!.write(payload)
    })
  }

  /**
   * Send multiple RPC calls pipelined (all at once) and collect responses.
   * Much faster than sequential send-wait-send-wait.
   */
  async batch(
    calls: { method: string; params: unknown[] }[],
  ): Promise<ElectrumResponse[]> {
    if (!this.socket) throw new Error("Not connected")
    // send all requests in one write
    const promises = calls.map((c) => this.call(c.method, c.params))
    return Promise.all(promises)
  }

  close(): void {
    this.socket?.destroy()
    this.socket = null
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers (kept for backward compat with the test endpoint)
// ---------------------------------------------------------------------------

/** Open a connection, send one RPC call, read the response, then close. */
export async function electrumCall(
  host: string,
  port: number,
  method: string,
  params: unknown[] = [],
  timeoutMs = 8000,
): Promise<ElectrumResponse> {
  const session = new ElectrumSession(host, port, timeoutMs)
  await session.connect()
  try {
    return await session.call(method, params)
  } finally {
    session.close()
  }
}

/** Parse "host" or "host:port" — defaults to port 50002 (Electrum TLS). */
export function parseNodeAddress(raw: string): { host: string; port: number } {
  const trimmed = raw.trim()
  const match = trimmed.match(/^(.+):(\d+)$/)
  if (match) {
    return { host: match[1], port: parseInt(match[2], 10) }
  }
  return { host: trimmed, port: 50002 }
}

export const SATOSHI_SCRIPTHASH =
  "8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161"
