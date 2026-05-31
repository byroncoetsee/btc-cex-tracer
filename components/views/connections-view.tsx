"use client"

import { useMemo, useState } from "react"
import { ArrowRight, Fingerprint, GitFork } from "lucide-react"
import { truncateAddr } from "@/lib/tracer"
import { riskLabel } from "@/lib/aggregates"
import { clusterColor } from "@/components/views/dashboard-view"
import type { TraceResult, SourceAddress } from "@/lib/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toneText(tone: "danger" | "warn" | "ok" | "none") {
  if (tone === "danger") return "text-destructive"
  if (tone === "warn") return "text-accent"
  return "text-primary"
}

const TONE_HEX: Record<string, string> = {
  danger: "#ef4444",
  warn: "#f59e0b",
  ok: "#22c55e",
  none: "#6b7280",
}

const CLUSTER_HEX = [
  "#f43f5e", "#38bdf8", "#f59e0b", "#34d399",
  "#a78bfa", "#fb923c", "#22d3ee", "#f472b6",
]

function riskToneHex(score: number | null) {
  return TONE_HEX[riskLabel(score).tone] ?? TONE_HEX.none
}

// ---------------------------------------------------------------------------
// Graph layout — circular with CEX stubs
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string
  x: number
  y: number
  label: string
  balance: number
  riskScore: number | null
  clusterIdx: number | undefined
  isCex: boolean
  cexName?: string
  exchanges: string[]
}

interface GraphEdge {
  from: string
  to: string
  valueBtc?: number
  hops?: number
  kind: "transfer" | "cioh" | "cex"
}

function buildGraph(trace: TraceResult) {
  const clusters = trace.ownershipClusters ?? []
  const transfers = trace.internalTransfers ?? []
  const clusterLookup = new Map<string, number>()
  for (let i = 0; i < clusters.length; i++)
    for (const addr of clusters[i]) clusterLookup.set(addr, i)

  // Only include source addresses that are part of some connection
  const connectedAddrs = new Set<string>()
  for (const t of transfers) { connectedAddrs.add(t.from); connectedAddrs.add(t.to) }
  for (const c of clusters) for (const a of c) connectedAddrs.add(a)

  // Also include sources with CEX links that are in a cluster
  for (const s of trace.sources) {
    if (s.links.length > 0 && clusterLookup.has(s.address)) connectedAddrs.add(s.address)
  }

  const sourceAddrs = trace.sources
    .filter((s) => connectedAddrs.has(s.address))
  const sourceMap = new Map<string, SourceAddress>(trace.sources.map((s) => [s.address, s]))

  // Layout constants
  const cx = 300, cy = 220, radius = 160
  const nodes: GraphNode[] = []
  const addrIndex = new Map<string, number>()

  // Arrange source nodes in a circle
  for (let i = 0; i < sourceAddrs.length; i++) {
    const s = sourceAddrs[i]
    const angle = (2 * Math.PI * i) / sourceAddrs.length - Math.PI / 2
    const best = s.links.length ? s.links[0].score : null
    const exchanges = [...new Set(s.links.map((l) => l.exchange))]
    addrIndex.set(s.address, nodes.length)
    nodes.push({
      id: s.address,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      label: truncateAddr(s.address, 6, 4),
      balance: s.balanceBtc,
      riskScore: best,
      clusterIdx: clusterLookup.get(s.address),
      isCex: false,
      exchanges,
    })
  }

  // Add CEX stubs — small nodes outside the circle for each unique exchange connection
  const cexPositions = new Map<string, { x: number; y: number; id: string }>()
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.exchanges.length === 0) continue
    for (const ex of n.exchanges) {
      if (!cexPositions.has(ex)) {
        // Place CEX nodes further out from the center
        const angle = Math.atan2(n.y - cy, n.x - cx)
        const cexId = `cex:${ex}`
        const cexR = radius + 60
        cexPositions.set(ex, {
          x: cx + cexR * Math.cos(angle),
          y: cy + cexR * Math.sin(angle),
          id: cexId,
        })
        addrIndex.set(cexId, nodes.length)
        nodes.push({
          id: cexId,
          x: cx + cexR * Math.cos(angle),
          y: cy + cexR * Math.sin(angle),
          label: ex,
          balance: 0,
          riskScore: null,
          clusterIdx: undefined,
          isCex: true,
          cexName: ex,
          exchanges: [],
        })
      }
    }
  }

  // Edges
  const edges: GraphEdge[] = []

  // Internal transfers
  for (const t of transfers) {
    if (addrIndex.has(t.from) && addrIndex.has(t.to)) {
      edges.push({ from: t.from, to: t.to, valueBtc: t.valueBtc, hops: t.hops, kind: "transfer" })
    }
  }

  // CIOH cluster links (connect each pair in cluster)
  for (const cluster of clusters) {
    const inGraph = cluster.filter((a) => addrIndex.has(a))
    for (let i = 0; i < inGraph.length - 1; i++) {
      edges.push({ from: inGraph[i], to: inGraph[i + 1], kind: "cioh" })
    }
  }

  // CEX links
  for (const s of sourceAddrs) {
    const seen = new Set<string>()
    for (const link of s.links) {
      const cexId = `cex:${link.exchange}`
      if (addrIndex.has(cexId) && !seen.has(cexId)) {
        seen.add(cexId)
        edges.push({ from: s.address, to: cexId, kind: "cex" })
      }
    }
  }

  return { nodes, edges, addrIndex }
}

// ---------------------------------------------------------------------------
// SVG Graph component
// ---------------------------------------------------------------------------

function ConnectionGraph({ trace }: { trace: TraceResult }) {
  const { nodes, edges, addrIndex } = useMemo(() => buildGraph(trace), [trace])
  const [hovered, setHovered] = useState<string | null>(null)

  if (nodes.length === 0) return null

  // Compute viewBox to fit all nodes
  const pad = 50
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad
  const vw = maxX - minX, vh = maxY - minY

  const isHighlighted = (id: string) => {
    if (!hovered) return true
    if (id === hovered) return true
    return edges.some(
      (e) => (e.from === hovered && e.to === id) || (e.to === hovered && e.from === id),
    )
  }

  return (
    <div className="rounded-sm border border-border bg-card/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
        <GitFork className="size-3.5" /> address graph
      </div>
      <svg
        viewBox={`${minX} ${minY} ${vw} ${vh}`}
        className="w-full"
        style={{ maxHeight: 480 }}
      >
        <defs>
          <marker
            id="arrow-transfer"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,3.5 L0,7 Z" fill="#3b82f6" />
          </marker>
          <marker
            id="arrow-cex"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,3.5 L0,7 Z" fill="#ef4444" />
          </marker>
        </defs>

        {/* Cluster backgrounds */}
        {(trace.ownershipClusters ?? []).map((cluster, ci) => {
          const inGraph = cluster.filter((a) => addrIndex.has(a))
          if (inGraph.length < 2) return null
          const pts = inGraph.map((a) => nodes[addrIndex.get(a)!])
          const midX = pts.reduce((s, p) => s + p.x, 0) / pts.length
          const midY = pts.reduce((s, p) => s + p.y, 0) / pts.length
          const maxDist = Math.max(30, ...pts.map((p) => Math.hypot(p.x - midX, p.y - midY))) + 28
          return (
            <circle
              key={`cluster-${ci}`}
              cx={midX}
              cy={midY}
              r={maxDist}
              fill={CLUSTER_HEX[ci % CLUSTER_HEX.length]}
              fillOpacity={0.06}
              stroke={CLUSTER_HEX[ci % CLUSTER_HEX.length]}
              strokeOpacity={0.25}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )
        })}

        {/* Edges */}
        {edges.map((e, i) => {
          const fromN = nodes[addrIndex.get(e.from)!]
          const toN = nodes[addrIndex.get(e.to)!]
          if (!fromN || !toN) return null

          const dx = toN.x - fromN.x
          const dy = toN.y - fromN.y
          const dist = Math.hypot(dx, dy)
          const fromR = fromN.isCex ? 10 : 16
          const toR = toN.isCex ? 10 : 16
          // shorten line to not overlap node circles
          const sx = fromN.x + (dx / dist) * fromR
          const sy = fromN.y + (dy / dist) * fromR
          const ex = toN.x - (dx / dist) * (toR + 8)
          const ey = toN.y - (dy / dist) * (toR + 8)

          const dimmed =
            hovered && !isHighlighted(e.from) && !isHighlighted(e.to)

          if (e.kind === "cioh") {
            return (
              <line
                key={`e-${i}`}
                x1={sx} y1={sy} x2={ex} y2={ey}
                stroke={CLUSTER_HEX[
                  (trace.ownershipClusters ?? []).findIndex((c) =>
                    c.includes(e.from) && c.includes(e.to),
                  ) % CLUSTER_HEX.length
                ] ?? "#8b5cf6"}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={dimmed ? 0.1 : 0.5}
              />
            )
          }

          return (
            <line
              key={`e-${i}`}
              x1={sx} y1={sy} x2={ex} y2={ey}
              stroke={e.kind === "cex" ? "#ef4444" : "#3b82f6"}
              strokeWidth={e.kind === "cex" ? 1 : 1.5}
              strokeDasharray={e.kind === "cex" ? "3 2" : undefined}
              markerEnd={`url(#arrow-${e.kind === "cex" ? "cex" : "transfer"})`}
              opacity={dimmed ? 0.1 : 0.7}
            />
          )
        })}

        {/* Edge value labels — transfers only */}
        {edges
          .filter((e) => e.kind === "transfer" && e.valueBtc != null)
          .map((e, i) => {
            const fromN = nodes[addrIndex.get(e.from)!]
            const toN = nodes[addrIndex.get(e.to)!]
            if (!fromN || !toN) return null
            const mx = (fromN.x + toN.x) / 2
            const my = (fromN.y + toN.y) / 2
            const dimmed = hovered && !isHighlighted(e.from) && !isHighlighted(e.to)
            return (
              <text
                key={`el-${i}`}
                x={mx}
                y={my - 6}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={8}
                opacity={dimmed ? 0.1 : 0.8}
              >
                {e.valueBtc!.toFixed(4)} BTC{e.hops && e.hops > 1 ? ` · ${e.hops} hops` : ""}
              </text>
            )
          })}

        {/* Nodes */}
        {nodes.map((n) => {
          const dimmed = hovered && !isHighlighted(n.id)
          const r = n.isCex ? 10 : Math.max(12, Math.min(22, 12 + n.balance * 6))

          if (n.isCex) {
            return (
              <g
                key={n.id}
                opacity={dimmed ? 0.15 : 1}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
              >
                <rect
                  x={n.x - 24}
                  y={n.y - 10}
                  width={48}
                  height={20}
                  rx={3}
                  fill="#ef4444"
                  fillOpacity={0.15}
                  stroke="#ef4444"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
                <text
                  x={n.x}
                  y={n.y + 4}
                  textAnchor="middle"
                  fill="#ef4444"
                  fontSize={8}
                  fontWeight="bold"
                >
                  {n.label}
                </text>
              </g>
            )
          }

          const fill = n.clusterIdx != null
            ? CLUSTER_HEX[n.clusterIdx % CLUSTER_HEX.length]
            : riskToneHex(n.riskScore)

          return (
            <g
              key={n.id}
              opacity={dimmed ? 0.15 : 1}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <circle
                cx={n.x}
                cy={n.y}
                r={r}
                fill={fill}
                fillOpacity={0.2}
                stroke={fill}
                strokeWidth={1.5}
              />
              {/* Address label */}
              <text
                x={n.x}
                y={n.y - r - 6}
                textAnchor="middle"
                fill="#e2e8f0"
                fontSize={8}
                fontFamily="monospace"
              >
                {n.label}
              </text>
              {/* Balance inside node */}
              {n.balance > 0 && (
                <text
                  x={n.x}
                  y={n.y + 3}
                  textAnchor="middle"
                  fill="#e2e8f0"
                  fontSize={7}
                >
                  {n.balance.toFixed(4)}
                </text>
              )}
              {n.balance === 0 && (
                <text
                  x={n.x}
                  y={n.y + 3}
                  textAnchor="middle"
                  fill="#6b7280"
                  fontSize={7}
                >
                  empty
                </text>
              )}
              {/* Exchange badges below node */}
              {n.exchanges.length > 0 && (
                <text
                  x={n.x}
                  y={n.y + r + 12}
                  textAnchor="middle"
                  fill="#ef4444"
                  fontSize={7}
                  fontWeight="bold"
                >
                  {n.exchanges.join(", ")}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-blue-500" /> transfer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-violet-400" /> CIOH
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-destructive" /> CEX link
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full border border-muted-foreground" /> source address
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-sm border border-destructive/50 bg-destructive/15" /> exchange
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ConnectionsView({ trace }: { trace: TraceResult }) {
  const clusters = trace.ownershipClusters ?? []
  const transfers = trace.internalTransfers ?? []

  const clusterLookup = new Map<string, number>()
  for (let i = 0; i < clusters.length; i++)
    for (const addr of clusters[i]) clusterLookup.set(addr, i)

  const sourceMap = new Map(trace.sources.map((s) => [s.address, s]))
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

      {/* Visual graph */}
      <ConnectionGraph trace={trace} />

      {/* Detail: internal transfers */}
      {transfers.length > 0 && (
        <div className="rounded-sm border border-border bg-card/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <GitFork className="size-3.5" /> internal transfers
          </div>
          <div className="space-y-2">
            {transfers.map((t, i) => {
              const fromCluster = clusterLookup.get(t.from)
              const toCluster = clusterLookup.get(t.to)
              const fromBest = sourceMap.get(t.from)?.links[0]?.score ?? null
              const toBest = sourceMap.get(t.to)?.links[0]?.score ?? null
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
                    <span className="text-[10px] text-foreground">
                      {t.valueBtc.toFixed(6)} BTC{t.hops ? ` · ${t.hops} hop${t.hops !== 1 ? "s" : ""}` : ""}
                    </span>
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

                  {t.intermediates?.length > 0 && (
                    <div className="mt-1 w-full pl-4 text-[10px] text-muted-foreground">
                      via {t.intermediates.map((a, j) => (
                        <span key={j}>
                          {j > 0 && " → "}
                          <code>{truncateAddr(a, 6, 4)}</code>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Detail: clusters */}
      {clusters.length > 0 && (
        <div className="rounded-sm border border-border bg-card/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <Fingerprint className="size-3.5" /> ownership clusters (CIOH)
          </div>
          <div className="space-y-2">
            {clusters.map((cluster, i) => {
              const cc = clusterColor(i)
              const clusterSources = trace.sources.filter((s) => cluster.includes(s.address))
              const totalBtc = clusterSources.reduce((s, src) => s + src.balanceBtc, 0)
              const allLinks = clusterSources.flatMap((s) => s.links)
              const bestLink = allLinks.length > 0
                ? allLinks.reduce((best, l) => (l.score < best.score ? l : best))
                : null
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
