import { NextRequest } from "next/server"
import {
  ElectrumSession,
  parseNodeAddress,
  type ElectrumNotification,
} from "@/lib/electrum"

/**
 * SSE endpoint streaming live network data from a dedicated Electrum connection.
 * Uses exactly ONE socket, separate from the tracing pool.
 *
 * Events:
 *   - "status"  { height, headerHex, timestamp, feeEstimates, mempoolHistogram }
 *   - "block"   same shape, pushed when a new block arrives
 *   - "error"   { message }
 */

interface BlockHeader {
  height: number
  hex: string
}

interface FeeEstimates {
  nextBlock: number | null   // sat/vB for 1-block target
  halfHour: number | null    // 3-block target
  hour: number | null        // 6-block target
}

/** Fetch fee estimates for 1, 3, 6 block targets. Returns sat/vB (rounded). */
async function fetchFees(session: ElectrumSession): Promise<FeeEstimates> {
  const targets = [1, 3, 6]
  const results = await Promise.allSettled(
    targets.map((t) => session.call("blockchain.estimatefee", [t])),
  )

  function parse(r: PromiseSettledResult<Awaited<ReturnType<typeof session.call>>>): number | null {
    if (r.status !== "fulfilled") return null
    const val = r.value.result as number
    // electrum returns BTC/kB, convert to sat/vB: * 1e8 / 1000
    if (typeof val !== "number" || val <= 0) return null
    return Math.round((val * 1e8) / 1000)
  }

  return {
    nextBlock: parse(results[0]),
    halfHour: parse(results[1]),
    hour: parse(results[2]),
  }
}

/**
 * Fetch mempool fee histogram.
 * Returns array of [feeRate, vsize] buckets sorted high-to-low.
 */
async function fetchMempool(session: ElectrumSession): Promise<number[][]> {
  try {
    const res = await session.call("mempool.get_fee_histogram", [])
    if (res.error || !Array.isArray(res.result)) return []
    return res.result as number[][]
  } catch {
    return []
  }
}

/** Summarise histogram into total vsize (MB) and pressure label. */
function summariseMempool(histogram: number[][]): { totalMb: number; pressure: string } {
  let totalVsize = 0
  for (const [, vsize] of histogram) totalVsize += vsize
  const totalMb = Math.round((totalVsize / 1_000_000) * 10) / 10

  // Rough pressure thresholds based on typical 300 vMB block-weight capacity
  let pressure: string
  if (totalMb < 5) pressure = "low"
  else if (totalMb < 30) pressure = "moderate"
  else if (totalMb < 100) pressure = "busy"
  else pressure = "congested"

  return { totalMb, pressure }
}

export async function GET(req: NextRequest) {
  const nodeAddress = req.nextUrl.searchParams.get("node")
  const useTls = req.nextUrl.searchParams.get("tls") === "1"

  if (!nodeAddress?.trim()) {
    return new Response("Missing node parameter", { status: 400 })
  }

  const { host, port } = parseNodeAddress(nodeAddress)

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let alive = true

      function send(event: string, data: unknown) {
        if (!alive) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          alive = false
        }
      }

      const session = new ElectrumSession(host, port, 30_000, useTls)

      // Heartbeat to keep SSE connection alive through proxies
      const heartbeat = setInterval(() => {
        if (!alive) return
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"))
        } catch {
          alive = false
        }
      }, 25_000)

      try {
        await session.connect()

        // Handshake
        const ver = await session.call("server.version", ["DOXd-Live", "1.4"])
        if (ver.error) {
          send("error", { message: `Handshake failed: ${ver.error.message}` })
          controller.close()
          return
        }

        // Subscribe to new block headers
        const subRes = await session.call("blockchain.headers.subscribe", [])
        if (subRes.error) {
          send("error", { message: `Header subscribe failed: ${subRes.error.message}` })
          controller.close()
          return
        }

        const currentHeader = subRes.result as BlockHeader

        // Fetch initial fee + mempool data
        const [fees, histogram] = await Promise.all([
          fetchFees(session),
          fetchMempool(session),
        ])
        const mempool = summariseMempool(histogram)

        send("status", {
          height: currentHeader.height,
          headerHex: currentHeader.hex,
          timestamp: Date.now(),
          feeEstimates: fees,
          mempool,
          mempoolHistogram: histogram,
        })

        // Handle new block notifications
        session.onNotification = async (n: ElectrumNotification) => {
          if (!alive) return
          if (n.method === "blockchain.headers.subscribe" && Array.isArray(n.params)) {
            const header = n.params[0] as BlockHeader
            // Fetch updated fee + mempool on new block
            const [newFees, newHistogram] = await Promise.all([
              fetchFees(session),
              fetchMempool(session),
            ])
            const newMempool = summariseMempool(newHistogram)
            send("block", {
              height: header.height,
              headerHex: header.hex,
              timestamp: Date.now(),
              feeEstimates: newFees,
              mempool: newMempool,
              mempoolHistogram: newHistogram,
            })
          }
        }

        // Keep alive until client disconnects
        // The request signal abort will trigger cleanup
        await new Promise<void>((resolve) => {
          req.signal.addEventListener("abort", () => {
            alive = false
            resolve()
          })
          // Also resolve if we lose the connection
          const check = setInterval(() => {
            if (!alive) {
              clearInterval(check)
              resolve()
            }
          }, 5000)
        })
      } catch (err) {
        const msg = err instanceof Error
          ? err.message || err.constructor.name
          : String(err) || "Unknown error"
        send("error", { message: msg || "Connection failed" })
      } finally {
        alive = false
        clearInterval(heartbeat)
        session.close()
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
