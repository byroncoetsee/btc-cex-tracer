import { NextResponse } from "next/server"
import {
  electrumCall,
  parseNodeAddress,
} from "@/lib/electrum"

export async function POST(req: Request) {
  try {
    const { nodeAddress, tls: useTls } = (await req.json()) as { nodeAddress?: string; tls?: boolean }
    if (!nodeAddress?.trim()) {
      return NextResponse.json(
        { ok: false, error: "No node address provided" },
        { status: 400 },
      )
    }

    const { host, port } = parseNodeAddress(nodeAddress)

    const versionRes = await electrumCall(host, port, "server.version", [
      "BTC-Tracer",
      "1.4",
    ], 8000, useTls ?? false)
    if (versionRes.error) {
      return NextResponse.json({
        ok: false,
        error: `Server rejected handshake: ${versionRes.error.message}`,
      })
    }

    const [serverName, protocolVersion] = (versionRes.result as string[]) || []

    return NextResponse.json({
      ok: true,
      server: serverName ?? "unknown",
      protocol: protocolVersion ?? "unknown",
    })
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown connection error"
    return NextResponse.json({ ok: false, error: message })
  }
}
