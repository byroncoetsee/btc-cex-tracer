import * as tls from "tls"
import * as net from "net"

/**
 * Minimal Electrum protocol client for Fulcrum / ElectrumX.
 * Supports both TLS and plain TCP, remembers which works.
 */

interface ElectrumResponse {
  jsonrpc: string
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

// ---------------------------------------------------------------------------
// Connection helpers — remembers protocol per host:port
// ---------------------------------------------------------------------------

function connectSocket(
  host: string,
  port: number,
  timeoutMs: number,
  useTls: boolean,
): Promise<net.Socket> {
  return useTls
    ? connectTLS(host, port, timeoutMs)
    : connectPlain(host, port, timeoutMs)
}

function connectTLS(
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
        reject(new Error("TLS timeout"))
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

    socket.on("error", (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        socket.destroy()
        reject(err)
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
        reject(new Error("TCP timeout"))
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
    private useTls = false,
  ) {}

  async connect(): Promise<void> {
    this.socket = await connectSocket(this.host, this.port, this.timeoutMs, this.useTls)
    this.socket.setEncoding("utf8")
    this.buf = ""

    this.socket.on("data", (chunk: string) => {
      this.buf += chunk
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
   * Send multiple RPC calls pipelined and collect responses.
   * Chunks into groups to avoid overwhelming the server.
   */
  async batch(
    calls: { method: string; params: unknown[] }[],
    chunkSize = 50,
  ): Promise<ElectrumResponse[]> {
    if (!this.socket) throw new Error("Not connected")
    if (calls.length <= chunkSize) {
      return Promise.all(calls.map((c) => this.call(c.method, c.params)))
    }
    const results: ElectrumResponse[] = []
    for (let i = 0; i < calls.length; i += chunkSize) {
      const chunk = calls.slice(i, i + chunkSize)
      const chunkResults = await Promise.all(
        chunk.map((c) => this.call(c.method, c.params)),
      )
      results.push(...chunkResults)
    }
    return results
  }

  close(): void {
    this.socket?.destroy()
    this.socket = null
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
  const session = new ElectrumSession(host, port, timeoutMs, useTls)
  await session.connect()
  try {
    return await session.call(method, params)
  } finally {
    session.close()
  }
}

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
