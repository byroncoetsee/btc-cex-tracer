import * as fs from "fs"
import * as path from "path"
import { parseNodeAddress } from "@/lib/electrum"
import { loadCexDatabase } from "@/lib/cex"
import { runRealTrace, type TraceSourceInput } from "@/lib/trace"

const LOG_DIR = path.join(process.cwd(), "trace-logs")

export async function POST(req: Request) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const logLines: string[] = []
      const t0 = Date.now()

      function send(event: string, data: unknown) {
        if (event === "log") {
          const elapsed = ((Date.now() - t0) / 1000).toFixed(2)
          const line = `[+${elapsed}s] ${(data as { message: string }).message}`
          logLines.push(line)
        }
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        )
      }

      function flushLog() {
        try {
          if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
          const ts = new Date().toISOString().replace(/[:.]/g, "-")
          const logPath = path.join(LOG_DIR, `trace-${ts}.log`)
          fs.writeFileSync(logPath, logLines.join("\n") + "\n")
        } catch {
          /* best-effort */
        }
      }

      try {
        const { nodeAddress, sources, depth, tls: useTls } = (await req.json()) as {
          nodeAddress: string
          sources: TraceSourceInput[]
          depth: number
          tls?: boolean
        }

        if (!sources?.length) {
          send("error", { message: "No funded addresses to trace. Run a lookup first." })
          controller.close()
          return
        }

        const { host, port } = parseNodeAddress(nodeAddress)

        // load CEX database (cached after first call)
        send("log", { message: "$ loading CEX address database…" })
        const cexDb = await loadCexDatabase()
        send("log", {
          message: `> ${cexDb.totalAddresses.toLocaleString()} known CEX addresses loaded`,
        })

        send("log", {
          message: `> tracing ${sources.length} funded address${sources.length > 1 ? "es" : ""} at depth ${depth}…`,
        })

        const result = await runRealTrace(
          sources,
          host,
          port,
          depth,
          cexDb,
          (msg) => send("log", { message: msg }),
          useTls ?? false,
        )

        send("done", { result })
        flushLog()
      } catch (err) {
        send("error", {
          message:
            err instanceof Error ? err.message : "Unknown trace error",
        })
        flushLog()
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
