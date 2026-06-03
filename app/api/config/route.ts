import { NextResponse } from "next/server"

// Runtime-evaluated so values come from the container's env, not the build.
export const dynamic = "force-dynamic"

/**
 * Exposes deploy-time defaults to the client. On Umbrel (and any Docker
 * deploy) the host's Electrum/Fulcrum node is reachable on the internal
 * network, so we pre-fill its address from env to spare the user typing it.
 *
 *   DEFAULT_NODE      e.g. "bitcoin_electrs_1:50001"
 *   DEFAULT_NODE_TLS  "1" / "true" to default the TLS toggle on
 */
export async function GET() {
  const defaultNode = process.env.DEFAULT_NODE?.trim() || ""
  const tlsRaw = process.env.DEFAULT_NODE_TLS?.trim().toLowerCase() || ""
  const defaultTls = tlsRaw === "1" || tlsRaw === "true" || tlsRaw === "yes"

  return NextResponse.json({ defaultNode, defaultTls })
}
