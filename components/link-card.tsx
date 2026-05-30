"use client"

import { AlertTriangle, GitBranch } from "lucide-react"
import { strengthColor, truncateAddr } from "@/lib/tracer"
import type { CexLink } from "@/lib/types"
import { PathGraph } from "@/components/path-graph"

interface LinkCardProps {
  sourceAddress: string
  link: CexLink
}

function ScoreBar({ label, value, weight }: { label: string; value: number; weight: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>
          {label} <span className="text-muted-foreground/60">{weight}</span>
        </span>
        <span className="text-foreground">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-primary/70"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}

export function LinkCard({ sourceAddress, link }: LinkCardProps) {
  return (
    <div className="rounded-sm border border-border bg-card/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive" />
          <span className="text-sm font-bold uppercase tracking-widest text-destructive">
            {link.exchange}
          </span>
          <span
            className={`rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
              link.direction === "inflow"
                ? "bg-accent/15 text-accent"
                : "bg-destructive/15 text-destructive"
            }`}
          >
            {link.direction === "inflow" ? "received from" : "sent to"}
          </span>
          <span className="text-xs text-muted-foreground">
            via {link.hops} hop{link.hops > 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            link strength
          </span>
          <span className={`text-sm font-bold tracking-widest ${strengthColor(link.strength)}`}>
            {link.strength}
          </span>
          <span className="rounded-sm border border-border px-2 py-0.5 text-xs text-foreground">
            obscurity {link.score}
          </span>
        </div>
      </div>

      <div className="grid gap-4 py-4 sm:grid-cols-2 md:grid-cols-3">
        <ScoreBar label="tx obscurity" value={link.breakdown.transaction} weight="·20%" />
        <ScoreBar label="counterparty" value={link.breakdown.counterparty} weight="·25%" />
        <ScoreBar label="hop depth" value={link.breakdown.hop} weight="·15%" />
        <ScoreBar label="value dilution" value={link.breakdown.valueContinuity} weight="·20%" />
        <ScoreBar label="fan-out" value={link.breakdown.fanOut} weight="·15%" />
        <ScoreBar label="cex confidence" value={link.breakdown.cexConfidence} weight="·5%" />
      </div>

      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
        <GitBranch className="size-3.5" /> path reconstruction
      </div>
      <PathGraph sourceAddress={sourceAddress} link={link} />

      {link.path.length > 1 && (
        <div className="mt-4 space-y-2">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            intermediate wallet analysis
          </div>
          {link.path.slice(0, -1).map((w, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-background/50 px-3 py-2 text-xs"
            >
              <code className="text-foreground">{truncateAddr(w.address, 12, 8)}</code>
              <div className="flex items-center gap-4 text-muted-foreground">
                <span>{w.txCount} tx</span>
                <span>{w.uniqueCounterparties} cp</span>
                {w.outputCount != null && (
                  <span>{w.outputCount} out</span>
                )}
                {w.valuePassthrough != null && (
                  <span>{(w.valuePassthrough * 100).toFixed(0)}% fwd</span>
                )}
                {w.isPossibleCex && (
                  <span className="text-accent">possible CEX</span>
                )}
                <span className="text-foreground/80">{w.directness}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
