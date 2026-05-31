"use client"

import { useEffect, useState } from "react"
import { Activity, Blocks, Gauge, Layers, Loader2, Terminal } from "lucide-react"
import type { NetworkStatus } from "@/hooks/use-network-live"

interface TerminalHeaderProps {
  nodeAddress: string
  online: boolean
  liveStatus: NetworkStatus | null
  liveConnected: boolean
  liveConnecting: boolean
}

function useElapsed(ts: number | undefined): string {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!ts) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ts])
  if (!ts) return ""
  const secs = Math.max(0, Math.floor((now - ts) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

function fmtFee(v: number | null): string {
  return v === null ? "—" : `${v}`
}

const PRESSURE_COLORS: Record<string, { bar: string; text: string }> = {
  low:       { bar: "bg-primary",     text: "text-primary" },
  moderate:  { bar: "bg-yellow-500",  text: "text-yellow-500" },
  busy:      { bar: "bg-orange-500",  text: "text-orange-500" },
  congested: { bar: "bg-destructive", text: "text-destructive" },
}

export function TerminalHeader({ nodeAddress, online, liveStatus, liveConnected, liveConnecting }: TerminalHeaderProps) {
  const elapsed = useElapsed(liveStatus?.timestamp)

  // Derive dot + label state
  const live = liveConnected && !!liveStatus
  let dotClass: string
  let dotShadow: React.CSSProperties | undefined
  let statusLabel: string

  if (live) {
    dotClass = "bg-primary animate-pulse"
    dotShadow = { boxShadow: "0 0 8px var(--primary)" }
    statusLabel = "LIVE"
  } else if (liveConnecting) {
    dotClass = "bg-yellow-500 animate-pulse"
    dotShadow = { boxShadow: "0 0 6px #eab308" }
    statusLabel = "SYNCING"
  } else if (online) {
    dotClass = "bg-primary"
    dotShadow = { boxShadow: "0 0 8px var(--primary)" }
    statusLabel = "LINK UP"
  } else {
    dotClass = "bg-muted-foreground"
    dotShadow = undefined
    statusLabel = "STANDBY"
  }

  return (
    <header className="border-b border-border bg-card/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left — logo */}
        <div className="flex items-center gap-3">
          <div className="box-glow flex size-9 items-center justify-center rounded-sm border border-primary/40 bg-background">
            <Terminal className="size-5 text-primary text-glow" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-bold tracking-[0.2em] text-primary text-glow">
              TC&nbsp;ADDRESS&nbsp;TRACER
            </h1>
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              btc chain-analysis console v1.0
            </p>
          </div>
        </div>

        {/* Right — node status + live data */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {/* Node indicator */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-block size-2 rounded-full ${dotClass}`}
              style={dotShadow}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              NODE:{" "}
              <span className={online ? "text-primary" : "text-muted-foreground"}>
                {nodeAddress || "—not set—"}
              </span>
            </span>
          </div>

          {/* Status label */}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {liveConnecting && !live ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Activity className="size-3.5" />
            )}
            <span className={live ? "text-primary" : undefined}>{statusLabel}</span>
          </div>

          {/* Live network data — only when streaming */}
          {live && liveStatus && (
            <>
              <div className="hidden items-center gap-1.5 sm:flex" title="Latest block height">
                <Blocks className="size-3 text-primary/60" />
                <span className="font-mono text-primary">{liveStatus.height.toLocaleString()}</span>
                <span className="text-muted-foreground/50 text-[10px]">{elapsed}</span>
              </div>

              <div className="hidden items-center gap-1.5 md:flex" title="Fee estimates: next block / ~30m / ~1h (sat/vB)">
                <Gauge className="size-3 text-muted-foreground/60" />
                <span className="font-mono text-foreground">{fmtFee(liveStatus.feeEstimates.nextBlock)}</span>
                <span className="text-muted-foreground/30">/</span>
                <span className="font-mono text-foreground/70">{fmtFee(liveStatus.feeEstimates.halfHour)}</span>
                <span className="text-muted-foreground/30">/</span>
                <span className="font-mono text-foreground/50">{fmtFee(liveStatus.feeEstimates.hour)}</span>
                <span className="text-muted-foreground/40 text-[9px]">s/vB</span>
              </div>

              <div className="hidden items-center gap-1.5 lg:flex" title={`Mempool: ${liveStatus.mempool.totalMb} vMB`}>
                <Layers className="size-3 text-muted-foreground/60" />
                <div className="h-1.5 w-10 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      (PRESSURE_COLORS[liveStatus.mempool.pressure] ?? PRESSURE_COLORS.low).bar
                    }`}
                    style={{ width: `${Math.max(8, Math.min(100, (liveStatus.mempool.totalMb / 200) * 100))}%` }}
                  />
                </div>
                <span className={`text-[10px] uppercase ${
                  (PRESSURE_COLORS[liveStatus.mempool.pressure] ?? PRESSURE_COLORS.low).text
                }`}>
                  {liveStatus.mempool.pressure}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
