"use client"

import { Activity, Terminal } from "lucide-react"

interface TerminalHeaderProps {
  nodeAddress: string
  online: boolean
}

export function TerminalHeader({ nodeAddress, online }: TerminalHeaderProps) {
  return (
    <header className="border-b border-border bg-card/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block size-2 rounded-full ${
                online ? "bg-primary text-glow" : "bg-muted-foreground"
              }`}
              style={online ? { boxShadow: "0 0 8px var(--primary)" } : undefined}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              NODE:{" "}
              <span className={online ? "text-primary" : "text-muted-foreground"}>
                {nodeAddress || "—not set—"}
              </span>
            </span>
          </div>
          <div className="hidden items-center gap-1.5 text-muted-foreground sm:flex">
            <Activity className="size-3.5" />
            <span>{online ? "LINK UP" : "STANDBY"}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
