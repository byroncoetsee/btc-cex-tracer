import { NextResponse } from "next/server"
import {
  electrumCall,
  parseNodeAddress,
  SATOSHI_SCRIPTHASH,
} from "@/lib/electrum"

export async function POST(req: Request) {
  try {
    const { nodeAddress } = (await req.json()) as { nodeAddress?: string }
    if (!nodeAddress?.trim()) {
      return NextResponse.json(
        { ok: false, error: "No node address provided" },
        { status: 400 },
      )
    }

    const { host, port } = parseNodeAddress(nodeAddress)

    // 1. Handshake — server.version
    const versionRes = await electrumCall(host, port, "server.version", [
      "BTC-Tracer", // client name
      "1.4",        // protocol version
    ])
    if (versionRes.error) {
      return NextResponse.json({
        ok: false,
        error: `Server rejected handshake: ${versionRes.error.message}`,
      })
    }

    const [serverName, protocolVersion] = (versionRes.result as string[]) || []

    // 2. Liveness — fetch Satoshi's balance
    const balanceRes = await electrumCall(
      host,
      port,
      "blockchain.scripthash.get_balance",
      [SATOSHI_SCRIPTHASH],
    )
    if (balanceRes.error) {
      return NextResponse.json({
        ok: false,
        error: `Balance query failed: ${balanceRes.error.message}`,
      })
    }

    const { confirmed, unconfirmed } = balanceRes.result as {
      confirmed: number
      unconfirmed: number
    }

    return NextResponse.json({
      ok: true,
      server: serverName ?? "unknown",
      protocol: protocolVersion ?? "unknown",
      satoshiBalance: {
        confirmed,
        unconfirmed,
        confirmedBtc: confirmed / 1e8,
      },
    })
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown connection error"
    return NextResponse.json({ ok: false, error: message })
  }
}
