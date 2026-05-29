"use client"

import { Building2 } from "lucide-react"
import { riskLabel } from "@/lib/aggregates"
import { truncateAddr } from "@/lib/tracer"
import type { TraceResult } from "@/lib/types"

interface ExchangeGroup {
  name: string
  links: { source: string; hops: number; score: number; cexAddress: string }[]
}

function buildGroups(trace: TraceResult): ExchangeGroup[] {
  const map = new Map<string, ExchangeGroup>()
  for (const s of trace.sources) {
    for (const l of s.links) {
      const g = map.get(l.exchange) || { name: l.exchange, links: [] }
      g.links.push({
        source: s.address,
        hops: l.hops,
        score: l.score,
        cexAddress: l.exchangeAddress,
      })
      map.set(l.exchange, g)
    }
  }
  return [...map.values()]
    .map((g) => ({ ...g, links: g.links.sort((a, b) => a.score - b.score) }))
    .sort((a, b) => a.links[0].score - b.links[0].score)
}

export function ExchangesView({ trace }: { trace: TraceResult }) {
  const groups = buildGroups(trace)

  if (groups.length === 0) {
    return (
      <p className="rounded-sm border border-border bg-card/60 py-10 text-center text-sm text-muted-foreground">
        {"// no exchange links to break down"}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const avgHops =
          g.links.reduce((a, b) => a + b.hops, 0) / g.links.length
        const best = riskLabel(g.links[0].score)
        return (
          <div key={g.name} className="rounded-sm border border-border bg-card/60">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <Building2 className="size-4 text-destructive" />
              <span className="text-sm font-bold uppercase tracking-widest text-destructive">
                {g.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {g.links.length} connection{g.links.length > 1 ? "s" : ""} · avg{" "}
                {avgHops.toFixed(1)} hops
              </span>
              <span className={`ml-auto text-xs font-bold ${
                best.tone === "danger" ? "text-destructive" : best.tone === "warn" ? "text-accent" : "text-primary"
              }`}>
                {best.label}
              </span>
            </div>
            <div className="divide-y divide-border">
              {g.links.map((l, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs"
                >
                  <code className="text-foreground">{truncateAddr(l.source, 12, 8)}</code>
                  <span className="text-muted-foreground/60">→</span>
                  <code className="text-destructive/80">{truncateAddr(l.cexAddress, 10, 6)}</code>
                  <span className="ml-auto text-muted-foreground">{l.hops} hops</span>
                  <span className="w-24 text-right text-foreground">obscurity {l.score}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
