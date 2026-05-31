"use client"

import { ArrowRight, Fingerprint, GitFork } from "lucide-react"
import { truncateAddr } from "@/lib/tracer"
import { riskLabel } from "@/lib/aggregates"
import { clusterColor } from "@/components/views/dashboard-view"
import type { TraceResult } from "@/lib/types"

function toneText(tone: "danger" | "warn" | "ok" | "none") {
  if (tone === "danger") return "text-destructive"
  if (tone === "warn") return "text-accent"
  return "text-primary"
}

export function ConnectionsView({ trace }: { trace: TraceResult }) {
  const clusters = trace.ownershipClusters ?? []
  const transfers = trace.internalTransfers ?? []

  // Build cluster lookup for colouring
  const clusterLookup = new Map<string, number>()
  for (let i = 0; i < clusters.length; i++) {
    for (const addr of clusters[i]) clusterLookup.set(addr, i)
  }

  // Build adjacency: which source addresses are connected and how
  const sourceMap = new Map(trace.sources.map((s) => [s.address, s]))
  const connections = new Map<string, { targets: Set<string>; sources: Set<string> }>()
  for (const t of transfers) {
    if (!connections.has(t.from)) connections.set(t.from, { targets: new Set(), sources: new Set() })
    if (!connections.has(t.to)) connections.set(t.to, { targets: new Set(), sources: new Set() })
    connections.get(t.from)!.targets.add(t.to)
    connections.get(t.to)!.sources.add(t.from)
  }

  // Unique addresses involved in any connection (transfer or cluster)
  const connectedAddrs = new Set<string>()
  for (const t of transfers) { connectedAddrs.add(t.from); connectedAddrs.add(t.to) }
  for (const c of clusters) for (const a of c) connectedAddrs.add(a)
  const isolatedCount = trace.sources.filter((s) => !connectedAddrs.has(s.address)).length

  if (transfers.length === 0 && clusters.length === 0) {
    return (
      <div className="rounded-sm border border-border bg-card/60 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          {"// no connections detected between source addresses"}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          no internal transfers or common-input-ownership links found
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-4 rounded-sm border border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
        <span>{transfers.length} internal transfer{transfers.length !== 1 ? "s" : ""}</span>
        <span>{clusters.length} ownership cluster{clusters.length !== 1 ? "s" : ""}</span>
        <span>{connectedAddrs.size} connected address{connectedAddrs.size !== 1 ? "es" : ""}</span>
        <span>{isolatedCount} isolated</span>
      </div>

      {/* Internal transfers */}
      {transfers.length > 0 && (
        <div className="rounded-sm border border-border bg-card/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <GitFork className="size-3.5" /> internal transfers
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Direct on-chain transfers between your source addresses. Each is a provable link.
          </p>
          <div className="space-y-2">
            {transfers.map((t, i) => {
              const fromSrc = sourceMap.get(t.from)
              const toSrc = sourceMap.get(t.to)
              const fromCluster = clusterLookup.get(t.from)
              const toCluster = clusterLookup.get(t.to)
              const fromBest = fromSrc?.links.length ? fromSrc.links[0].score : null
              const toBest = toSrc?.links.length ? toSrc.links[0].score : null
              const fromRisk = riskLabel(fromBest)
              const toRisk = riskLabel(toBest)

              return (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-background/50 px-3 py-2.5"
                >
                  <div className="flex items-center gap-1.5">
                    {fromCluster != null && (
                      <span className={`rounded-sm ${clusterColor(fromCluster).bg} px-1 py-0.5 text-[9px] uppercase tracking-widest ${clusterColor(fromCluster).text}`}>
                        c{fromCluster + 1}
                      </span>
                    )}
                    <code className="text-xs text-foreground">{truncateAddr(t.from, 10, 8)}</code>
                    <span className={`text-[10px] font-bold ${toneText(fromRisk.tone)}`}>
                      {fromRisk.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-primary/60">
                    <ArrowRight className="size-3.5" />
                    <span className="text-[10px] text-foreground">{t.valueBtc.toFixed(6)} BTC</span>
                    <ArrowRight className="size-3.5" />
                  </div>

                  <div className="flex items-center gap-1.5">
                    {toCluster != null && (
                      <span className={`rounded-sm ${clusterColor(toCluster).bg} px-1 py-0.5 text-[9px] uppercase tracking-widest ${clusterColor(toCluster).text}`}>
                        c{toCluster + 1}
                      </span>
                    )}
                    <code className="text-xs text-foreground">{truncateAddr(t.to, 10, 8)}</code>
                    <span className={`text-[10px] font-bold ${toneText(toRisk.tone)}`}>
                      {toRisk.label}
                    </span>
                  </div>

                  <code className="ml-auto text-[10px] text-muted-foreground/50">
                    {t.txid.slice(0, 12)}…
                  </code>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Ownership clusters */}
      {clusters.length > 0 && (
        <div className="rounded-sm border border-border bg-card/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <Fingerprint className="size-3.5" /> ownership clusters (CIOH)
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Addresses that co-spent in the same transaction — provably the same entity.
          </p>
          <div className="space-y-2">
            {clusters.map((cluster, i) => {
              const cc = clusterColor(i)
              const clusterSources = trace.sources.filter((s) => cluster.includes(s.address))
              const totalBtc = clusterSources.reduce((s, src) => s + src.balanceBtc, 0)
              const allLinks = clusterSources.flatMap((s) => s.links)
              const bestLink = allLinks.length > 0
                ? allLinks.reduce((best, l) => (l.score < best.score ? l : best))
                : null
              // Exchanges exposed by this cluster
              const exchangeNames = [...new Set(allLinks.map((l) => l.exchange))]

              return (
                <div
                  key={i}
                  className={`rounded-sm border ${cc.border} bg-background/50 px-3 py-2`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] uppercase tracking-widest ${cc.text}`}>
                      cluster {i + 1}
                    </span>
                    {cluster.map((addr) => {
                      const src = sourceMap.get(addr)
                      return (
                        <span key={addr} className="flex items-center gap-1">
                          <code className="text-xs text-foreground">{truncateAddr(addr, 10, 8)}</code>
                          {src && src.balanceBtc > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {src.balanceBtc.toFixed(4)}
                            </span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                    <span>{totalBtc.toFixed(4)} BTC total</span>
                    {bestLink && (
                      <span>
                        best link: <span className="text-destructive">{bestLink.exchange}</span> · obscurity {bestLink.score}
                      </span>
                    )}
                    {exchangeNames.length > 1 && (
                      <span className="text-accent">
                        cross-exchange: {exchangeNames.join(", ")}
                      </span>
                    )}
                    {exchangeNames.length === 0 && <span>no CEX links</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
