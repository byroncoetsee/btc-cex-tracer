"use client"

import { useEffect, useRef, useState } from "react"

export interface FeeEstimates {
  nextBlock: number | null
  halfHour: number | null
  hour: number | null
}

export interface MempoolSummary {
  totalMb: number
  pressure: string
}

export interface NetworkStatus {
  height: number
  timestamp: number // when this data was received
  feeEstimates: FeeEstimates
  mempool: MempoolSummary
}

/**
 * Connects to the /api/network/live SSE endpoint using a single dedicated
 * Electrum connection. Provides live block height, fee estimates, and
 * mempool pressure — updated on each new block.
 */
export function useNetworkLive(nodeAddress: string, online: boolean, useTls: boolean) {
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    function cleanup() {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      setConnected(false)
      setConnecting(false)
    }

    if (!nodeAddress.trim() || !online) {
      cleanup()
      setStatus(null)
      setError(null)
      return cleanup
    }

    setConnecting(true)
    setError(null)

    const params = new URLSearchParams({
      node: nodeAddress.trim(),
      tls: useTls ? "1" : "0",
    })
    const es = new EventSource(`/api/network/live?${params}`)
    eventSourceRef.current = es

    function handleData(e: MessageEvent) {
      try {
        const data = JSON.parse(e.data)
        setStatus({
          height: data.height,
          timestamp: data.timestamp,
          feeEstimates: data.feeEstimates,
          mempool: data.mempool,
        })
        setConnected(true)
        setConnecting(false)
        setError(null)
      } catch {
        // skip malformed
      }
    }

    es.addEventListener("status", handleData)
    es.addEventListener("block", handleData)

    es.addEventListener("error", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        if (data.message) setError(data.message)
      } catch {
        // not our custom error event, just a connection drop
      }
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setConnected(false)
        setConnecting(false)
      } else {
        // CONNECTING state — EventSource is auto-reconnecting
        setConnected(false)
        setConnecting(true)
      }
    }

    return cleanup
  }, [nodeAddress, online, useTls])

  return { status, connected, connecting, error }
}
